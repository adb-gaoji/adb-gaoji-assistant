const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const rendererSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf8');
const rendererHtml = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.html'), 'utf8');
const mainSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');

// ---------------------------------------------------------------------------
// 刷机过程提示文案
//
// 用户实测反馈：刷机过程中界面显示"准备中…"，看不出正在进行什么，
// 也不知道这时候能不能动线。刷机期间插拔数据线会直接中断写入，
// 是变砖的主要来源，因此文案必须明确说清"正在刷 + 别拔线"。
// ---------------------------------------------------------------------------

test('回归：刷机过程中不再显示"准备中"', () => {
  assert.ok(!rendererHtml.includes('准备中'), 'renderer.html 中不应再有"准备中"占位文案');
  assert.ok(!rendererSrc.includes('准备中'), 'renderer.js 中不应再有"准备中"文案');
});

test('刷机开始即提示"正在自动刷机，请不要插拔数据线"', () => {
  const fn = rendererSrc.slice(rendererSrc.indexOf('function resetFlashView'));
  const body = fn.slice(0, fn.indexOf('function updateFlashBar'));
  assert.ok(body.includes('正在自动刷机，请不要插拔数据线'), 'resetFlashView 必须设置刷机进行中的提示文案');
});

test('等待设备重连时同样提醒不要插拔数据线', () => {
  const idx = rendererSrc.indexOf("case 'waiting'");
  assert.ok(idx > -1, '应存在 waiting 阶段分支');
  const branch = rendererSrc.slice(idx, idx + 300);
  assert.ok(branch.includes('请不要插拔数据线'), 'waiting 阶段也要保留防拔线提醒（此时设备正在重启，最容易误拔）');
});

test('刷机完成文案区分"已自动重启"与"请手动开机"', () => {
  assert.ok(rendererSrc.includes('刷机完成，已自动重启开机'), '自动重启成功时应提示已自动开机');
  assert.ok(rendererSrc.includes('刷机完成，请手动开机'), '未自动重启时应明确让用户手动开机，避免以为没刷成功');
});

test('新增 rebooting 阶段文案，让用户知道正在开机', () => {
  assert.ok(rendererSrc.includes("case 'rebooting'"), 'renderer.js 应处理 rebooting 阶段');
  assert.ok(rendererSrc.includes('正在自动重启开机'), '应提示正在自动重启开机');
});

// ---------------------------------------------------------------------------
// 刷机完成后自动重启
//
// 用户实测反馈：固件刷完设备停在 Fastboot 不动，以为"刷完不开机"。
// 多数固件包 XML 结尾并没有 reboot / continue 操作，因此需要在全部
// 命令成功后主动发一次 reboot。
// ---------------------------------------------------------------------------

test('刷机成功且设备仍在 Fastboot 时自动发送 reboot', () => {
  assert.ok(mainSrc.includes('firmware-flash'), 'main.js 应包含固件刷机处理');
  assert.ok(/if \(!failed\.length && !stoppedAt && !leftFastboot\)/.test(mainSrc),
    '自动重启必须仅在"无失败、未中止、设备仍在 Fastboot"时触发');
  assert.ok(mainSrc.includes("'reboot'], { log: flashLog, timeoutMs: 60000 }"), '应实际下发 fastboot reboot 命令');
  assert.ok(mainSrc.includes('autoRebooted'), '应记录是否执行了自动重启，供界面与结果文案使用');
});

test('自动重启只在成功路径触发，失败时保留 Fastboot 便于排查', () => {
  const rebootIdx = mainSrc.indexOf('let autoRebooted = false;');
  const failReturnIdx = mainSrc.indexOf('固件刷机未完成');
  assert.ok(rebootIdx > -1, '应存在自动重启逻辑');
  assert.ok(failReturnIdx > -1, '应存在失败返回分支');
  assert.ok(rebootIdx < failReturnIdx, '自动重启应位于成功路径（失败分支之前），失败时不自动拉起设备');
});

test('固件脚本自带重启时不再重复发送 reboot', () => {
  assert.ok(mainSrc.includes('固件脚本已包含重启命令'), 'XML 已含 reboot/continue 时应走另一条分支，不重复重启');
});

test('自动重启失败不影响刷机结论，并给出手动开机指引', () => {
  assert.ok(mainSrc.includes('自动重启失败'), '重启失败应记录但不改变刷机成功结论');
  assert.ok(mainSrc.includes('请长按电源键手动开机'), '重启失败时应告诉用户如何手动开机');
});
