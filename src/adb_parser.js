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
    if (serial) devices.push({ serial, state, detail });
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
    if (serial) devices.push({ serial, state: 'fastboot', detail });
  }
  return devices;
}

module.exports = { lines, parseAdbDevices, parseFastbootDevices };
