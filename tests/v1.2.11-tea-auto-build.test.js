const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const cpio = require('../src/cpio');
const lz4 = require('../src/lz4');
const bootImage = require('../src/boot_image');
const teaBuilder = require('../src/tea_builder');

/**
 * Tea 自动制作的回归测试。
 *
 * 目标行为：用户只提供原厂 boot，程序自动把 Tea 核心移植进去，
 * 全程不要求用户选择模板或槽位。
 *
 * 这里用合成镜像来验证算法本身，不依赖 480MB 的真实模板库，
 * 这样 CI 上也能跑。真实镜像的一致性由构建期另行核对。
 */

/** 造一张最小但结构完整的 boot 镜像。 */
function makeBoot({ version = 4, entries, initIsSymlink = true } = {}) {
  const list = entries || [
    { name: '.backup', mode: 0o040000, data: Buffer.alloc(0) },
    { name: 'init', mode: initIsSymlink ? 0o120750 : 0o100755,
      data: initIsSymlink ? Buffer.from('/system/bin/init') : Buffer.from('stock-init-payload') },
    { name: 'system', mode: 0o040755, data: Buffer.alloc(0) }
  ];
  const cpioBuf = cpio.build(list);
  const ramdisk = version >= 3 ? lz4.compress(cpioBuf) : zlib.gzipSync(cpioBuf);
  const kernel = Buffer.alloc(4096, 0x41);
  const ALIGN = version >= 3 ? 4096 : 2048;
  const align = (n) => Math.ceil(n / ALIGN) * ALIGN;
  const headerSize = version >= 3 ? 1584 : 1632;
  const header = Buffer.alloc(headerSize + (version >= 3 ? 4 : 0));
  header.write('ANDROID!', 0, 'ascii');
  header.writeUInt32LE(kernel.length, 8);
  header.writeUInt32LE(ramdisk.length, 12);
  header.writeUInt32LE(0, 16);
  header.writeUInt32LE(headerSize, 20);
  if (version < 3) header.writeUInt32LE(ALIGN, 36);
  header.writeUInt32LE(version, 40);
  const parts = [header];
  const pad = (buf) => { const p = align(buf.length) - buf.length; if (p > 0) parts.push(Buffer.alloc(p)); };
  pad(header);
  parts.push(kernel); pad(kernel);
  parts.push(ramdisk);
  return Buffer.concat(parts);
}

/** 造一张含 Tea 核心的供体镜像。 */
function makeDonor() {
  return makeBoot({ entries: [
    { name: '.backup', mode: 0o040000, data: Buffer.alloc(0) },
    { name: '.backup/init', mode: 0o120750, data: Buffer.from('/system/bin/init') },
    { name: '.backup/.tea', mode: 0o100644, data: Buffer.from('KEEPVERITY=true\nSHA1=abc\n') },
    { name: '.backup/.rmlist', mode: 0o100644, data: Buffer.from('overlay.d\0overlay.d/sbin/tea32.xz\0') },
    { name: 'init', mode: 0o100755, data: Buffer.alloc(600, 0x4d) },
    { name: 'overlay.d', mode: 0o040750, data: Buffer.alloc(0) },
    { name: 'overlay.d/sbin', mode: 0o040750, data: Buffer.alloc(0) },
    { name: 'overlay.d/sbin/tea32.xz', mode: 0o100644, data: Buffer.alloc(300, 0x33) },
    { name: 'overlay.d/sbin/tea64.xz', mode: 0o100644, data: Buffer.alloc(400, 0x36) },
    { name: 'overlay.d/sbin/teapolicy.xz', mode: 0o100644, data: Buffer.alloc(500, 0x50) },
    { name: 'overlay.d/sbin/tea.product', mode: 0o100644, data: Buffer.alloc(600, 0x72) },
    { name: 'overlay.d/sbin/tea.product.bak', mode: 0o100644, data: Buffer.alloc(700, 0x62) }
  ] });
}

function entriesOf(imageBuffer, version = 4) {
  const p = bootImage.parse(imageBuffer);
  const raw = version >= 3 ? lz4.decompress(p.ramdisk).data : zlib.gunzipSync(p.ramdisk);
  return { parsed: p, entries: cpio.parse(raw) };
}

test('自动制作：Tea 核心被注入，原厂 kernel 与 header 保持不变', () => {
  const stock = makeBoot();
  const donor = makeDonor();
  const { buffer, report } = teaBuilder.build(stock, donor);
  const stockParsed = bootImage.parse(stock);
  const out = entriesOf(buffer);
  assert.ok(report.length > 0, '应给出制作步骤报告');
  assert.equal(out.parsed.kernelSize, stockParsed.kernelSize, 'kernel 大小不能变');
  assert.ok(out.parsed.kernel.equals(stockParsed.kernel), 'kernel 内容必须与原厂一致');
  const names = out.entries.map((e) => e.name);
  for (const need of ['overlay.d/sbin/tea32.xz', 'overlay.d/sbin/tea64.xz',
    'overlay.d/sbin/teapolicy.xz', 'overlay.d/sbin/tea.product', 'overlay.d/sbin/tea.product.bak']) {
    assert.ok(names.includes(need), `应注入 ${need}`);
  }
});

test('自动制作：原厂 init 被换成 magiskinit，原 init 存入 .backup/init', () => {
  const stock = makeBoot();
  const donor = makeDonor();
  const { buffer } = teaBuilder.build(stock, donor);
  const { entries } = entriesOf(buffer);
  const byName = new Map(entries.map((e) => [e.name, e]));
  const init = byName.get('init');
  const backup = byName.get('.backup/init');
  assert.ok(init, '必须有 init');
  assert.equal(init.data.length, 600, 'init 应被换成供体的 magiskinit');
  assert.ok(backup, '必须有 .backup/init');
  assert.equal(backup.data.toString('utf8'), '/system/bin/init', '原厂 init 内容应被保存');
});

test('自动制作：符号链接类型的 init 必须保持为符号链接', () => {
  // 这是最容易出错也最致命的一点：把符号链接写成普通文件，
  // magiskinit 启动时就找不到真正的 init，表现为卡开机。
  const stock = makeBoot({ initIsSymlink: true });
  const donor = makeDonor();
  const { buffer } = teaBuilder.build(stock, donor);
  const { entries } = entriesOf(buffer);
  const backup = entries.find((e) => e.name === '.backup/init');
  assert.equal(backup.mode & 0o170000, 0o120000, '.backup/init 必须是符号链接');
});

test('自动制作：原厂 init 是普通文件时，.backup/init 也保持普通文件', () => {
  const stock = makeBoot({ initIsSymlink: false });
  const donor = makeDonor();
  const { buffer } = teaBuilder.build(stock, donor);
  const { entries } = entriesOf(buffer);
  const backup = entries.find((e) => e.name === '.backup/init');
  assert.equal(backup.mode & 0o170000, 0o100000, '应保持普通文件类型');
  assert.equal(backup.data.toString('utf8'), 'stock-init-payload', '应保存原厂 init 原文');
});

test('自动制作：不删除原厂 ramdisk 的任何条目', () => {
  const stock = makeBoot();
  const donor = makeDonor();
  const { buffer } = teaBuilder.build(stock, donor);
  const stockNames = entriesOf(stock).entries.map((e) => e.name);
  const outNames = entriesOf(buffer).entries.map((e) => e.name);
  for (const name of stockNames) {
    assert.ok(outNames.includes(name), `原厂条目 ${name} 不应丢失`);
  }
});

test('自动制作：产物能被重新解析（写出去的是合法 boot）', () => {
  const stock = makeBoot();
  const donor = makeDonor();
  const { buffer } = teaBuilder.build(stock, donor);
  const reparsed = bootImage.parse(buffer);
  assert.equal(reparsed.headerVersion, 4);
  assert.ok(reparsed.kernelSize > 0);
  assert.ok(reparsed.ramdiskSize > 0);
});

test('自动制作：供体缺少 Tea 必要文件时明确报错，不产出半成品', () => {
  const stock = makeBoot();
  const brokenDonor = makeBoot(); // 普通 boot，没有 Tea 文件
  assert.throws(() => teaBuilder.build(stock, brokenDonor), /缺少必要条目/);
});

test('自动制作：原厂镜像不是 boot 时明确报错', () => {
  const donor = makeDonor();
  assert.throws(() => teaBuilder.build(Buffer.alloc(1024), donor), /不是有效的 Android boot 镜像/);
});

test('自动制作：.backup/.tea 的 SHA1 必须是本次原厂 boot 的指纹', () => {
  // Magisk 用这个字段做「还原原厂 boot」。若沿用供体的值，Magisk 会拿着
  // donor 那台机器的指纹去新机上找镜像，还原功能必然失败。
  // 目录里给 penang 用的现成镜像至今还带着 X30 pro 的指纹，就是这个疏漏。
  const stock = makeBoot();
  const donor = makeDonor();
  const { buffer } = teaBuilder.build(stock, donor);
  const { entries } = entriesOf(buffer);
  const tea = entries.find((e) => e.name === '.backup/.tea');
  const expect = crypto.createHash('sha1').update(stock).digest('hex');
  assert.match(tea.data.toString('utf8'), new RegExp('^SHA1=' + expect + '$', 'm'),
    'SHA1 必须指向本次的原厂 boot');
  assert.ok(!tea.data.toString('utf8').includes('SHA1=abc'), '不能残留供体的 SHA1');
});

test('自动制作：改写 SHA1 时其余 Magisk 开关必须原样保留', () => {
  const stock = makeBoot();
  const donor = makeDonor();
  const { buffer } = teaBuilder.build(stock, donor);
  const tea = entriesOf(buffer).entries.find((e) => e.name === '.backup/.tea');
  const text = tea.data.toString('utf8');
  assert.match(text, /^KEEPVERITY=true$/m, 'KEEPVERITY 不能被改动');
});

test('自动制作：供体 .tea 缺少 SHA1 行时原样保留，不报错', () => {
  const stock = makeBoot();
  const donor = makeDonor();
  const entry = { name: '.backup/.tea', mode: 0o100644, data: Buffer.from('KEEPVERITY=true\n') };
  const out = teaBuilder.withStockSha1(entry, stock);
  assert.equal(out.data.toString('utf8'), 'KEEPVERITY=true\n');
});
