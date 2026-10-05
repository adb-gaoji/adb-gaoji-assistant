const assert = require('node:assert/strict');
const test = require('node:test');
const zlib = require('node:zlib');
const cpio = require('../src/cpio');
const lz4 = require('../src/lz4');
const bootImage = require('../src/boot_image');
const teaBuilder = require('../src/tea_builder');

/**
 * v1.2.13：Tea 制作的 vbmeta 让位与 AVB footer 重建。
 *
 * 背景（真实故障，不是假想）：
 *   Motorola 刷入前会做 preflash 校验，读的是镜像尾部 AVB footer 里声明的
 *   `original_image_size` / `vbmeta_offset`。Tea 核心比原厂 init 大得多，
 *   ramdisk 一变长就可能越过 vbmeta 的位置，把 vbmeta 覆盖掉、footer 声明
 *   的值也与实际不符，于是刷机被拒收（Preflash validation failed）。
 *
 *   G53/penang 原镜像的余量只有 2656 字节，移植后越界 1042415 字节 ——
 *   不做让位，这张镜像必然刷不进去。
 *
 *   另一个真实故障：早期 repack 返回的长度是 header+kernel+ramdisk，比原图短，
 *   尾部 AVB footer 直接被丢掉（G71S 那张成品尾部 64 字节全是 0）。
 *
 * 这里用合成镜像复现这两种情形，不依赖 480MB 真实模板库。
 */

/**
 * 造一张带 AVB footer 的 boot 镜像。
 * @param {number} slack vbmeta 起点相对 ramdisk 结束留多少余量（负数表示故意越界）
 */
function makeBootWithFooter({ slack = 4096, ramdiskEntries, totalSize = 1024 * 1024 } = {}) {
  const entries = ramdiskEntries || [
    { name: '.backup', mode: 0o040000, data: Buffer.alloc(0) },
    { name: 'init', mode: 0o120750, data: Buffer.from('/system/bin/init') },
    { name: 'system', mode: 0o040755, data: Buffer.alloc(0) },
  ];
  const cpioBuf = cpio.build(entries);
  const headerSize = 1584;
  const kernel = Buffer.alloc(16384, 0x41);
  const ALIGN = 4096;
  const align = (n) => Math.ceil(n / ALIGN) * ALIGN;

  const header = Buffer.alloc(headerSize + 4);
  header.write('ANDROID!', 0, 'ascii');
  header.writeUInt32LE(kernel.length, 8);
  header.writeUInt32LE(cpioBuf.length, 12);
  header.writeUInt32LE(0, 16);
  header.writeUInt32LE(headerSize, 20);
  header.writeUInt32LE(3, 40);

  const ramdiskOffset = align(header.length + kernel.length);
  const ramdiskEnd = ramdiskOffset + cpioBuf.length;
  // vbmeta 起点必须落在一个合法位置上：slack 为负时表示"新 ramdisk 会长到
  // 越过它"，所以这里取一个不小于 ramdisk 结束位置的值，靠后续把 ramdisk
  // 撑大来制造越界，而不是把偏移算成负数（负偏移无法写入 footer）。
  const vbmetaOffset = Math.max(ramdiskEnd, ramdiskEnd + slack);
  const vbmetaSize = 256;

  const out = Buffer.alloc(totalSize);
  header.copy(out, 0);
  kernel.copy(out, align(header.length));
  cpioBuf.copy(out, ramdiskOffset);

  // vbmeta：用可辨认的内容，便于断言它被整块搬走
  const vbmeta = Buffer.alloc(vbmetaSize, 0x5a);
  vbmeta.write('AVB0', 0, 'ascii');
  if (vbmetaOffset >= 0 && vbmetaOffset + vbmetaSize <= totalSize - 64) vbmeta.copy(out, vbmetaOffset);

  // AVB footer（大端）
  const footer = Buffer.alloc(64);
  footer.write('AVBf', 0, 'ascii');
  footer.writeUInt32BE(1, 4);
  footer.writeUInt32BE(0, 8);
  footer.writeBigUInt64BE(BigInt(vbmetaOffset), 12);
  footer.writeBigUInt64BE(BigInt(vbmetaOffset), 20);
  footer.writeBigUInt64BE(BigInt(vbmetaSize), 28);
  footer.copy(out, totalSize - 64);

  return { buffer: out, vbmetaOffset, vbmetaSize, ramdiskOffset, ramdiskEnd, totalSize };
}

test('正常情况：余量充足时 vbmeta 原地不动', () => {
  const made = makeBootWithFooter({ slack: 65536 });
  const parsed = bootImage.parse(made.buffer);
  const newRamdisk = made.buffer.subarray(made.ramdiskOffset, made.ramdiskEnd);
  const built = bootImage.repackPreservingAvb(made.buffer, parsed, newRamdisk);

  assert.equal(built.moved, false, '不该发生让位');
  assert.equal(built.buffer.length, made.totalSize, '总长必须保持不变');
  const footer = bootImage.parseAvbFooter(built.buffer);
  assert.equal(footer.vbmetaOffset, made.vbmetaOffset, 'vbmeta 应留在原处');
  assert.ok(built.buffer.subarray(made.vbmetaOffset, made.vbmetaOffset + 4).toString('ascii') === 'AVB0', 'vbmeta 内容应在原位');
});

test('越界情况：vbmeta 必须后移，且 footer 偏移同步改写', () => {
  // vbmeta 紧贴 ramdisk 结束（余量 0），随后把 ramdisk 撑大 600KB 即越界
  const made = makeBootWithFooter({ slack: 0 });
  const parsed = bootImage.parse(made.buffer);
  const bigger = Buffer.concat([made.buffer.subarray(made.ramdiskOffset, made.ramdiskEnd), Buffer.alloc(1024 * 600, 0x7f)]);
  const built = bootImage.repackPreservingAvb(made.buffer, parsed, bigger);

  assert.equal(built.moved, true, '应当发生让位');
  assert.equal(built.buffer.length, made.totalSize, '总长必须保持不变');

  const footer = bootImage.parseAvbFooter(built.buffer);
  const newRamdiskEnd = parsed.ramdiskOffset + bigger.length;
  assert.ok(footer.vbmetaOffset >= newRamdiskEnd, 'vbmeta 必须落在 ramdisk 之后');
  assert.ok(built.buffer.subarray(footer.vbmetaOffset, footer.vbmetaOffset + 4).toString('ascii') === 'AVB0', 'vbmeta 内容应已被搬到新位置');

  // footer 里 offset 12 与 20 两个字段都必须是新位置
  const foot = built.buffer.subarray(built.buffer.length - 64);
  assert.equal(Number(foot.readBigUInt64BE(12)), footer.vbmetaOffset, 'footer 偏移 12 应同步');
  assert.equal(Number(foot.readBigUInt64BE(20)), footer.vbmetaOffset, 'footer 偏移 20 应同步');
});

test('重建后总长与原图一致（早期版本会丢尾部 AVB footer）', () => {
  const made = makeBootWithFooter({ slack: 8192, totalSize: 4 * 1024 * 1024 });
  const parsed = bootImage.parse(made.buffer);
  const newRamdisk = made.buffer.subarray(made.ramdiskOffset, made.ramdiskEnd);
  const built = bootImage.repackPreservingAvb(made.buffer, parsed, newRamdisk);

  assert.equal(built.buffer.length, made.totalSize);
  // footer 是最后 64 字节，魔数在它的开头（不是最后 4 字节）
  assert.equal(built.buffer.subarray(built.buffer.length - 64, built.buffer.length - 60).toString('ascii'), 'AVBf', '尾部必须仍是 AVB footer');
  // 内核区一个字节都不能变
  assert.ok(built.buffer.subarray(parsed.ramdiskOffset - parsed.kernelSize, parsed.ramdiskOffset)
    .equals(made.buffer.subarray(parsed.ramdiskOffset - parsed.kernelSize, parsed.ramdiskOffset)), '内核不得改动');
});

test('没有 AVB footer 的镜像：按原长补 0，不报错', () => {
  const made = makeBootWithFooter({ slack: 8192, totalSize: 4 * 1024 * 1024 });
  // 抹掉 footer 魔数
  const noFooter = Buffer.from(made.buffer);
  noFooter.fill(0, noFooter.length - 64);
  const parsed = bootImage.parse(noFooter);
  const rd = noFooter.subarray(made.ramdiskOffset, made.ramdiskEnd);
  const built = bootImage.repackPreservingAvb(noFooter, parsed, rd);
  assert.equal(built.moved, false);
  assert.equal(built.buffer.length, made.totalSize);
});

test('★ 规范化条目名：带 ./ 前缀的供体与不带前缀的等价', () => {
  // 真实故障：S30 安卓12 那份供体的条目名带 './' 前缀，
  // 而 X30 Pro 的模板不带。按字面查表会把一份条目齐全的供体
  // 误判成"缺少全部 Tea 条目"，直接拒绝制作。
  const plain = cpio.parse(cpio.build([
    { name: 'overlay.d/sbin/tea32.xz', mode: 0o100644, data: Buffer.from('A') },
    { name: '.backup/.tea', mode: 0o100644, data: Buffer.from('B') },
  ]));
  const dotted = cpio.parse(cpio.build([
    { name: './overlay.d/sbin/tea32.xz', mode: 0o100644, data: Buffer.from('A') },
    { name: './.backup/.tea', mode: 0o100644, data: Buffer.from('B') },
  ]));

  assert.equal(plain.length, 2);
  assert.equal(dotted.length, 2);
  // 两者规范化后的名字必须一致，这样查表才能命中
  assert.deepEqual(dotted.map((e) => e.key), plain.map((e) => e.key));
  assert.deepEqual(dotted.map((e) => e.key), ['overlay.d/sbin/tea32.xz', '.backup/.tea']);
  // 但重建时原始 name 必须保留，不能悄悄改名
  assert.equal(dotted[0].name, './overlay.d/sbin/tea32.xz', '原始 name 必须保留，重建才不会改动原厂结构');
});

test('cpio.normalizeName 行为', () => {
  assert.equal(cpio.normalizeName('./a/b'), 'a/b');
  assert.equal(cpio.normalizeName('a/b'), 'a/b');
  assert.equal(cpio.normalizeName('.'), '.');
  assert.equal(cpio.normalizeName('./'), '');
});
