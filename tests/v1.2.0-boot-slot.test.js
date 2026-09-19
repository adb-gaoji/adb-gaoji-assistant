const assert = require('node:assert/strict');
const test = require('node:test');
const {
  hasSlotSuffix,
  normalizeSlot,
  resolvePartitionName,
  validatePartitionName,
  resolveFlashTarget
} = require('../src/slot_resolver');

test('hasSlotSuffix 只认结尾的 _a / _b', () => {
  assert.equal(hasSlotSuffix('boot_a'), true);
  assert.equal(hasSlotSuffix('boot_b'), true);
  assert.equal(hasSlotSuffix('init_boot_a'), true);
  assert.equal(hasSlotSuffix('boot'), false);
  // 这条是回归用例：vbmeta 以 a 结尾，但不是槽位后缀，
  // 早期用 /[ab]$/ 判断会把它误认成带后缀，导致拼不出 vbmeta_a。
  assert.equal(hasSlotSuffix('vbmeta'), false);
  assert.equal(hasSlotSuffix('system'), false);
  assert.equal(hasSlotSuffix(''), false);
});

test('normalizeSlot 只接受 a / b，其余归为不带后缀', () => {
  assert.equal(normalizeSlot('a'), 'a');
  assert.equal(normalizeSlot('B'), 'b');
  assert.equal(normalizeSlot(' b '), 'b');
  assert.equal(normalizeSlot('none'), '');
  assert.equal(normalizeSlot('current'), '');
  assert.equal(normalizeSlot(undefined), '');
  assert.equal(normalizeSlot(null), '');
});

test('resolvePartitionName 按规则拼装槽位后缀', () => {
  assert.equal(resolvePartitionName('boot', 'a'), 'boot_a');
  assert.equal(resolvePartitionName('boot', 'b'), 'boot_b');
  assert.equal(resolvePartitionName('init_boot', 'b'), 'init_boot_b');
  // 槽位为空 -> 裸名字（单槽机型）
  assert.equal(resolvePartitionName('boot', ''), 'boot');
  assert.equal(resolvePartitionName('boot', 'none'), 'boot');
  // 已带后缀 -> 原样返回，不重复拼接
  assert.equal(resolvePartitionName('boot_a', 'b'), 'boot_a');
  assert.equal(resolvePartitionName('system_b', 'a'), 'system_b');
  // 空分区名
  assert.equal(resolvePartitionName('', 'a'), '');
  assert.equal(resolvePartitionName(null, 'a'), '');
});

test('validatePartitionName 拦下空值与非法字符', () => {
  assert.equal(validatePartitionName('boot_a').valid, true);
  assert.equal(validatePartitionName('init_boot').valid, true);

  assert.equal(validatePartitionName('').valid, false);
  assert.equal(validatePartitionName('   ').valid, false);
  assert.equal(validatePartitionName('boot a').valid, false);
  assert.equal(validatePartitionName('boot;a').valid, false);
  assert.equal(validatePartitionName('boot/../x').valid, false);
  // 单独一个 _a 不是合法分区
  assert.equal(validatePartitionName('_a').valid, false);
  assert.equal(validatePartitionName('a'.repeat(80)).valid, false);
});

test('resolveFlashTarget 用当前活动槽位解析 current', () => {
  const result = resolveFlashTarget({
    partition: 'boot',
    slot: 'current',
    device: { isAbDevice: true, currentSlot: 'b' }
  });
  assert.equal(result.blocked, '');
  assert.equal(result.partition, 'boot_b');
  assert.equal(result.targetIsOtherSlot, false);
  assert.match(result.notes.join('\n'), /当前活动槽位/);
});

test('resolveFlashTarget 读不到槽位时拦下 current 而不是猜', () => {
  const result = resolveFlashTarget({
    partition: 'boot',
    slot: 'current',
    device: { isAbDevice: true, currentSlot: '' }
  });
  // 关键：不能默认落到 'a'，必须让用户明确选择
  assert.notEqual(result.blocked, '');
  assert.match(result.blocked, /未能读取设备当前活动槽位/);
});

test('resolveFlashTarget 在单槽机型上拒绝槽位后缀', () => {
  const result = resolveFlashTarget({
    partition: 'boot',
    slot: 'a',
    device: { isAbDevice: false, currentSlot: '' }
  });
  assert.match(result.blocked, /不是 A\/B 双槽机型/);
});

test('resolveFlashTarget 写向非活动槽时给出明确提醒', () => {
  const result = resolveFlashTarget({
    partition: 'boot',
    slot: 'b',
    device: { isAbDevice: true, currentSlot: 'a' }
  });
  assert.equal(result.blocked, '');
  assert.equal(result.partition, 'boot_b');
  assert.equal(result.targetIsOtherSlot, true);
  assert.match(result.notes.join('\n'), /切换启动槽位/);
});

test('resolveFlashTarget 写向当前槽时不再警告', () => {
  const result = resolveFlashTarget({
    partition: 'boot',
    slot: 'a',
    device: { isAbDevice: true, currentSlot: 'a' }
  });
  assert.equal(result.targetIsOtherSlot, false);
  assert.match(result.notes.join('\n'), /与当前活动槽位一致/);
});

test('resolveFlashTarget 用设备分区清单提前拦下不存在的分区', () => {
  const result = resolveFlashTarget({
    partition: 'vendor_boot',
    slot: 'a',
    device: { isAbDevice: true, currentSlot: 'a', available: ['boot_a', 'boot_b', 'init_boot_a', 'init_boot_b'] }
  });
  assert.match(result.blocked, /不存在分区 vendor_boot_a/);
  assert.match(result.blocked, /boot_a/);
});

test('resolveFlashTarget 对存在的分区放行', () => {
  const result = resolveFlashTarget({
    partition: 'boot',
    slot: 'a',
    device: { isAbDevice: true, currentSlot: 'a', available: ['boot_a', 'boot_b'] }
  });
  assert.equal(result.blocked, '');
  assert.equal(result.partition, 'boot_a');
});

test('resolveFlashTarget 单槽机型且不带后缀时正常放行', () => {
  const result = resolveFlashTarget({
    partition: 'boot',
    slot: 'none',
    device: { isAbDevice: false, currentSlot: '' }
  });
  assert.equal(result.blocked, '');
  assert.equal(result.partition, 'boot');
});
