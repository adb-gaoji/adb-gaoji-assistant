const assert = require('node:assert/strict');
const test = require('node:test');
const {
  RAMDISK_PARTITION_CANDIDATES,
  pickRamdiskPartition,
  deviceHasPartition,
  parsePartitionSize,
  parseCurrentSlot
} = require('../src/slot_resolver');

// 真机实测：摩托罗拉 XT2241-1（Android 14）在 fastboot 里的真实返回。
// 注意它**没有 init_boot**，尽管系统是 Android 14。
const REAL_BOOT_A = 'partition-size:boot_a: 0x0000000006000000  Finished. Total time: 0.021s';
const REAL_INIT_BOOT_A = 'partition-size:init_boot_a:                  Finished. Total time: 0.001s';
const REAL_INIT_BOOT = 'partition-size:init_boot:                    Finished. Total time: 0.001s';
const REAL_VENDOR_BOOT_A = 'partition-size:vendor_boot_a: 0x0000000006000000  Finished. Total time: 0.020s';

test('parsePartitionSize：有 0x 大小视为存在', () => {
  const r = parsePartitionSize(REAL_BOOT_A);
  assert.equal(r.exists, true);
  assert.equal(r.bytes, 0x06000000);
});

test('回归：不存在的分区没有 FAILED，只有空值——必须判为不存在', () => {
  // 这是本次的关键修复点。旧逻辑只查 FAILED/error 关键字，
  // 而 fastboot 对不存在的分区回的是**空值**，于是被误判为"存在"，
  // 把一个不存在的分区提供给用户去刷，结果是
  // `Writing 'init_boot_a' (bootloader) Invalid partition name init_boot_a`。
  const a = parsePartitionSize(REAL_INIT_BOOT_A);
  assert.equal(a.exists, false, 'init_boot_a 应判定为不存在');
  assert.equal(a.bytes, 0);

  const b = parsePartitionSize(REAL_INIT_BOOT);
  assert.equal(b.exists, false, 'init_boot 应判定为不存在');
});

test('parsePartitionSize：FAILED / not found 也算不存在', () => {
  assert.equal(parsePartitionSize('FAILED (remote: \'unknown partition\')').exists, false);
  assert.equal(parsePartitionSize('partition-size:xxx: not found').exists, false);
  assert.equal(parsePartitionSize('').exists, false);
  assert.equal(parsePartitionSize(null).exists, false);
});

test('parsePartitionSize：0x0 视为不存在', () => {
  // 大小为 0 的分区无法写入，按不存在处理
  assert.equal(parsePartitionSize('partition-size:foo: 0x0000000000000000').exists, false);
});

test('parseCurrentSlot：解析当前槽位', () => {
  assert.equal(parseCurrentSlot('current-slot: a'), 'a');
  assert.equal(parseCurrentSlot('current-slot: _b'), 'b');
  assert.equal(parseCurrentSlot('FAILED'), '');
  assert.equal(parseCurrentSlot(''), '');
});

test('deviceHasPartition：按基名匹配，忽略槽位后缀', () => {
  const parts = ['boot_a', 'boot_b', 'vendor_boot_a'];
  assert.equal(deviceHasPartition(parts, 'boot'), true);
  assert.equal(deviceHasPartition(parts, 'boot_a'), true);
  assert.equal(deviceHasPartition(parts, 'vendor_boot'), true);
  assert.equal(deviceHasPartition(parts, 'init_boot'), false);
  assert.equal(deviceHasPartition([], 'boot'), false);
});

test('回归：Android 14 但没有 init_boot 的机型应选 boot', () => {
  // 摩托罗拉 XT2241-1 的真实分区表
  const realDevice = [
    'boot_a', 'boot_b', 'vendor_boot_a', 'vendor_boot_b',
    'vbmeta_a', 'vbmeta_b', 'dtbo_a', 'dtbo_b',
    'recovery_a', 'recovery_b', 'super'
  ];
  const picked = pickRamdiskPartition(realDevice);
  assert.equal(picked.partition, 'boot', '没有 init_boot 时必须选 boot，不能按版本号猜 init_boot');
  assert.match(picked.source, /boot/);

  // 只列出设备上真实存在的候选，不能把 init_boot 摆给用户
  const offered = RAMDISK_PARTITION_CANDIDATES.filter((n) => deviceHasPartition(realDevice, n));
  assert.deepEqual(offered, ['boot', 'vendor_boot']);
  assert.ok(!offered.includes('init_boot'), '不应提供设备上不存在的 init_boot');
});

test('标准 GKI 机型（有 init_boot）仍优先选 init_boot', () => {
  const gki = ['boot_a', 'boot_b', 'init_boot_a', 'init_boot_b', 'vendor_boot_a', 'vendor_boot_b'];
  assert.equal(pickRamdiskPartition(gki).partition, 'init_boot');
});

test('只有 vendor_boot 的机型选 vendor_boot', () => {
  const only = ['vendor_boot_a', 'vendor_boot_b', 'vbmeta_a'];
  assert.equal(pickRamdiskPartition(only).partition, 'vendor_boot');
});

test('候选顺序体现优先级', () => {
  assert.deepEqual(RAMDISK_PARTITION_CANDIDATES, ['init_boot', 'boot', 'vendor_boot']);
});

test('空分区列表时不猜，返回空并说明', () => {
  const r = pickRamdiskPartition([]);
  assert.equal(r.partition, '');
  assert.match(r.source, /未能读取/);
});

test('三者都不存在时返回空并说明', () => {
  const r = pickRamdiskPartition(['super', 'vbmeta_a']);
  assert.equal(r.partition, '');
  assert.match(r.source, /未找到/);
});
