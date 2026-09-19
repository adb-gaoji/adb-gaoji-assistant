/**
 * A/B 槽位分区名解析。
 *
 * 为什么单独抽一个模块：
 *
 * 1) **可测**。刷机最怕的就是 "boot" 和 "boot_a" 写混——一个写到不存在的分区，
 *    一个写错槽位。这类拼装规则必须能用单元测试钉死，不能埋在
 *    `main.js` 的 switch 里靠人工 review 保证。
 *
 * 2) **两侧共用**。界面上要把「分区 + 槽位」拼成最终名字做二次确认展示，
 *    主进程也要拼一次决定真实的 fastboot 命令。两处各写一遍必然走岔，
 *    所以规则只留在这里，两边都调它。
 *
 * 3) **无依赖**。与 actions.registry.js 一样写成 UMD，既能被 Node require，
 *    也能被渲染进程通过 <script> 直接用，且不依赖任何 Node 内置模块。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SLOT_RESOLVER = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /** 合法的槽位取值。空串表示"不带槽位后缀"（单槽机型）。 */
  const VALID_SLOTS = ['', 'a', 'b'];

  /** 允许出现在分区名里的字符。设备上的分区名不会超出这个范围。 */
  const PARTITION_PATTERN = /^[A-Za-z0-9_-]+$/;

  /**
   * 判断分区名是否已自带槽位后缀。
   *
   * 只认结尾的 `_a` / `_b`：`system_a` 算带后缀，`vendor`（含字母 a）不算。
   * 用 `_` 作为边界是为了避开 `vbmeta` 这类以 a 结尾但并非槽位后缀的名字。
   */
  function hasSlotSuffix(partition) {
    return /_[ab]$/i.test(String(partition || ''));
  }

  /** 归一化槽位输入：只接受 'a' / 'b'，其余（含 'none'、'current'）一律当作"不带后缀"。 */
  function normalizeSlot(slot) {
    const value = String(slot === null || slot === undefined ? '' : slot).trim().toLowerCase();
    return value === 'a' || value === 'b' ? value : '';
  }

  /**
   * 把「分区类型 + 目标槽位」拼成设备上真实的分区名。
   *
   * 规则：
   *   - 分区名已带 `_a` / `_b` 时原样返回（用户显式指定优先，不重复拼接）；
   *   - 槽位为空（单槽机型或用户选择"不带后缀"）时返回裸分区名；
   *   - 其余情况拼成 `<分区>_<槽位>`。
   *
   * @param {string} partition 分区类型，如 'boot'、'init_boot'
   * @param {string} slot      目标槽位，'a' / 'b'，其它值视为不带后缀
   * @returns {string} 设备上的真实分区名；分区名为空时返回空串
   */
  function resolvePartitionName(partition, slot) {
    const base = String(partition === null || partition === undefined ? '' : partition).trim();
    if (!base) return '';
    if (hasSlotSuffix(base)) return base;
    const normalized = normalizeSlot(slot);
    return normalized ? `${base}_${normalized}` : base;
  }

  /**
   * 校验分区名并给出可读的失败原因。
   *
   * 返回 `{ valid: true }` 或 `{ valid: false, reason }`，
   * 让调用方决定是拦下来还是继续，而不是抛异常打断流程。
   */
  function validatePartitionName(partition) {
    const base = String(partition === null || partition === undefined ? '' : partition).trim();
    if (!base) return { valid: false, reason: '分区名为空。' };
    if (base.length > 64) return { valid: false, reason: `分区名过长（${base.length} 字符），设备分区名不会超过 64 字符。` };
    if (!PARTITION_PATTERN.test(base)) {
      return { valid: false, reason: `分区名含非法字符：${base}。只允许字母、数字、下划线和连字符。` };
    }
    // 单独一个槽位后缀没有意义（"_a" 不是分区）
    if (/^_[ab]$/i.test(base)) return { valid: false, reason: `分区名不完整：${base}。请一并提供分区类型，例如 boot${base}。` };
    return { valid: true };
  }

  /**
   * 结合设备信息，把用户的「分区 + 槽位」选择解析成最终写入目标，并给出提示语。
   *
   * `device` 描述设备当前状态：
   *   - `isAbDevice`  : 是否为 A/B 双槽机型（由 current-slot 能否读到决定）
   *   - `currentSlot` : 当前活动槽位 'a' / 'b'，读不到为空串
   *   - `available`   : 设备上确实存在的分区名数组（可选，来自 flash-slot-info）
   *
   * 返回值：
   *   - `partition` : 最终要写入的分区名
   *   - `targetsCurrentSlot` : 是否写向当前活动槽位
   *   - `notes`     : 给用户看的提示行（数组）
   *   - `blocked`   : 拦下来的原因；非空时调用方不应继续写入
   */
  function resolveFlashTarget(options) {
    const opts = options || {};
    const device = opts.device || {};
    const requestedSlot = String(opts.slot === null || opts.slot === undefined ? '' : opts.slot).trim().toLowerCase();
    const notes = [];

    // ---- 单槽机型：不接受槽位后缀 ----
    if (device.isAbDevice === false && (requestedSlot === 'a' || requestedSlot === 'b')) {
      return {
        partition: resolvePartitionName(opts.partition, ''),
        targetIsOtherSlot: false,
        notes,
        blocked: '当前设备不是 A/B 双槽机型（读不到 current-slot），不能写入带槽位后缀的分区。请确认设备已进入 Fastboot，或改选“不带槽位后缀”。'
      };
    }

    // ---- 'current' 需要设备配合解析 ----
    let slot = requestedSlot;
    if (requestedSlot === 'current') {
      const current = normalizeSlot(device.currentSlot);
      if (!current) {
        return {
          partition: resolvePartitionName(opts.partition, ''),
          targetIsOtherSlot: false,
          notes,
          blocked: '未能读取设备当前活动槽位（可能需要先进入 Fastboot）。请手动选择槽位 A 或 B，避免写错分区。'
        };
      }
      slot = current;
      notes.push(`已按设备当前活动槽位解析为 ${current.toUpperCase()}。`);
    }

    const partition = resolvePartitionName(opts.partition, slot);
    const validation = validatePartitionName(partition);
    if (!validation.valid) {
      return { partition, targetIsOtherSlot: false, notes, blocked: validation.reason };
    }

    // ---- 设备上不存在该分区时提前拦下 ----
    if (Array.isArray(device.available) && device.available.length && !device.available.includes(partition)) {
      return {
        partition,
        targetIsOtherSlot: false,
        notes,
        blocked: `设备上不存在分区 ${partition}。可用分区：${device.available.join('、')}。请先用“检测分区与槽位”确认。`
      };
    }

    // ---- 写向非活动槽时明确提醒（不是错误，但必须让用户知道后果）----
    const current = normalizeSlot(device.currentSlot);
    const slotInName = hasSlotSuffix(partition) ? partition.slice(-1).toLowerCase() : '';
    const targetIsOtherSlot = Boolean(current && slotInName && slotInName !== current);
    if (targetIsOtherSlot) {
      notes.push(
        `注意：目标分区 ${partition} 属于槽位 ${slotInName.toUpperCase()}，而当前活动槽位是 ${current.toUpperCase()}。` +
        '写入后需要执行“切换启动槽位”才会从新槽启动；若不是有意为之，请改选当前活动槽位。'
      );
    } else if (slotInName) {
      notes.push(`目标分区 ${partition} 与当前活动槽位一致。`);
    }

    return { partition, targetIsOtherSlot, notes, blocked: '' };
  }

  return {
    VALID_SLOTS,
    hasSlotSuffix,
    normalizeSlot,
    resolvePartitionName,
    validatePartitionName,
    resolveFlashTarget
  };
});
