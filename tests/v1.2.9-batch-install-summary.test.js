const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createActionHandlers } = require('../src/action_handlers');

/**
 * 批量安装的可读性回归。
 *
 * 用户实测反馈：一批装了 4 个包，日志里只有
 *   Congou_3.329.apk：成功
 *   Tea.Green_2.1.336.apk：成功
 * 看不到"一共几个、成了几个"，装到一半也不知道还剩几个。
 *
 * 因此固定两条不变量：
 *   1. 多个包时必须给出 进度(第几个/共几个) 和 汇总(成功N个/失败M个)；
 *   2. 只装一个包时不显示这些多余信息，保持原来的简洁输出。
 */

function createContext(records) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gaoji-batch-'));
  return {
    dir,
    ctx: {
      app: { getPath: () => dir }, dialog: {}, shell: {},
      adb: async (args) => {
        records.push(args);
        if (args[0] === 'devices') {
          return { code: 0, stdout: 'List of devices attached\nSERIAL\tdevice product:test\n', stderr: '' };
        }
        return { code: 0, stdout: 'Success', stderr: '' };
      },
      fastboot: async () => ({ code: 0, stdout: '', stderr: '' }),
      runProcess: async () => ({ code: 0, stdout: '', stderr: '' }),
      spawnProcess: () => ({ pid: 1, unref() {}, kill() {}, on() {} }),
      sendLog: () => {},
      getResourceRoot: () => dir,
      getMainWindow: () => null, getStatus: async () => ({}), getSelectedFirmware: () => null,
      lines: (v) => String(v || '').split(/\r?\n/).filter(Boolean),
      uniqueOutputPath: (_d, n) => n
    }
  };
}

/** 造几个假的 .apk（内容为空即可——安装逻辑不解析它）。 */
function makeApks(dir, names) {
  return names.map((name) => {
    const p = path.join(dir, name);
    fs.writeFileSync(p, '');
    return p;
  });
}

test('批量安装：输出包含每个文件名、进度序号和总数汇总', async () => {
  const records = [];
  const { dir, ctx } = createContext(records);
  const files = makeApks(dir, ['Congou_3.329.apk', 'Tea.Green_2.1.336.apk', 'TeaLeaf_30.540.apk']);
  const handlers = createActionHandlers(ctx);
  const result = await handlers['install-batch-paths']({ paths: files, label: '批量安装' });
  assert.equal(result.code, 0);
  for (const name of ['Congou_3.329.apk', 'Tea.Green_2.1.336.apk', 'TeaLeaf_30.540.apk']) {
    assert.ok(result.stdout.includes(name), `汇总里应包含文件名 ${name}`);
  }
  assert.match(result.stdout, /批量安装完成/, '应有完成汇总');
  assert.match(result.stdout, /安装成功/, '每个包应给出安装结论');
  assert.match(result.stdout, /共 3 个/, '汇总应给出总数');
  assert.match(result.stdout, /成功 3 个/, '汇总应给出成功数');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('批量安装：给出了进度序号（第几个/共几个）', async () => {
  const records = [];
  const { dir, ctx } = createContext(records);
  const files = makeApks(dir, ['a.apk', 'b.apk']);
  const logs = [];
  ctx.sendLog = (m) => logs.push(String(m));
  const handlers = createActionHandlers(ctx);
  await handlers['install-batch-paths']({ paths: files, label: '批量安装' });
  const text = logs.join('');
  assert.match(text, /1\/2/, '应显示第 1 个/共 2 个');
  assert.match(text, /2\/2/, '应显示第 2 个/共 2 个');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('单个安装：不显示多余的总数汇总，保持简洁', async () => {
  const records = [];
  const { dir, ctx } = createContext(records);
  const files = makeApks(dir, ['only.apk']);
  const handlers = createActionHandlers(ctx);
  const result = await handlers['install-batch-paths']({ paths: files, label: '单个安装' });
  assert.equal(result.code, 0);
  assert.ok(result.stdout.includes('only.apk'), '仍应包含文件名');
  assert.doesNotMatch(result.stdout, /共 1 个/, '单个包不应显示总数汇总');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('批量安装：失败的包计入失败数，整体退出码为 1', async () => {
  const records = [];
  const { dir, ctx } = createContext(records);
  const files = makeApks(dir, ['good.apk', 'bad.apk']);
  let n = 0;
  ctx.adb = async (args) => {
    if (args[0] === 'devices') return { code: 0, stdout: 'List of devices attached\nSERIAL\tdevice product:test\n', stderr: '' };
    n += 1;
    // 第二个安装命令失败
    return n === 2 ? { code: 1, stdout: '', stderr: 'INSTALL_FAILED_INVALID_APK' } : { code: 0, stdout: 'Success', stderr: '' };
  };
  const handlers = createActionHandlers(ctx);
  const result = await handlers['install-batch-paths']({ paths: files, label: '批量安装' });
  assert.equal(result.code, 1, '有失败时退出码应为 1');
  assert.match(result.stdout, /失败 1 个/, '汇总应给出失败数');
  fs.rmSync(dir, { recursive: true, force: true });
});
