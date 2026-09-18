/**
 * V1.0.0 关键回归测试。
 *
 * 这里覆盖的是本项目已经实际出过问题、或处于命令拼装安全边界的纯函数。
 * 目的是让这些行为一旦被改动就立刻失败，而不是等到发版后由用户发现。
 */
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  parseFirmwareXml, findFirmwareXml, listFirmwareXml, parseXmlAttributes, firmwareReport
} = require('../src/firmware_parser');
const { shellArg, parseWirelessEndpoint } = require('../src/action_handlers');
const { parseAdbDevices, parseFastbootDevices, lines } = require('../src/adb_parser');

/* ------------------------------------------------------------------ 工具 */

let tmpRoot = '';
function workdir() {
  if (!tmpRoot) tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gaoji-test-'));
  return tmpRoot;
}

/** 写一个临时固件 XML，返回其路径。 */
function writeXml(name, content) {
  const file = path.join(workdir(), name);
  fs.writeFileSync(file, content, 'utf8');
  return file;
}

/** 造一个真实存在的小镜像文件，供 flash 命令的缺失检查使用。 */
function writeImage(name) {
  const file = path.join(workdir(), name);
  fs.writeFileSync(file, 'image', 'utf8');
  return file;
}

process.on('exit', () => {
  if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
});

/* ------------------------------------------------- shellArg：命令拼装安全 */

test('shellArg wraps a command in single quotes', () => {
  assert.equal(shellArg('id'), "'id'");
  assert.equal(shellArg('pm list packages -3'), "'pm list packages -3'");
});

test('shellArg escapes embedded single quotes for a POSIX remote shell', () => {
  // 关键：adb 把 shell 之后的参数用空格拼接，不额外加引号，
  // 因此含单引号的命令必须转成 '\'' 形式，否则远程 shell 会提前闭合引号。
  assert.equal(shellArg("cat 'x'"), "'cat '\\''x'\\'''");
});

test('shellArg neutralises command separators by quoting them', () => {
  const quoted = shellArg('id; reboot');
  assert.equal(quoted, "'id; reboot'");
  // 分号位于单引号内部，远程 shell 不会把它当成命令分隔符。
  assert.ok(quoted.startsWith("'") && quoted.endsWith("'"));
});

test('shellArg treats empty and non-string input as an empty command', () => {
  assert.equal(shellArg(''), "''");
  assert.equal(shellArg(null), "''");
  assert.equal(shellArg(undefined), "''");
});

/* --------------------------------------- parseFirmwareXml：刷机包解析 */

test('parseFirmwareXml parses commands declared on <step> nodes', () => {
  // 回归：曾因跳过 <step> 标签导致 Motorola/Lenovo 官方包解析出 0 条命令。
  writeImage('boot.img');
  const xml = writeXml('flashfile.xml', `<?xml version="1.0" encoding="UTF-8"?>
<flashing>
  <header><phone_model model="XT2335-3"/></header>
  <steps interface="AP">
    <step operation="flash" partition="boot" filename="boot.img"/>
    <step operation="getvar" var="max-download-size"/>
    <step operation="oem" value="fb_mode_set"/>
    <step operation="reboot-bootloader"/>
  </steps>
</flashing>`);
  const parsed = parseFirmwareXml(xml);
  assert.equal(parsed.commands.length, 4);
  assert.deepEqual(parsed.commands[0].args.slice(0, 2), ['flash', 'boot']);
  assert.equal(parsed.commands[1].args[0], 'getvar');
  assert.equal(parsed.commands[1].args[1], 'max-download-size');
  assert.deepEqual(parsed.commands[2].args, ['oem', 'fb_mode_set']);
  assert.deepEqual(parsed.commands[3].args, ['reboot-bootloader']);
  assert.equal(parsed.xmlPath, xml);
});

test('parseFirmwareXml skips erase unless explicitly allowed', () => {
  writeImage('boot.img');
  const xml = writeXml('erase.xml', `<flashing><steps>
    <step operation="flash" partition="boot" filename="boot.img"/>
    <step operation="erase" partition="userdata"/>
    <step operation="erase" partition="metadata"/>
  </steps></flashing>`);

  const safe = parseFirmwareXml(xml);
  assert.equal(safe.commands.filter((c) => c.args[0] === 'erase').length, 0);
  assert.equal(safe.skipped.length, 2);
  assert.match(safe.skipped[0], /userdata/);

  const full = parseFirmwareXml(xml, true);
  assert.equal(full.commands.filter((c) => c.args[0] === 'erase').length, 2);
  assert.equal(full.skipped.length, 0);
});

test('parseFirmwareXml keeps the erase flag strictly opt-in', () => {
  writeImage('boot.img');
  const xml = writeXml('strict.xml', `<flashing><steps>
    <step operation="flash" partition="boot" filename="boot.img"/>
    <step operation="erase" partition="userdata"/>
  </steps></flashing>`);
  // 只有 true 才放行；其它真值写法一律按“未允许”处理，避免误清数据。
  for (const flag of [undefined, false, 1, 'true', null]) {
    const parsed = parseFirmwareXml(xml, flag);
    assert.equal(parsed.commands.filter((c) => c.args[0] === 'erase').length, 0, `flag=${flag}`);
  }
});

test('parseFirmwareXml resolves flash filenames relative to the XML folder', () => {
  writeImage('boot.img');
  const xml = writeXml('rel.xml', `<flashing><steps>
    <step operation="flash" partition="boot" filename="boot.img"/>
  </steps></flashing>`);
  const parsed = parseFirmwareXml(xml);
  assert.equal(parsed.commands[0].file, path.join(workdir(), 'boot.img'));
  assert.equal(parsed.commands[0].args[2], path.join(workdir(), 'boot.img'));
});

test('parseFirmwareXml maps set_active and continue variants', () => {
  writeImage('boot.img');
  const xml = writeXml('slot.xml', `<flashing><steps>
    <step operation="flash" partition="boot" filename="boot.img"/>
    <step operation="set_active" slot="_a"/>
    <step operation="continue"/>
    <step operation="reboot" target="bootloader"/>
  </steps></flashing>`);
  const parsed = parseFirmwareXml(xml);
  assert.deepEqual(parsed.commands[1].args, ['--set-active=a']);
  assert.deepEqual(parsed.commands[2].args, ['continue']);
  assert.deepEqual(parsed.commands[3].args, ['reboot', 'bootloader']);
});

test('parseFirmwareXml rejects an XML with no runnable command', () => {
  const xml = writeXml('empty.xml', '<flashing><steps></steps></flashing>');
  assert.throws(() => parseFirmwareXml(xml), /没有解析到可执行的 Fastboot 命令/);
});

test('parseXmlAttributes lowercases keys and accepts single quotes', () => {
  assert.deepEqual(parseXmlAttributes(' Operation="flash" PARTITION=\'boot\''), {
    operation: 'flash', partition: 'boot'
  });
});

test('firmwareReport reports missing images without throwing', () => {
  writeImage('boot.img');
  const xml = writeXml('report.xml', `<flashing><steps>
    <step operation="flash" partition="boot" filename="boot.img"/>
    <step operation="flash" partition="system" filename="absent.img"/>
  </steps></flashing>`);
  const report = firmwareReport(parseFirmwareXml(xml));
  assert.match(report, /可执行命令：2 条/);
  assert.match(report, /缺失镜像：1 个/);
  assert.match(report, /boot/);
});

test('findFirmwareXml prefers servicefile over flashfile', () => {
  const dir = fs.mkdtempSync(path.join(workdir(), 'fw-'));
  fs.writeFileSync(path.join(dir, 'flashfile.xml'), '<flashing/>', 'utf8');
  fs.writeFileSync(path.join(dir, 'servicefile.xml'), '<flashing/>', 'utf8');
  assert.equal(path.basename(findFirmwareXml(dir)), 'servicefile.xml');
  assert.equal(path.basename(findFirmwareXml(dir, 'flash')), 'flashfile.xml');
  assert.equal(listFirmwareXml(dir).length, 2);
});

/* -------------------------------------------- parseAdbDevices：设备列表 */

test('parseAdbDevices keeps the whole detail after state', () => {
  // 回归：曾用 split(/\s+/, 3)，JS 中第三个参数是截断上限，
  // 导致 detail 只剩 product:xxx，丢掉 model 与 transport_id。
  const parsed = parseAdbDevices(
    'List of devices attached\n'
    + 'NGPAD80117            device product:penang model:XT2335-3 device:penang transport_id:1\n'
    + 'ABC123                unauthorized usb:1-2\n'
    + '192.168.1.5:5555      device product:x model:y\n'
  );
  assert.equal(parsed.length, 3);
  assert.deepEqual(parsed[0], {
    serial: 'NGPAD80117', state: 'device',
    detail: 'product:penang model:XT2335-3 device:penang transport_id:1'
  });
  assert.equal(parsed[1].state, 'unauthorized');
  assert.equal(parsed[2].serial, '192.168.1.5:5555');
});

test('parseAdbDevices tolerates empty input, headers and missing detail', () => {
  assert.deepEqual(parseAdbDevices(''), []);
  assert.deepEqual(parseAdbDevices('List of devices attached\n'), []);
  assert.deepEqual(parseAdbDevices('SERIAL1  device\n'), [{ serial: 'SERIAL1', state: 'device', detail: '' }]);
});

test('parseFastbootDevices reports fastboot state and drops header lines', () => {
  const parsed = parseFastbootDevices('List of devices attached\nNGPAD80117            fastboot usb:1-2\n');
  assert.deepEqual(parsed, [{ serial: 'NGPAD80117', state: 'fastboot', detail: 'fastboot usb:1-2' }]);
});

test('lines splits CRLF and trims blank rows', () => {
  assert.deepEqual(lines('a\r\n\r\n  b  \n'), ['a', 'b']);
  assert.deepEqual(lines(null), []);
});

/* ---------------------------------------- parseWirelessEndpoint：地址校验 */

test('parseWirelessEndpoint accepts a valid IPv4 and port', () => {
  assert.deepEqual(parseWirelessEndpoint('192.168.1.88', 5555), {
    host: '192.168.1.88', port: 5555, serial: '192.168.1.88:5555'
  });
});

test('parseWirelessEndpoint rejects malformed or out-of-range addresses', () => {
  assert.equal(parseWirelessEndpoint('', 5555), null);
  assert.equal(parseWirelessEndpoint('999.1.1.1', 5555), null);
  assert.equal(parseWirelessEndpoint('192.168.1.88', 0), null);
  assert.equal(parseWirelessEndpoint('192.168.1.88', 65536), null);
});
