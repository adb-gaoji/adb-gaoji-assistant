const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const handlerSource = fs.readFileSync(path.join(root, 'src', 'action_handlers.js'), 'utf8');
const { parseWirelessEndpoint } = require('../src/action_handlers');
const { auditWirelessCast } = require('../scripts/audit-wireless-cast');

test('V20.5.6 wireless endpoint validation rejects malformed and out-of-range addresses', () => {
  assert.deepEqual(parseWirelessEndpoint('192.168.1.88', '5555'), {
    host: '192.168.1.88', port: 5555, serial: '192.168.1.88:5555'
  });
  assert.deepEqual(parseWirelessEndpoint('10.0.0.2', ''), {
    host: '10.0.0.2', port: 5555, serial: '10.0.0.2:5555'
  });
  assert.equal(parseWirelessEndpoint('999.1.1.1', 5555), null);
  assert.equal(parseWirelessEndpoint('192.168.1', 5555), null);
  assert.equal(parseWirelessEndpoint('192.168.1.88', 0), null);
  assert.equal(parseWirelessEndpoint('192.168.1.88', 65536), null);
});

test('wireless mirror requires the selected device and passes a concrete scrcpy serial', () => {
  assert.match(handlerSource, /handlers\['wireless-mirror'\][\s\S]*?requireSelectedAdb\(payload\)/);
  assert.match(handlerSource, /handlers\['wireless-mirror'\][\s\S]*?endpoint\.serial/);
  assert.match(handlerSource, /handlers\['wireless-mirror'\][\s\S]*?scrcpy\(\[\], '无线投屏', mirrorSerial\)/);
  assert.match(handlerSource, /const launchArgs = serial \? \['--serial', serial, \.\.\.args\] : args/);
});

test('V20.5.6 wireless cast audit passes without opening Electron', () => {
  const report = auditWirelessCast();
  assert.equal(report.version, 'V20.5.6');
  assert.equal(report.status, 'pass');
  assert.equal(report.findings.length, 0);
  assert.ok(report.checks.every((check) => check.passed));
});
