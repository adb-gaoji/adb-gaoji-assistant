/**
 * adb / fastboot 设备列表输出解析。
 *
 * 纯函数模块，不依赖 Electron，可直接单元测试。
 *
 * `adb devices -l` 每行形如：
 *   NGPAD80117            device product:penang model:XT2335-3 device:penang transport_id:1
 * `fastboot devices -l` 每行形如：
 *   NGPAD80117            fastboot usb:1-2
 * 其中 serial 与 state 由空白分隔，其余内容整体作为 detail。
 */

/** 按行拆分并去除空白行。 */
function lines(text) {
  return String(text || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
}

/**
 * 判断一个 ADB 设备是否是模拟器。
 *
 * 屏蔽模拟器的原因：模拟器在 `adb devices` 里常常排在真机前面，
 * 导致程序默认选中模拟器，安装应用、有线投屏等功能全部作用到模拟器上，
 * 用户以为功能坏了。这里从解析层直接剔除，避免污染所有下游功能。
 *
 * 判定依据（任一命中即视为模拟器）：
 *   1. serial 以 `emulator-` 开头 —— Android SDK 模拟器的标准命名
 *   2. serial 是本地回环地址加端口 —— 雷电、夜神、MuMu 等国产模拟器
 *      例：`127.0.0.1:5555`、`localhost:62001`
 *   3. detail 里带 `qemu`、`sdk_gphone`、`generic_x86`、`virtual` 等标记
 *
 * 注意：真机的 **无线调试** 通常是 `192.168.x.x:5555` 这类局域网地址，
 * 不属于回环，必须保留，否则会废掉无线连接功能。
 */
function isEmulator(serial, detail) {
  const s = String(serial || '').toLowerCase();
  const d = String(detail || '').toLowerCase();
  if (s.startsWith('emulator-')) return true;
  // 本地回环 + 端口：模拟器常用；真机无线调试走局域网地址，不会被命中
  if (/^(127\.0\.0\.1|localhost|0\.0\.0\.0):\d+$/.test(s)) return true;
  // detail 中的模拟器指纹
  if (/\bqemu\b|sdk_gphone|generic_x86|generic_arm|goldfish|ranchu|virtualdevice/.test(d)) return true;
  return false;
}

/** 导出供测试使用。 */

/**
 * 解析 `adb devices -l`。
 *
 * `adb devices -l` 的详情是 `key:value` 序列：
 *   serial  state  product:penang model:XT2335-3 device:penang transport_id:1
 * 这里用「首个空白切出 serial、第二个切出 state、其余整体作为 detail」的方式，
 * 而不是 `split(/\s+/, 3)`：后者的第三个参数在 JS 中是**截断上限**，
 * 会把 detail 掐成只有第一个键值对，丢掉 model 与 transport_id。
 */
function parseAdbDevices(text) {
  const devices = [];
  for (const line of lines(text)) {
    if (line.startsWith('List of devices')) continue;
    const first = line.search(/\s/);
    if (first < 0) continue;
    const serial = line.slice(0, first);
    const rest = line.slice(first).trim();
    const second = rest.search(/\s/);
    const state = second < 0 ? rest : rest.slice(0, second);
    const detail = second < 0 ? '' : rest.slice(second).trim();
    if (!serial) continue;
    if (isEmulator(serial, detail)) continue;
    devices.push({ serial, state, detail });
  }
  return devices;
}

/** 解析 `fastboot devices -l`；fastboot 侧 state 恒为 fastboot。 */
function parseFastbootDevices(text) {
  const devices = [];
  for (const line of lines(text)) {
    if (line.startsWith('List of devices')) continue;
    const first = line.search(/\s/);
    const serial = first < 0 ? line : line.slice(0, first);
    const detail = first < 0 ? '' : line.slice(first).trim();
    if (!serial) continue;
    if (isEmulator(serial, detail)) continue;
    devices.push({ serial, state: 'fastboot', detail });
  }
  return devices;
}

module.exports = { lines, parseAdbDevices, parseFastbootDevices, isEmulator };
