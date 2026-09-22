/**
 * Tea boot 移植引擎：用原厂 boot 当外壳，注入 Tea 核心。
 *
 * 原理（由已验证模板逆推得出）：
 *   Tea 是通过 Magisk 的 overlay.d 机制工作的——ramdisk 里存在
 *     init                   Magisk 的 magiskinit（负责在开机早期挂载 overlay）
 *     .backup/init           原厂 init 的备份，magiskinit 接管后再执行它
 *     .backup/.tea           Magisk 补丁配置（KEEPVERITY / SHA1 等）
 *     .backup/.rmlist        需要注入的文件清单
 *     overlay.d/sbin/tea*.xz Tea 运行时（32/64 位、策略）
 *     overlay.d/sbin/tea.product(.bak)  Tea 产品数据
 *
 * 因此移植的正确做法不是整体替换，而是：
 *   1. 拿**用户的原厂 boot**，保留它的 kernel / header / 签名块；
 *   2. 解开它的 ramdisk；
 *   3. 把原厂 init 备份成 .backup/init —— 这一步绝不能省，
 *      也绝不能用 donor 的 .backup/init（那是另一台机器的系统，
 *      启动到错误系统会卡开机）；
 *   4. 换上 donor 的 magiskinit 与 Tea 运行时文件；
 *   5. 重新打包 ramdisk 并压回 boot。
 *
 * 安全取向：宁可不产出，也不产出半成品。任何一步对不上就报错退出，
 * 由用户决定是否重试，而不是塞一个可能变砖的镜像。
 */

const lz4 = require('./lz4');
const cpio = require('./cpio');
const boot = require('./boot_image');

/** Tea 运行时文件：必须来自 donor，整份覆盖。 */
const TEA_PAYLOAD = [
  'overlay.d',
  'overlay.d/sbin',
  'overlay.d/sbin/tea32.xz',
  'overlay.d/sbin/tea64.xz',
  'overlay.d/sbin/teapolicy.xz',
  'overlay.d/sbin/tea.product',
  'overlay.d/sbin/tea.product.bak'
];

/** magiskinit 相关：init 换成 donor 的，原 init 另存为 .backup/init。 */
const TEA_BOOTSTRAP = ['.backup', '.backup/.tea', '.backup/.rmlist', '.backup/init'];

class TeaBuildError extends Error {}

function inflateRamdisk(ramdisk) {
  const kind = boot.detectRamdiskCompression(ramdisk);
  if (kind === 'lz4-legacy') return { data: lz4.decompress(ramdisk).data, kind };
  if (kind === 'cpio') return { data: ramdisk, kind };
  if (kind === 'gzip') {
    const zlib = require('node:zlib');
    return { data: zlib.gunzipSync(ramdisk), kind };
  }
  throw new TeaBuildError(
    `不支持的 ramdisk 压缩格式（${kind}）。目前支持 LZ4 legacy、gzip 与未压缩 cpio。`
  );
}

function deflateRamdisk(data, kind) {
  if (kind === 'cpio') return data;
  if (kind === 'lz4-legacy') return lz4.compress(data);
  if (kind === 'gzip') {
    const zlib = require('node:zlib');
    return zlib.gzipSync(data);
  }
  throw new TeaBuildError(`不支持的 ramdisk 压缩格式：${kind}`);
}

/** 从 donor boot 中取出需要移植的条目。 */
function extractDonor(donorImageBuffer) {
  const parsed = boot.parse(donorImageBuffer);
  const { data } = inflateRamdisk(parsed.ramdisk);
  const entries = cpio.parse(data);
  const byName = new Map(entries.map((e) => [e.name, e]));

  const missing = [...TEA_PAYLOAD, ...TEA_BOOTSTRAP].filter((name) => !byName.has(name));
  if (missing.length) {
    throw new TeaBuildError(
      `Tea 供体镜像缺少必要条目：${missing.join('、')}。\\n` +
      '请确认供体是完整的 Tea 模板，而不是普通 boot。'
    );
  }

  const payload = new Map();
  for (const name of TEA_PAYLOAD) payload.set(name, byName.get(name));
  return {
    parsed,
    entries,
    payload,
    magiskInit: byName.get('init'),
    magiskConfig: byName.get('.backup/.tea'),
    rmlist: byName.get('.backup/.rmlist'),
    compression: boot.detectRamdiskCompression(parsed.ramdisk)
  };
}

/**
 * 把 Tea 核心移植进用户的原厂 boot。
 *
 * @param {Buffer} stockBuffer 用户提供的原厂 boot 镜像
 * @param {Buffer} donorBuffer 已验证的 Tea 供体镜像
 * @param {object} options     { magicInit: boolean }
 * @returns {{buffer: Buffer, report: string[]}}
 */
function build(stockBuffer, donorBuffer, options = {}) {
  const report = [];
  const stock = boot.parse(stockBuffer);
  report.push(`原厂 boot：header v${stock.headerVersion}，kernel ${stock.kernelSize} 字节，ramdisk ${stock.ramdiskSize} 字节`);

  const donor = extractDonor(donorBuffer);
  report.push(`Tea 供体：header v${donor.parsed.headerVersion}，ramdisk 压缩 ${donor.compression}`);

  // 1. 解开原厂 ramdisk
  const stockKind = boot.detectRamdiskCompression(stock.ramdisk);
  const stockRd = inflateRamdisk(stock.ramdisk);
  const stockEntries = cpio.parse(stockRd.data);
  if (!stockEntries.length) throw new TeaBuildError('原厂 boot 的 ramdisk 里没有解析到任何文件，无法移植。');
  report.push(`原厂 ramdisk：${stockEntries.length} 个条目，压缩 ${stockKind}`);

  const stockByName = new Map(stockEntries.map((e) => [e.name, e]));
  const originalInit = stockByName.get('init');
  if (!originalInit) {
    throw new TeaBuildError('原厂 ramdisk 里没有 init，无法备份原始 init，移植中止。');
  }
  // 实测原厂 penang/XT2335-3 的 init 是一个 16 字节符号链接（/system/bin/init），
  // 制作时它被换成 magiskinit，而**链接本身原样存进 .backup/init**。
  // 所以这里不能要求 init 有内容——只要求它存在，并把它的实体原样搬过去。
  report.push(`已备份原厂 init：${originalInit.data.length} 字节（mode 0o${originalInit.mode.toString(8)}）-> .backup/init`);

  // 2. 以原厂条目为基础，逐个写入/覆盖 Tea 相关条目。
  //    保持原厂顺序，Tea 条目追加在后面，避免打乱内核解包顺序。
  const merged = new Map(stockEntries.map((e) => [e.name, e]));

  // 原厂 init -> .backup/init（必须来自原机，绝不能用供体的）
  merged.set('.backup', { name: '.backup', mode: 0o040000, data: Buffer.alloc(0) });
  // 原样保留 mode：原厂 init 若是符号链接，这里也必须是符号链接，
  // 否则 magiskinit 按普通文件去读 /system/bin/init 会失败。
  merged.set('.backup/init', { name: '.backup/init', mode: originalInit.mode, data: originalInit.data });

  // 供体的 Magisk 引导层与 Tea 运行时
  merged.set('.backup/.tea', donor.magiskConfig);
  merged.set('.backup/.rmlist', donor.rmlist);
  if (options.magicInit !== false) merged.set('init', donor.magiskInit);
  for (const [name, entry] of donor.payload) {
    if (name === 'overlay.d' || name === 'overlay.d/sbin') continue;
    merged.set(name, entry);
  }

  // 补齐 overlay.d 目录项（Magisk 需要它存在才会挂载）。
  // 权限位对齐已验证产物的实际取值（0o40750），而不是想当然的 0o40755——
  // 目标是让输出与"已经刷成功过的那份"尽量逐字节等价。
  if (!merged.has('overlay.d')) merged.set('overlay.d', { name: 'overlay.d', mode: 0o040750, data: Buffer.alloc(0) });
  if (!merged.has('overlay.d/sbin')) merged.set('overlay.d/sbin', { name: 'overlay.d/sbin', mode: 0o040750, data: Buffer.alloc(0) });

  report.push(`合并后共 ${merged.size} 个条目（原厂 ${stockEntries.length} + Tea 新增）`);

  // 3. 重新打包 ramdisk，并用原厂的压缩方式压回去
  const packed = cpio.build([...merged.values()]);
  const compressed = deflateRamdisk(packed, stockKind === 'cpio' ? 'cpio' : stockKind);
  report.push(`ramdisk 重建：${packed.length} 字节 -> 压缩 ${compressed.length} 字节（${stockKind}）`);

  // 4. 用原厂 header/kernel/签名块重新拼出 boot
  const outBuffer = boot.repack(stock, compressed);
  report.push(`boot 重建完成：${outBuffer.length} 字节`);

  return { buffer: outBuffer, report };
}

module.exports = { build, extractDonor, inflateRamdisk, deflateRamdisk, TeaBuildError, TEA_PAYLOAD, TEA_BOOTSTRAP };
