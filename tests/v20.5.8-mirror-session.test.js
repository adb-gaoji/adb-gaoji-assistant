const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const test = require('node:test');
const { createActionHandlers } = require('../src/action_handlers');
const { auditMirrorSession } = require('../scripts/audit-mirror-session');

function createContext(spawnProcess) {
  return {
    app: { getPath: () => 'C:\\Temp' }, dialog: {}, shell: {},
    adb: async (args) => args[0] === 'devices'
      ? { code: 0, stdout: 'List of devices attached\nSERIAL device product:test\n', stderr: '' }
      : { code: 0, stdout: '', stderr: '' },
    fastboot: async () => ({ code: 0, stdout: '', stderr: '' }),
    runProcess: async () => ({ code: 0, stdout: '', stderr: '' }), spawnProcess,
    sendLog: () => {}, getResourceRoot: () => path.resolve(__dirname, '..', 'resources'),
    getMainWindow: () => null, getStatus: async () => ({}), getSelectedFirmware: () => null,
    lines: (value) => String(value || '').split(/\r?\n/).filter(Boolean),
    uniqueOutputPath: (_dir, name) => name
  };
}

test('mirror session tracks running state, rejects duplicates and can stop', async () => {
  let child;
  const spawnProcess = () => {
    child = new EventEmitter();
    child.pid = 4321;
    child.unref = () => {};
    child.kill = () => { child.emit('exit', 0, null); return true; };
    queueMicrotask(() => child.emit('spawn'));
    return child;
  };
  const handlers = createActionHandlers(createContext(spawnProcess));
  const started = await handlers['start-mirror']({ serial: 'SERIAL' });
  assert.equal(started.code, 0);
  assert.equal(started.data.session.state, 'running');
  assert.equal(started.data.session.pid, 4321);

  const duplicate = await handlers['start-mirror']({ serial: 'SERIAL' });
  assert.equal(duplicate.code, 409);

  const stopped = await handlers['stop-mirror']({ serial: 'SERIAL' });
  assert.equal(stopped.code, 0);
  assert.equal(stopped.data.session.state, 'exited');
});

test('V20.5.8 mirror session audit passes without launching scrcpy', () => {
  const report = auditMirrorSession();
  assert.equal(report.version, 'V20.5.8');
  assert.equal(report.status, 'pass');
  assert.equal(report.findings.length, 0);
});

