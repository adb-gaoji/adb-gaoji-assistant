/**
 * 多用户（应用分身）感知的安装策略。
 *
 * 背景：联想 / 摩托罗拉 / 小米等机型的"应用分身"在系统里表现为多个
 * Android 用户空间（user 900、901……），摩托国行常见 10 个。
 *
 * 这类机型上执行 `adb install <apk>` 会把包装到**所有运行中的用户空间**，
 * 用户看到的后果是：装一个应用，桌面上立刻多出 10 个分身图标。
 * 而用户真正想要的规则是：
 *
 *   - 新应用（任何分身里都没有）  -> 只装主空间，不产生分身
 *   - 已有分身的应用（某分身装过）-> 主空间装新版，并给那些分身补装
 *
 * 为什么用 install-existing 补装而不是对每个用户 install：
 *   `install-existing --user N` 只是把已安装的包对用户 N 可见，
 *   不重复传输 APK，也不占额外存储；对 A/B 分包应用尤其重要
 *   （拆分包没法对单个用户重复 install）。
 *
 * 本模块是纯函数，主进程与渲染进程共用，配单元测试固定行为。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CLONE_POLICY = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /** 主用户，始终是安装目标。 */
  const PRIMARY_USER = 0;

  /**
   * 从 `pm list users` 的原始输出里解析出所有用户空间。
   *
   * 输出形如：
   *   Users:
   *   	UserInfo{0:机主:4c13} running
   *   	UserInfo{900:应用分身:1010} running
   *
   * 只挑运行中的用户——未运行的用户空间装进去也用不了，
   * 而且部分机型对未运行用户执行安装会直接失败。
   */
  function parseUserSpaces(output) {
    const users = [];
    const text = String(output || '');
    for (const match of text.matchAll(/UserInfo\{(\d+):([^:}]*):([0-9a-fA-F]+)\}(\s*(running|stopped))?/g)) {
      const id = Number(match[1]);
      if (!Number.isInteger(id) || id < 0) continue;
      users.push({
        id,
        name: String(match[2] || '').trim(),
        running: !match[4] || /running/.test(match[4])
      });
    }
    // 按 id 排序，主用户排最前，便于日志阅读
    users.sort((a, b) => a.id - b.id);
    return users;
  }

  /** 分身用户：id 不为 0 的那些。 */
  function cloneUsers(users) {
    return (users || []).filter((user) => user.id !== PRIMARY_USER);
  }

  /**
   * 决定本次安装要落到哪些用户空间。
   *
   * @param {object} options
   * @param {Array}  options.users          设备上的用户空间（parseUserSpaces 的产物）
   * @param {Array<number>} options.existingUsers 该包当前已安装的用户 id 列表
   * @param {boolean} options.installToClones 用户是否要求"给已有分身也装"
   *   （默认 true，即遵循"已有分身就补装"的规则）
   * @returns {{primary:number, clones:number[], skipped:number[], reason:string}}
   *   - primary      : 主空间用户 id
   *   - clones       : 需要补装的分身用户
   *   - skipped      : 有分身但目标应用尚未装过的用户（不主动创建新分身）
   *   - reason       : 给用户看的一行说明
   */
  function planInstall(options) {
    const opts = options || {};
    const users = Array.isArray(opts.users) ? opts.users : [];
    const existing = new Set((Array.isArray(opts.existingUsers) ? opts.existingUsers : []).map(Number));
    const installToClones = opts.installToClones !== false;

    const clones = cloneUsers(users);
    if (!clones.length) {
      return {
        primary: PRIMARY_USER,
        clones: [],
        skipped: [],
        reason: '设备没有应用分身空间，只装主空间。'
      };
    }

    if (!installToClones) {
      return {
        primary: PRIMARY_USER,
        clones: [],
        skipped: clones.map((user) => user.id),
        reason: `设备有 ${clones.length} 个分身空间，按当前设置只装主空间。`
      };
    }

    // 只补装"原本就有这个应用"的分身，不主动往没用过该应用的分身里铺
    const targets = [];
    const skipped = [];
    for (const user of clones) {
      if (existing.has(user.id)) targets.push(user.id);
      else skipped.push(user.id);
    }

    if (!targets.length) {
      return {
        primary: PRIMARY_USER,
        clones: [],
        skipped,
        reason: `设备有 ${clones.length} 个分身空间，其中没有装过该应用，因此只装主空间——不会新建分身。`
      };
    }

    return {
      primary: PRIMARY_USER,
      clones: targets,
      skipped,
      reason: `该应用已在 ${targets.length} 个分身中安装过，将一并更新；其余 ${skipped.length} 个分身保持不变。`
    };
  }

  /**
   * 组装"查询某包在哪些用户下已安装"的 shell 命令。
   *
   * 一次 shell 往返里遍历所有用户，避免为每个用户各起一次 adb 进程
   * （10 个分身就是 10 次进程启动，明显变慢）。
   */
  function buildInstalledUsersCommand(pkg, users) {
    const list = (users || []).map((user) => (typeof user === 'number' ? user : user.id));
    const checks = list
      .map((id) => `pm list packages --user ${id} ${pkg} >/dev/null 2>&1 && echo ${id}`)
      .join('; ');
    return checks || 'true';
  }

  /** 从上面的命令输出里解析出已安装的用户 id。 */
  function parseInstalledUsers(output) {
    const ids = [];
    for (const line of String(output || '').split(/\r?\n/)) {
      const value = line.trim();
      if (/^\d+$/.test(value)) ids.push(Number(value));
    }
    return [...new Set(ids)].sort((a, b) => a - b);
  }

  return {
    PRIMARY_USER,
    parseUserSpaces,
    cloneUsers,
    planInstall,
    buildInstalledUsersCommand,
    parseInstalledUsers
  };
});
