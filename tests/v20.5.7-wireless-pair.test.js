const assert = require('node:assert/strict');
const test = require('node:test');
const { createActionHandlers, parseWirelessPairingRequest } = require('../src/action_handlers');
const { auditWirelessPairing } = require('../scripts/audit-wireless-pair');

test('wireless pairing keeps pairing and connection ports separate', () => {
  assert.deepEqual(parseWirelessPairingRequest({
    host: '192.168.1.88', pairPort: '37123', connectPort: '5555', pairingCode: '123456'
  }), {
    host: '192.168.1.88',
    pairing: { host: '192.168.1.88', port: 37123, serial: '192.168.1.88:37123' },
    connection: { host: '192.168.1.88', port: 5555, serial: '192.168.1.88:5555' },
    pairingCode: '123456'
  });
  assert.equal(parseWirelessPairingRequest({ host: '192.168.1.88', pairPort: '37123', pairingCode: '12345' }), null);
  assert.equal(parseWirelessPairingRequest({ host: '192.168.1.88', pairPort: '65536', pairingCode: '123456' }), null);
});

test('V20.5.7 wireless pairing audit passes without opening Electron', () => {
  const report = auditWirelessPairing();
  assert.equal(report.version, 'V20.5.7');
  assert.equal(report.status, 'pass');
  assert.equal(report.findings.length, 0);
});

test('wireless pairing mock runs adb pair before the separate connect endpoint', async () => {
  const calls = [];
  const adb = async (args) => {
    calls.push(args);
    return { code: 0, stdout: args[0] === 'pair' ? 'Successfully paired' : 'connected', stderr: '' };
  };
  const handlers = createActionHandlers({
    app: { getPath: () => 'C:\\Temp' }, dialog: {}, shell: {}, adb,
    fastboot: async () => ({ code: 0, stdout: '', stderr: '' }),
    runProcess: async () => ({ code: 0, stdout: '', stderr: '' }), sendLog: () => {},
    getResourceRoot: () => 'C:\\Temp', getMainWindow: () => null,
    getStatus: async () => ({}), getSelectedFirmware: () => null,
    lines: (value) => String(value || '').split(/\r?\n/).filter(Boolean),
    uniqueOutputPath: (_dir, name) => name
  });
  const result = await handlers['wireless-pair']({
    host: '192.168.1.88', pairPort: '37123', connectPort: '5555', pairingCode: '123456'
  });
  assert.equal(result.code, 0);
  assert.deepEqual(calls, [
    ['pair', '192.168.1.88:37123', '123456'],
    ['connect', '192.168.1.88:5555']
  ]);
  assert.equal(result.data.connectionSerial, '192.168.1.88:5555');
});
