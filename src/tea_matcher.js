/**
 * Tea 模板自动匹配。
 *
 * 背景：用户不知道自己的手机该用哪个模板。原来靠 dialog.showMessageBox
 * 列出 "Android 14 · Motorola X30 Pro / XT2241-1" 让用户点，用户只能猜。
 * 但设备信息（代号/机型/Android 版本）在 getStatus() 里全都有，
 * 模板里也都标了，完全可以自动匹配。
 *
 * 设计原则：
 *   - 宁可报"没匹配到"并说明原因，也不猜一个给用户刷；
 *   - 匹配上多个同等模板时，优先"实机验证过"的，其次非 reference_only 的；
 *   - reference_only 的模板永远不能作为输出，只能提示。
 */

/** 把 Android 版本串归一成数字主版本：'14' / '14.0' / 'Android 14' -> 14 */
function androidMajor(version) {
  const match = String(version || '').match(/(\d+)/);
  return match ? Number(match[1]) : 0;
}

/** 设备的可读标识，用于日志和错误提示。 */
function deviceIdentity(status = {}) {
  const props = status.props || {};
  return {
    code: String(props.device || '').trim().toLowerCase(),
    model: String(props.model || '').trim().toLowerCase(),
    android: androidMajor(props.android)
  };
}

/**
 * 从模板 manifest 中自动挑出适配当前设备的模板。
 *
 * @returns {{ok: true, template: object, reason: string} | {ok: false, reason: string}}
 */
function matchTeaTemplate(manifest, status = {}) {
  const templates = (manifest.templates || []).filter((t) => Array.isArray(t.files) && t.files.length);
  if (!templates.length) return { ok: false, reason: 'Tea 模板库为空。' };

  const identity = deviceIdentity(status);
  if (!identity.code && !identity.model) {
    return { ok: false, reason: '读不到设备机型信息，无法自动匹配模板。请先连接手机并授权 USB 调试。' };
  }

  // 依次按 代号 -> 机型 匹配。代号比机型可靠（机型名可能有多种写法）。
  const byCode = identity.code
    ? templates.filter((t) => String(t.code || '').toLowerCase() === identity.code)
    : [];
  const byModel = !byCode.length && identity.model
    ? templates.filter((t) => String(t.model || '').toLowerCase().includes(identity.model))
    : [];
  let candidates = byCode.length ? byCode : byModel;
  const matchedBy = byCode.length ? '设备代号' : (byModel.length ? '机型名' : '');

  if (!candidates.length) {
    const known = [...new Set(templates.map((t) => `${t.model}（${t.code}）`))].join('、');
    return {
      ok: false,
      reason: `模板库里没有适配当前设备的模板。\n当前设备：${status.props?.model || '未知'}（${status.props?.device || '未知'}）` +
        ` Android ${status.props?.android || '未知'}\n模板库覆盖：${known}`
    };
  }

  // Android 版本相符的优先；模板写 '13/14' 这种跨版本串时取其一即可。
  if (identity.android) {
    const exact = candidates.filter((t) => String(t.android || '').split('/').map(androidMajor).includes(identity.android));
    if (exact.length) candidates = exact;
  }

  // 实机验证过的优先，其次排除 reference_only。
  //
  // 注意这里必须用"始终过滤"的写法：早先写成"过滤后有剩才替换"，
  // 结果候选全是 reference_only 时，过滤结果为空 -> candidates 保持原样，
  // 于是 reference_only 模板照样被当成可用输出，安全拦截形同虚设。
  const verified = candidates.filter((t) => t.real_device_verified && !t.reference_only);
  const usable = candidates.filter((t) => !t.reference_only);
  if (verified.length) candidates = verified;
  else candidates = usable;

  if (!candidates.length) {
    const blocked = byCode.length ? byCode : byModel;
    return {
      ok: false,
      reason: `匹配到的模板均标记为 reference_only，只能用于结构参考，不允许生成可刷镜像。\n` +
        blocked.map((t) => `· ${t.model} / Android ${t.android}：${t.notes || ''}`).join('\n')
    };
  }

  // 多个候选且无法再区分时，明确列出来而不是随便挑一个。
  if (candidates.length > 1) {
    const same = candidates.every((t) => t.id === candidates[0].id);
    if (!same) {
      return {
        ok: false,
        reason: `按${matchedBy}匹配到 ${candidates.length} 个模板，无法自动决定用哪个：\n` +
          candidates.map((t) => `· ${t.id}（Android ${t.android}，${t.model}）`).join('\n') +
          '\n请在模板库中只保留一个该机型的模板，或联系维护者补充适配信息。'
      };
    }
  }

  return { ok: true, template: candidates[0], reason: `按${matchedBy}匹配到模板 ${candidates[0].id}` };
}

/**
 * 不依赖设备，自动挑一份最完整的 Tea 供体。
 *
 * 这是 Tea 制作最关键的一条认知：Tea 的运行时
 * （tea64 / tea32 / teapolicy / tea.product）是 ARM64 通用件，
 * **不随机型变化**。移植时保留的始终是用户自己的 kernel / header，
 * 只把这几份通用件塞进他的 ramdisk。
 *
 * 所以"该用哪个模板"这个问题本身并不成立——需要的只是"一份完整供体"。
 * 之前的实现在这一步之前先读设备、按机型匹配，没连手机就直接失败，
 * 等于把一件与机型无关的事，硬绑上了"必须先插手机"的前提。
 *
 * 挑法：明确标了 tea_core_donor 的优先，其次实机验证过的，
 * 再次 notes 里提到 tea.product 的；reference_only 一律排除。
 *
 * @param {object} manifest 模板清单
 * @param {string} library  模板库根目录
 * @param {(p: string) => boolean} [exists] 文件存在性判断，便于测试注入
 * @returns {{template: object, relative: string, path: string} | null}
 */
function pickTeaDonor(manifest, library, exists) {
  const nodePath = require('node:path');
  const has = typeof exists === 'function' ? exists : () => true;
  const templates = (manifest.templates || [])
    .filter((t) => Array.isArray(t.files) && t.files.length && !t.reference_only);

  const ranked = templates
    .map((template) => {
      let score = 0;
      if (template.tea_core_donor) score += 8;
      if (template.real_device_verified) score += 4;
      if (/tea\.product/.test(String(template.notes || ''))) score += 2;
      return { template, score };
    })
    .sort((a, b) => b.score - a.score);

  for (const { template } of ranked) {
    for (const file of template.files) {
      const relative = typeof file === 'string' ? file : (file && file.path);
      if (!relative) continue;
      const full = nodePath.join(library, relative);
      if (!has(full)) continue;
      return { template, relative, path: full };
    }
  }
  return null;
}

/**
 * 自动决定槽位镜像。
 *
 * 模板的 files 数组通常是 [A, B]；两者内容相同时（slot_files_note 说明了这点）
 * 用哪个都行，此时优先跟随设备当前活动槽位，让用户刷的就是他正在用的那个槽。
 * 单槽机型固定取第 0 个。
 */
function pickTeaSlotFile(template, status = {}) {
  const files = template.files || [];
  if (!files.length) return null;
  const currentSlot = String(status.slotInfo?.currentSlot || '').toLowerCase();
  const isAb = status.slotInfo?.isAbDevice;
  const index = (isAb && currentSlot === 'b' && files.length > 1) ? 1 : 0;
  return { relative: files[Math.min(index, files.length - 1)], slot: index === 1 ? 'B' : 'A' };
}

module.exports = { androidMajor, deviceIdentity, matchTeaTemplate, pickTeaSlotFile, pickTeaDonor };
