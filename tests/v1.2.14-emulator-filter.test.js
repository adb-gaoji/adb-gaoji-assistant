/**
 * V1.2.14 模拟器过滤专项测试。
 *
 * 背景：电脑上跑着 Android 模拟器时，模拟器在 `adb devices` 里常常排在真机前面，
 * 程序默认选中它，导致「安装应用」把 APK 装到模拟器、「有线投屏」投的是模拟器画面，
 * 用户以为功能坏了。修复方式是在设备解析层直接过滤模拟器。
 *
 * 本文件覆盖三类场景：
 *   1. isEmulator() 的识别边界（该认的认、不该认的不能误伤）
 *   2. parseAdbDevices / parseFastbootDevices 的过滤效果
 *   3. 回归保护：真机（USB 与无线调试）必须全部保留
 */

const test = require('node:test');
const assert = require('node:assert');

const {
  parseAdbDevices,
  parseFastbootDevices,
  isEmulator,
} = require('../src/adb_parser');

test('V1.2.14 识别 Android SDK 模拟器（emulator- 前缀）', () => {
  assert.strictEqual(isEmulator('emulator-5554', ''), true);
  assert.strictEqual(isEmulator('emulator-5556', ''), true);
  assert.strictEqual(
    isEmulator('emulator-5556', 'product:sdk_gphone_x86_64 model:sdk_gphone_x86_64'),
    true,
  );
});

test('V1.2.14 识别国产模拟器（本地回环地址 + 端口）', () => {
  // 雷电、夜神、MuMu、逍遥等常见模拟器的 ADB 端口
  assert.strictEqual(isEmulator('127.0.0.1:5555', ''), true);
  assert.strictEqual(isEmulator('127.0.0.1:62001', ''), true);
  assert.strictEqual(isEmulator('localhost:7555', ''), true);
  assert.strictEqual(isEmulator('0.0.0.0:5555', ''), true);
});

test('V1.2.14 识别带模拟器指纹的 detail', () => {
  assert.strictEqual(isEmulator('somehost', 'device product:qemu model:QEMU'), true);
  assert.strictEqual(isEmulator('unknown', 'product:sdk_gphone_arm64'), true);
  assert.strictEqual(isEmulator('unknown', 'device:generic_x86_64'), true);
  assert.strictEqual(isEmulator('unknown', 'product:goldfish'), true);
  assert.strictEqual(isEmulator('unknown', 'device:ranchu'), true);
});

test('V1.2.14 真机不能被误伤：USB 设备', () => {
  // 用户实际用过的真机序列号
  assert.strictEqual(isEmulator('ZY22FNTV3M', 'product:rhodep model:XT2225-2'), false);
  assert.strictEqual(isEmulator('NGPAD80117', 'product:penang model:XT2335-3'), false);
  assert.strictEqual(isEmulator('ZY22F758S4', 'product:penang'), false);
});

test('V1.2.14 真机不能被误伤：无线调试（局域网地址）', () => {
  // 这是最关键的一条：真机的无线调试走局域网地址，绝不能和模拟器的回环地址混为一谈
  assert.strictEqual(isEmulator('192.168.1.100:5555', ''), false);
  assert.strictEqual(isEmulator('192.168.0.42:37123', ''), false);
  assert.strictEqual(isEmulator('10.0.0.5:5555', ''), false);
});

test('V1.2.14 parseAdbDevices 过滤掉模拟器、保留真机', () => {
  const output = [
    'List of devices attached',
    'emulator-5556          device product:sdk_gphone_x86_64 model:sdk_gphone_x86_64 transport_id:1',
    'ZY22FNTV3M            device product:rhodep model:XT2225-2 transport_id:2',
    '127.0.0.1:5555        device product:leidian model:LDPlayer',
    '192.168.1.100:5555    device product:penang model:XT2335-3',
    '',
  ].join('\n');

  const devices = parseAdbDevices(output);
  const serials = devices.map((d) => d.serial);

  assert.deepStrictEqual(serials, ['ZY22FNTV3M', '192.168.1.100:5555']);
  assert.ok(!serials.includes('emulator-5556'), 'SDK 模拟器必须被过滤');
  assert.ok(!serials.includes('127.0.0.1:5555'), '回环模拟器必须被过滤');
});

test('V1.2.14 过滤后第一个设备一定是真机（投屏/安装取首个设备）', () => {
  const output = [
    'List of devices attached',
    'emulator-5556          device product:sdk_gphone_x86_64',
    'NGPAD80117            device product:penang model:XT2335-3',
    '',
  ].join('\n');

  const devices = parseAdbDevices(output);
  assert.strictEqual(devices.length, 1);
  assert.strictEqual(devices[0].serial, 'NGPAD80117');
});

test('V1.2.14 只有模拟器时返回空列表（界面显示未连接，而不是选中模拟器）', () => {
  const output = [
    'List of devices attached',
    'emulator-5554          device product:sdk_gphone_x86_64',
    '',
  ].join('\n');

  const devices = parseAdbDevices(output);
  assert.strictEqual(devices.length, 0);
});

test('V1.2.14 parseFastbootDevices 同样过滤模拟器', () => {
  const output = [
    'emulator-5554   fastboot usb:1-2',
    'ZY22FNTV3M      fastboot usb:2-1',
    '',
  ].join('\n');

  const devices = parseFastbootDevices(output);
  assert.strictEqual(devices.length, 1);
  assert.strictEqual(devices[0].serial, 'ZY22FNTV3M');
});

test('V1.2.14 空输入与异常输入不崩溃', () => {
  assert.deepStrictEqual(parseAdbDevices(''), []);
  assert.deepStrictEqual(parseAdbDevices(null), []);
  assert.deepStrictEqual(parseAdbDevices('List of devices attached\n'), []);
  assert.deepStrictEqual(parseFastbootDevices(''), []);
  assert.strictEqual(isEmulator('', ''), false);
  assert.strictEqual(isEmulator(undefined, undefined), false);
});

test('V1.2.14 解析结果保留 state 与 detail（过滤不能破坏原有字段）', () => {
  const output = [
    'List of devices attached',
    'ZY22FNTV3M            device product:rhodep model:XT2225-2 device:rhodep transport_id:2',
    'ZY22F758S4            unauthorized usb:1-3',
    '',
  ].join('\n');

  const devices = parseAdbDevices(output);
  assert.strictEqual(devices.length, 2);

  const ready = devices.find((d) => d.serial === 'ZY22FNTV3M');
  assert.strictEqual(ready.state, 'device');
  assert.match(ready.detail, /model:XT2225-2/);
  assert.match(ready.detail, /transport_id:2/);

  const unauth = devices.find((d) => d.serial === 'ZY22F758S4');
  assert.strictEqual(unauth.state, 'unauthorized');
  assert.match(unauth.detail, /usb:1-3/);
});
