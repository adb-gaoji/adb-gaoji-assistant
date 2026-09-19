/**
 * 固件刷机命令的判定逻辑。
 *
 * 纯函数模块，不直接执行命令——执行由 main.js 负责。
 * 抽出独立模块是为了让这些规则能被单元测试钉死，因为它们直接决定
 * "刷机到底算成功还是失败"，而 fastboot 的失败**经常不体现在退出码上**：
 *
 *   Sending 'boot_a' (65536 KB) FAILED!
 *   fastboot: error: cannot load 'boot.img'
 *   FAILED (remote: 'unknown partition')
 *
 * 这些情况下 fastboot 进程本身可能正常退出（退出码 0），
 * 只看退出码会把失败的刷机报成成功。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FLASH_RUNNER = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /** fastboot 表示失败的标准标记。 */
  const FAILURE_MARKERS = [
    /FAILED/i,
    /error:/i,
    /cannot load/i,
    /cannot open/i,
    /unknown partition/i,
    /Invalid argument/i,
    /No such file/i,
    /Write to device failed/i,
    /Couldn't parse partition size/i,
    /Failed to (?:write|send|erase)/i,
    /Device not found/i,
    /no devices found/i,
    /Status read failed/i,
    /too many links/i,
    // 设备不在 fastboot 时 fastboot 会打印这个然后**一直等待**，
    // 直到被超时终止。实测确认（见 tests 与真机验证）：
    // 进程会挂起，code 为 null。提前识别可以让用户立刻知道是设备掉线，
    // 而不是干等超时。
    /waiting for any device/i,
    /< waiting for device >/i
  ];

  /**
   * 哪些失败值得重试。
   *
   * 只重试"传输层抖动"这类偶发问题——USB 接触不良、线材质量差、
   * 设备短暂掉线。分区名写错、本地镜像缺失、bootloader 未解锁这类
   * 问题重试多少次都一样，重试只会浪费时间并让用户困惑。
   */
  const RETRYABLE_MARKERS = [
    /Write to device failed/i,
    /Status read failed/i,
    /too many links/i,
    /Couldn't parse partition size/i,
    /Device not found/i,
    /no devices found/i,
    /Connection reset/i,
    // 设备掉线后重试一次是有意义的：多数情况是 USB 接触问题，
    // 重新握手能恢复。重试仍失败才判定为刷机失败。
    /waiting for any device/i,
    /< waiting for device >/i
  ];

  /** 命令类型。不同类型在失败后果与超时上差别很大。 */
  const KIND = {
    FLASH: 'flash',
    ERASE: 'erase',
    GETVAR: 'getvar',
    REBOOT: 'reboot',
    REBOOT_BOOTLOADER: 'reboot-bootloader',
    SET_ACTIVE: 'set-active',
    CONTINUE: 'continue',
    OTHER: 'other'
  };

  /** 判断命令类型。 */
  function classifyCommand(args) {
    const list = Array.isArray(args) ? args : [];
    const first = String(list[0] || '').toLowerCase();
    if (first === 'flash' || first === 'flashall') return KIND.FLASH;
    if (first === 'erase') return KIND.ERASE;
    if (first === 'getvar' || first === 'getvar:all') return KIND.GETVAR;
    if (first === 'reboot-bootloader' || first === 'reboot_bootloader') return KIND.REBOOT_BOOTLOADER;
    if (first === 'reboot') return KIND.REBOOT;
    if (first === 'continue') return KIND.CONTINUE;
    if (first.startsWith('--set-active')) return KIND.SET_ACTIVE;
    return KIND.OTHER;
  }

  /** 命令的可读标签，用于日志与进度显示。 */
  function describeCommand(args) {
    const list = Array.isArray(args) ? args : [];
    const kind = classifyCommand(list);
    if (kind === KIND.FLASH) return `刷写 ${list[1] || '?'}`;
    if (kind === KIND.ERASE) return `清除 ${list[1] || '?'}`;
    if (kind === KIND.GETVAR) return `读取变量 ${list[1] || 'all'}`;
    if (kind === KIND.REBOOT_BOOTLOADER) return '重启到 Bootloader';
    if (kind === KIND.REBOOT) return `重启${list[1] ? `到 ${list[1]}` : ''}`;
    if (kind === KIND.SET_ACTIVE) return `切换活动槽 ${String(list[0]).split('=')[1] || ''}`;
    if (kind === KIND.CONTINUE) return '继续启动';
    return list.join(' ');
  }

  /**
   * 计算这条命令该给多少超时。
   *
   * 刷写耗时主要由**镜像体积**决定，固定超时要么对 super.img 这类
   * 几 GB 的分区太短（中途被杀，刷一半），要么对几十 KB 的小分区太长
   * （真卡住时要等很久）。这里按体积估算，并按 USB 2.0 的保守速度取值。
   *
   * @param {Array} args    fastboot 参数
   * @param {object} options.fileSizeBytes 目标镜像大小（可选）
   */
  function computeTimeout(args, options = {}) {
    const kind = classifyCommand(args);
    // 基础时间：进程启动 + 与设备握手
    const base = 20000;
    switch (kind) {
      case KIND.FLASH: {
        const size = Number(options.fileSizeBytes) || 0;
        if (!size) return 300000;              // 拿不到体积时给 5 分钟
        // 保守按 4 MB/s 估算，再加 60 秒握手与校验缓冲
        const transfer = Math.ceil(size / (4 * 1024 * 1024)) * 1000;
        return Math.min(Math.max(base + transfer + 60000, 120000), 1800000);
      }
      case KIND.ERASE: return 120000;
      case KIND.GETVAR: return 30000;
      case KIND.REBOOT:
      case KIND.REBOOT_BOOTLOADER: return 60000;
      case KIND.SET_ACTIVE:
      case KIND.CONTINUE: return 30000;
      default: return 300000;
    }
  }

  /** 把 fastboot 的 stdout/stderr 合成一段文本用于判定。 */
  function outputText(result) {
    return `${(result && result.stdout) || ''}\n${(result && result.stderr) || ''}`;
  }

  /** 命中任一失败标记即认为输出里报告了失败。 */
  function outputReportsFailure(result) {
    const text = outputText(result);
    return FAILURE_MARKERS.some((pattern) => pattern.test(text));
  }

  /**
   * 综合判断一条命令的执行结果。
   *
   * 返回：
   *   ok        : 是否视为成功
   *   fatal     : 失败时是否必须中止整个刷机流程
   *   retryable : 是否值得重试
   *   reason    : 给用户看的原因
   *
   * 关于 `fatal` 的取舍：
   *   - flash / erase / set-active 失败 -> 必须中止。继续刷下去可能
   *     造成分区与槽位不一致，比停下来更危险。
   *   - getvar 失败 -> 不中止。官方 XML 里 getvar 常用于校验，
   *     变量不存在（如未解锁机型查不到某些值）不代表刷机有问题。
   *   - reboot / reboot-bootloader 失败 -> 不中止。镜像已经写完，
   *     重启失败通常可以手动重启补救，不该把整个刷机判为失败。
   */
  function analyzeResult(args, result) {
    const kind = classifyCommand(args);
    const code = result ? result.code : undefined;
    const reportsFailure = outputReportsFailure(result);
    const timeout = code === 124;
    const killed = code === 9009;

    if (code === 0 && !reportsFailure) {
      return { ok: true, fatal: false, retryable: false, reason: '' };
    }

    // 组织失败原因。
    // 顺序很重要：超时是"结果"，但用户更需要知道"原因"。
    // 设备掉线时 fastboot 会打印 waiting for any device 然后一直等，
    // 最终以超时收场——这时报"设备不在 Fastboot"比报"执行超时"有用得多。
    const deviceGone = /waiting for any device|< waiting for device >|Device not found|no devices found/i.test(outputText(result));
    let reason = '';
    if (deviceGone) {
      reason = '设备已不在 Fastboot（fastboot 报告等待设备）。请检查数据线连接后重试。';
    } else if (timeout) {
      reason = '执行超时，已终止该命令。';
    } else if (killed) {
      reason = '进程被异常终止（设备可能已断开）。';
    } else if (reportsFailure) {
      const line = outputText(result)
        .split(/\r?\n/)
        .map((item) => item.trim())
        .find((item) => FAILURE_MARKERS.some((pattern) => pattern.test(item)));
      reason = line || 'fastboot 报告失败。';
    } else {
      reason = `fastboot 退出码 ${code}。`;
    }

    const retryable = RETRYABLE_MARKERS.some((pattern) => pattern.test(outputText(result))) || timeout;

    // getvar / reboot 类失败不阻断流程
    const nonFatalKind = kind === KIND.GETVAR || kind === KIND.REBOOT ||
      kind === KIND.REBOOT_BOOTLOADER || kind === KIND.CONTINUE;

    return {
      ok: false,
      fatal: !nonFatalKind,
      retryable,
      reason
    };
  }

  /**
   * 这条命令执行后，是否需要等待设备重新出现在 fastboot 列表里。
   *
   * `reboot-bootloader` 会让设备重启回 fastboot，中间有十几秒不可用；
   * 不等它回来就发下一条命令，必然 `Device not found`——
   * 这正是"刷机有时不成功"的常见原因之一。
   */
  function needsDeviceWait(args) {
    return classifyCommand(args) === KIND.REBOOT_BOOTLOADER;
  }

  /** 该命令执行后设备是否已经离开 fastboot（后续命令不应继续）。 */
  function leavesFastboot(args) {
    const kind = classifyCommand(args);
    return kind === KIND.REBOOT || kind === KIND.CONTINUE;
  }

  /**
   * 生成一条进度行，供界面实时显示。
   *
   * 形如：`[7/27] 刷写 boot_a`
   */
  function progressLine(index, total, args) {
    return `[${index + 1}/${total}] ${describeCommand(args)}`;
  }

  /**
   * 把 fastboot 的原始输出整理成适合界面显示的缩进文本。
   *
   * fastboot 的输出里有很多进度回显（`Sending ... OKAY`、
   * 以及 `\r` 刷新行），直接原样贴到界面会挤成一团，
   * 这里按行拆分、去掉空行、统一缩进。
   */
  function formatOutput(result) {
    const raw = outputText(result);
    return raw
      .split(/\r?\n|\r/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => `      ${line}`)
      .join('\n');
  }

  return {
    KIND,
    FAILURE_MARKERS,
    RETRYABLE_MARKERS,
    classifyCommand,
    describeCommand,
    computeTimeout,
    outputText,
    outputReportsFailure,
    analyzeResult,
    needsDeviceWait,
    leavesFastboot,
    progressLine,
    formatOutput
  };
});
