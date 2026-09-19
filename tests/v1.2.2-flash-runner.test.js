const assert = require('node:assert/strict');
const test = require('node:test');
const {
  KIND,
  classifyCommand,
  describeCommand,
  computeTimeout,
  analyzeResult,
  needsDeviceWait,
  leavesFastboot,
  progressLine,
  formatOutput,
  outputReportsFailure
} = require('../src/flash_runner');

test('classifyCommand 识别各类型命令', () => {
  assert.equal(classifyCommand(['flash', 'boot_a', 'x.img']), KIND.FLASH);
  assert.equal(classifyCommand(['erase', 'userdata']), KIND.ERASE);
  assert.equal(classifyCommand(['getvar', 'max-download-size']), KIND.GETVAR);
  assert.equal(classifyCommand(['reboot-bootloader']), KIND.REBOOT_BOOTLOADER);
  assert.equal(classifyCommand(['reboot']), KIND.REBOOT);
  assert.equal(classifyCommand(['continue']), KIND.CONTINUE);
  assert.equal(classifyCommand(['--set-active=a']), KIND.SET_ACTIVE);
  assert.equal(classifyCommand(['oem', 'something']), KIND.OTHER);
  assert.equal(classifyCommand([]), KIND.OTHER);
});

test('describeCommand 生成可读标签', () => {
  assert.equal(describeCommand(['flash', 'boot_a', 'boot.img']), '刷写 boot_a');
  assert.equal(describeCommand(['erase', 'userdata']), '清除 userdata');
  assert.equal(describeCommand(['reboot-bootloader']), '重启到 Bootloader');
  assert.equal(describeCommand(['--set-active=b']), '切换活动槽 b');
});

test('computeTimeout 按镜像体积放大超时', () => {
  const small = computeTimeout(['flash', 'boot_a', 'x.img'], { fileSizeBytes: 8 * 1024 * 1024 });
  const large = computeTimeout(['flash', 'super', 'x.img'], { fileSizeBytes: 2 * 1024 * 1024 * 1024 });
  assert.ok(large > small, `大镜像超时应更长：${large} vs ${small}`);
  // 2GB 按 4MB/s 约需 500 秒，加缓冲后应超过 500 秒
  assert.ok(large > 500000, `2GB 镜像超时过短：${large}`);
  // 上限保护
  assert.ok(large <= 1800000, `超时不应超过上限：${large}`);
});

test('computeTimeout 对不同命令类型给出不同超时', () => {
  const getvar = computeTimeout(['getvar', 'all']);
  const erase = computeTimeout(['erase', 'userdata']);
  const reboot = computeTimeout(['reboot']);
  assert.ok(getvar < erase, 'getvar 应比 erase 快');
  assert.ok(reboot < erase, 'reboot 应比 erase 快');
  // 拿不到体积时 flash 给保守值
  assert.equal(computeTimeout(['flash', 'boot', 'x.img']), 300000);
});

test('analyzeResult：退出码 0 且无失败输出 -> 成功', () => {
  const result = { code: 0, stdout: "Sending 'boot_a' (65536 KB) OKAY [ 1.2s]\nWriting 'boot_a' OKAY [ 0.5s]", stderr: '' };
  const outcome = analyzeResult(['flash', 'boot_a', 'x.img'], result);
  assert.equal(outcome.ok, true);
  assert.equal(outcome.fatal, false);
});

test('回归：退出码 0 但输出 FAILED 必须判定为失败', () => {
  // 这是"刷机显示成功实际没刷成"的核心场景：
  // fastboot 进程正常退出（退出码 0），但输出里明确报告了失败。
  const cases = [
    "Sending 'boot_a' (65536 KB) FAILED!",
    "FAILED (remote: 'unknown partition')",
    'fastboot: error: cannot load boot.img',
    'Writing boot_a FAILED (remote: Write to device failed)',
    "Couldn't parse partition size '0x'",
    'error: no devices found'
  ];
  for (const text of cases) {
    const outcome = analyzeResult(['flash', 'boot_a', 'x.img'], { code: 0, stdout: text, stderr: '' });
    assert.equal(outcome.ok, false, `应判定失败：${text}`);
    assert.equal(outcome.fatal, true, `flash 失败应中止：${text}`);
  }
});

test('analyzeResult：flash 失败必须中止流程', () => {
  const outcome = analyzeResult(['flash', 'system', 'x.img'], {
    code: 1, stdout: "FAILED (remote: 'not enough space')", stderr: ''
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.fatal, true);
});

test('analyzeResult：getvar 失败不阻断刷机', () => {
  // 官方 XML 常用 getvar 做校验；变量不存在不代表刷机有问题
  const outcome = analyzeResult(['getvar', 'max-download-size'], {
    code: 0, stdout: "getvar:max-download-size FAILED (remote: 'GetVar Variable Not found')", stderr: ''
  });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.fatal, false, 'getvar 失败不应中止刷机');
});

test('analyzeResult：reboot 失败不阻断流程', () => {
  const outcome = analyzeResult(['reboot'], { code: 1, stdout: 'error: something', stderr: '' });
  assert.equal(outcome.fatal, false, '重启失败不该把整个刷机判为失败');
});

test('analyzeResult：erase 失败必须中止', () => {
  const outcome = analyzeResult(['erase', 'userdata'], { code: 1, stdout: 'FAILED', stderr: '' });
  assert.equal(outcome.fatal, true);
});

test('analyzeResult：set-active 失败必须中止', () => {
  const outcome = analyzeResult(['--set-active=b'], { code: 1, stdout: 'FAILED', stderr: '' });
  assert.equal(outcome.fatal, true, '槽位切换失败必须停下，否则可能启动到旧槽');
});

test('analyzeResult：超时判定为失败且可重试', () => {
  const outcome = analyzeResult(['flash', 'super', 'x.img'], { code: 124, stdout: '', stderr: '命令执行超过 600000ms，已终止。' });
  assert.equal(outcome.ok, false);
  assert.equal(outcome.retryable, true, '超时通常由传输慢导致，值得重试');
  assert.match(outcome.reason, /超时/);
});

test('analyzeResult：进程被终止判定为失败', () => {
  const outcome = analyzeResult(['flash', 'boot', 'x.img'], { code: 9009, stdout: '', stderr: '进程被终止（信号 SIGTERM）' });
  assert.equal(outcome.ok, false);
  assert.match(outcome.reason, /终止/);
});

test('analyzeResult：传输层抖动可重试，配置错误不可重试', () => {
  const flaky = analyzeResult(['flash', 'boot_a', 'x.img'], { code: 0, stdout: 'FAILED (remote: Write to device failed)', stderr: '' });
  assert.equal(flaky.retryable, true, 'USB 写入失败值得重试');

  const configError = analyzeResult(['flash', 'boot_a', 'x.img'], { code: 0, stdout: "FAILED (remote: 'unknown partition')", stderr: '' });
  assert.equal(configError.retryable, false, '分区名错误重试无用');

  const missingFile = analyzeResult(['flash', 'boot_a', 'x.img'], { code: 0, stdout: "error: cannot load 'x.img'", stderr: '' });
  assert.equal(missingFile.retryable, false, '镜像缺失重试无用');
});

test('analyzeResult 给出可读的失败原因', () => {
  const outcome = analyzeResult(['flash', 'boot_a', 'x.img'], {
    code: 0, stdout: "Sending 'boot_a' OKAY\nFAILED (remote: 'unknown partition')", stderr: ''
  });
  assert.match(outcome.reason, /unknown partition/);
});

test('needsDeviceWait 只在 reboot-bootloader 后为真', () => {
  assert.equal(needsDeviceWait(['reboot-bootloader']), true);
  assert.equal(needsDeviceWait(['reboot']), false);
  assert.equal(needsDeviceWait(['flash', 'boot', 'x.img']), false);
});

test('leavesFastboot 识别会让设备离开 fastboot 的命令', () => {
  assert.equal(leavesFastboot(['reboot']), true);
  assert.equal(leavesFastboot(['continue']), true);
  assert.equal(leavesFastboot(['reboot-bootloader']), false, 'reboot-bootloader 后仍在 fastboot');
  assert.equal(leavesFastboot(['flash', 'boot', 'x.img']), false);
});

test('progressLine 生成 N/M 格式的进度行', () => {
  assert.equal(progressLine(0, 27, ['getvar', 'all']), '[1/27] 读取变量 all');
  assert.equal(progressLine(6, 27, ['flash', 'boot_a', 'x.img']), '[7/27] 刷写 boot_a');
});

test('formatOutput 整理 fastboot 输出为缩进文本', () => {
  const text = formatOutput({ stdout: "Sending 'boot_a' OKAY\r\n\r\nWriting 'boot_a' OKAY\r", stderr: '' });
  assert.equal(text, "      Sending 'boot_a' OKAY\n      Writing 'boot_a' OKAY");
  assert.equal(formatOutput({ stdout: '', stderr: '' }), '');
});

test('outputReportsFailure 识别失败标记', () => {
  assert.equal(outputReportsFailure({ stdout: 'FAILED', stderr: '' }), true);
  assert.equal(outputReportsFailure({ stdout: 'OKAY [ 0.5s]', stderr: '' }), false);
  assert.equal(outputReportsFailure({ stdout: '', stderr: 'error: no devices found' }), true);
  assert.equal(outputReportsFailure({}), false);
});

test('回归：设备掉线时的 waiting for any device 判定为失败且可重试', () => {
  // 真机实测：设备不在 fastboot 时 fastboot 打印这一行后**永久挂起**，
  // 直到被超时终止。旧代码刷机没有传超时，会一直卡住。
  const hanging = { code: 124, stdout: '', stderr: '< waiting for any device >' };
  const outcome = analyzeResult(['flash', 'boot_a', 'x.img'], hanging);
  assert.equal(outcome.ok, false, '应判定失败');
  assert.equal(outcome.fatal, true, 'flash 阶段设备掉线必须中止');
  assert.equal(outcome.retryable, true, 'USB 接触问题重试一次有意义');
  // 原因应指向"设备不在 Fastboot"，而不是笼统的"超时"——
  // 后者会让用户去查镜像，而真正的问题是数据线。
  assert.match(outcome.reason, /不在 Fastboot/);
});

test('回归：进程被终止（code 9009）不能被当成成功', () => {
  // runProcess 此前写 `code ?? 0`，把 code 为 null 的异常终止判成成功。
  // 这里固定住"异常终止必须失败"这一不变量。
  const killed = { code: 9009, stdout: '', stderr: '进程被终止（信号 SIGTERM），未能正常结束。' };
  const outcome = analyzeResult(['flash', 'super', 'x.img'], killed);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.fatal, true);
});
