/**
 * Android boot 镜像的解析与重打包（header v0-v4）。
 *
 * 背景：Tea 移植的正确做法是"保留原机 boot 的 kernel/header/签名块，
 * 只替换 ramdisk 里的 Tea 相关文件"。这要求能原样读出一张 boot 的
 * 各段结构，改掉 ramdisk 后再按同样的布局拼回去。
 *
 * 关键约束——重打包时**必须保持**：
 *   · kernel 原样不动（它决定了能不能开机）；
 *   · header 里除 ramdisk_size 外的所有字段（cmdline/addr/os_version）；
 *   · signature 段（AVB 签名块）原样保留；
 *   · 页对齐规则与原始一致，否则 bootloader 读不到 ramdisk。
 *
 * v4 的布局（AOSP bootimg.h）：
 *   header(header_size) + signature_size(4) + signature(signature_size)
 *   之后 kernel、ramdisk、second 依次按 4096 对齐排布。
 * v0-v2 的布局不同：header 固定 1632 字节，各段按 page_size 对齐。
 */

const MAGIC = 'ANDROID!';
/** boot v4 的页对齐固定为 4096（不再取 header 里的 page_size）。 */
const V4_ALIGN = 4096;

/** 图像结构识别失败时抛出，调用方负责转成用户可读的错误。 */
class BootImageError extends Error {}

function alignTo(value, alignment) {
  if (alignment <= 1) return value;
  return Math.ceil(value / alignment) * alignment;
}

/**
 * 解析 boot 镜像头，返回各段的偏移与长度。
 *
 * 不做任何"猜测式"解析：读不到 magic 直接报错，
 * 因为把非 boot 文件当 boot 处理会产生一个看似正常的坏镜像。
 */
function parse(buf) {
  if (buf.length < 44 || buf.toString('ascii', 0, 8) !== MAGIC) {
    throw new BootImageError('不是有效的 Android boot 镜像（缺少 ANDROID! 魔数）。');
  }

  const kernelSize = buf.readUInt32LE(8);
  const ramdiskSize = buf.readUInt32LE(12);
  const osVersion = buf.readUInt32LE(16);
  const headerSize = buf.readUInt32LE(20);
  const headerVersion = buf.readUInt32LE(40);

  if (!kernelSize) throw new BootImageError('boot 镜像头里 kernel 大小为 0，文件可能已损坏。');

  let signatureSize = 0;
  let ramdiskOffset;
  let pageSize = 0;

  if (headerVersion >= 3) {
    // v3/v4：header + signature，之后按 4096 对齐
    if (headerSize + 4 > buf.length) throw new BootImageError('boot 镜像头长度异常。');
    signatureSize = buf.readUInt32LE(headerSize);
    ramdiskOffset = alignTo(headerSize + 4 + signatureSize, V4_ALIGN);
    ramdiskOffset = alignTo(ramdiskOffset + kernelSize, V4_ALIGN);
  } else {
    // v0-v2：page_size 决定对齐
    pageSize = buf.readUInt32LE(36) || 2048;
    const secondSize = buf.readUInt32LE(24);
    ramdiskOffset = alignTo(headerSize, pageSize) + alignTo(kernelSize, pageSize) + alignTo(secondSize, pageSize);
  }

  if (ramdiskOffset + ramdiskSize > buf.length) {
    throw new BootImageError('boot 镜像不完整：ramdisk 段超出文件范围。');
  }

  return {
    headerVersion,
    headerSize,
    kernelSize,
    ramdiskSize,
    ramdiskOffset,
    signatureSize,
    pageSize,
    osVersion,
    header: buf.slice(0, headerSize + 4 + signatureSize),
    kernel: buf.slice(alignTo(headerVersion >= 3 ? headerSize + 4 + signatureSize : headerSize, headerVersion >= 3 ? V4_ALIGN : pageSize),
      alignTo(headerVersion >= 3 ? headerSize + 4 + signatureSize : headerSize, headerVersion >= 3 ? V4_ALIGN : pageSize) + kernelSize),
    ramdisk: buf.slice(ramdiskOffset, ramdiskOffset + ramdiskSize)
  };
}

/**
 * 用新的 ramdisk 重新打包 boot 镜像。
 *
 * header 段整体复用（含签名块），只把 ramdisk_size 改掉。
 * 这样最大程度保留原厂信息——尤其是 AVB 签名块和 cmdline，
 * 改动越少，开机成功率越高。
 */
function repack(parsed, newRamdisk) {
  const { header, kernel, headerVersion, headerSize, pageSize } = parsed;
  const align = headerVersion >= 3 ? V4_ALIGN : pageSize;

  const outHeader = Buffer.from(header);
  outHeader.writeUInt32LE(newRamdisk.length, 12);

  const parts = [outHeader];
  const pad1 = alignTo(outHeader.length, align) - outHeader.length;
  if (pad1 > 0) parts.push(Buffer.alloc(pad1));
  parts.push(kernel);

  const pad2 = alignTo(kernel.length, align) - kernel.length;
  if (pad2 > 0) parts.push(Buffer.alloc(pad2));
  parts.push(newRamdisk);

  return Buffer.concat(parts);
}

/** 从 boot 镜像里取出解压后的 ramdisk（自动识别 gzip / LZ4 / 裸 cpio）。 */
function detectRamdiskCompression(ramdisk) {
  if (ramdisk.length >= 2 && ramdisk[0] === 0x1f && ramdisk[1] === 0x8b) return 'gzip';
  if (ramdisk.length >= 4 && ramdisk.readUInt32LE(0) === 0x184C2102) return 'lz4-legacy';
  if (ramdisk.length >= 4 && ramdisk.readUInt32LE(0) === 0x184D2204) return 'lz4-frame';
  if (ramdisk.length >= 6 && ramdisk.toString('ascii', 0, 6) === '070701') return 'cpio';
  return 'unknown';
}


/** AVB footer 的魔数，Android 的 vbmeta 信息就记录在这 64 字节里。 */
const AVB_FOOTER_MAGIC = 'AVBf';
/** AVB footer 固定贴在镜像最后 64 字节。 */
const AVB_FOOTER_SIZE = 64;

/**
 * 读出镜像尾部的 AVB footer。
 *
 * footer 布局（全部大端）：
 *   0  magic 'AVBf'
 *   4  version_major (4)
 *   8  version_minor (4)
 *   12 original_image_size (8) —— 也就是 vbmeta 的起始偏移
 *   20 vbmeta_offset (8)       —— 与上面同值
 *   28 vbmeta_size (8)
 *
 * 没有 footer（或魔数不符）时返回 null：那种镜像尾部没有任何要保护的东西，
 * 保持原样重建即可。
 */
function parseAvbFooter(buf) {
  if (buf.length < AVB_FOOTER_SIZE) return null;
  const foot = buf.subarray(buf.length - AVB_FOOTER_SIZE);
  if (foot.toString('ascii', 0, 4) !== AVB_FOOTER_MAGIC) return null;
  const vbmetaOffset = Number(foot.readBigUInt64BE(20));
  const vbmetaSize = Number(foot.readBigUInt64BE(28));
  if (!Number.isSafeInteger(vbmetaOffset) || !Number.isSafeInteger(vbmetaSize)) return null;
  if (vbmetaOffset <= 0 || vbmetaSize <= 0) return null;
  if (vbmetaOffset + vbmetaSize > buf.length - AVB_FOOTER_SIZE) return null;
  return { vbmetaOffset, vbmetaSize };
}

/**
 * 用新 ramdisk 重建镜像，并保证不压坏 vbmeta。
 *
 * 为什么必须有这一步：
 *   Motorola 等厂商在刷入前会做 preflash 校验，它读的是尾部 AVB footer 声明的
 *   `original_image_size` 与 `vbmeta_offset`。ramdisk 一旦涨大、越过 vbmeta 的位置，
 *   vbmeta 会被覆盖（魔数不再是 AVB0）、footer 声明的值也与实际不符，
 *   刷机就会以 `Preflash validation failed` 被拒收。
 *
 *   G53 原镜像的余量只有 110 字节，而 Tea 核心比原厂 init 大得多，
 *   必然越界 —— 所以这一步不是保险，是必需。
 *
 * 做法：vbmeta 能原地放下就原地不动；放不下就整块后移到
 * `align(ramdisk 结束 + 4096, 4096)`，再同步改写 footer 的偏移 12 与 20。
 * 解锁设备的 vbmeta 是 256 字节无签名结构（auth_size=0 / aux_size=0），
 * 没有签名绑定位置，因此可以自由搬运。
 *
 * 关键：重建后**保持镜像总长不变**。分区大小是固定的，短了会把 footer 丢掉
 * （G71S 那张成品就是这样坏的：尾部 64 字节全变成 0）。
 *
 * @param {Buffer} original 原始镜像（用来取总长、footer 与 vbmeta）
 * @param {object} parsed   parse(original) 的结果
 * @param {Buffer} newRamdisk 新的 ramdisk
 * @returns {{buffer: Buffer, report: string[], moved: boolean}}
 */
function repackPreservingAvb(original, parsed, newRamdisk) {
  const { header, kernel, headerVersion, headerSize, pageSize } = parsed;
  const align = headerVersion >= 3 ? V4_ALIGN : pageSize;
  const report = [];

  const outHeader = Buffer.from(header);
  outHeader.writeUInt32LE(newRamdisk.length, 12);

  const kernelOffset = alignTo(outHeader.length, align);
  const ramdiskOffset = alignTo(kernelOffset + kernel.length, align);
  const ramdiskEnd = ramdiskOffset + newRamdisk.length;

  // 镜像总长：有 AVB footer 时必须与原来一致（短了就丢 footer、长了多出无意义填充）；
  // 没有 footer 时允许增长 —— 那种镜像尾部本来就没有要保护的结构，
  // 强行截回原长反而会把 ramdisk 截断（早期合成镜像就是这种情形）。
  const footer = parseAvbFooter(original);
  const totalSize = footer ? original.length : Math.max(original.length, ramdiskEnd);
  const out = Buffer.alloc(totalSize);
  outHeader.copy(out, 0);
  kernel.copy(out, kernelOffset);
  newRamdisk.copy(out, ramdiskOffset);

  if (!footer) {
    report.push(`原镜像没有 AVB footer，按 ${totalSize} 字节重建（无 vbmeta 需要搬运）`);
    return { buffer: out, report, moved: false };
  }

  const { vbmetaOffset, vbmetaSize } = footer;
  const slack = vbmetaOffset - ramdiskEnd;
  let target = vbmetaOffset;
  let moved = false;

  if (slack < 0) {
    // 越界：vbmeta 必须后移。多留一页余量，避免刚好贴着下次再涨就又要搬。
    target = alignTo(ramdiskEnd + align, align);
    moved = true;
  }

  if (target + vbmetaSize > totalSize - AVB_FOOTER_SIZE) {
    throw new BootImageError(
      `ramdisk 增大 ${newRamdisk.length - parsed.ramdiskSize} 字节后，vbmeta 已无处安放` +
      `（需要 ${vbmetaSize} 字节，可用 ${totalSize - AVB_FOOTER_SIZE - ramdiskEnd} 字节）。`
    );
  }

  // 原来的 vbmeta 内容整块搬到新位置。
  const vbmeta = original.subarray(vbmetaOffset, vbmetaOffset + vbmetaSize);
  vbmeta.copy(out, target);

  // footer 整体复制，再改写两个偏移字段（都是 8 字节大端）。
  const newFooter = Buffer.from(original.subarray(totalSize - AVB_FOOTER_SIZE));
  newFooter.writeBigUInt64BE(BigInt(target), 12);
  newFooter.writeBigUInt64BE(BigInt(target), 20);
  newFooter.copy(out, totalSize - AVB_FOOTER_SIZE);

  if (moved) {
    report.push(
      `vbmeta 让位：ramdisk 结束于 ${ramdiskEnd}，原 vbmeta 在 ${vbmetaOffset}` +
      `（余量 ${slack}），已后移至 ${target}，footer 偏移 12/20 同步改写，新余量 ${target - ramdiskEnd}`
    );
  } else {
    report.push(`vbmeta 无需让位：ramdisk 结束于 ${ramdiskEnd}，vbmeta 在 ${vbmetaOffset}，余量 ${slack}`);
  }

  return { buffer: out, report, moved };
}
module.exports = { parse, repack, repackPreservingAvb, parseAvbFooter, detectRamdiskCompression, BootImageError, V4_ALIGN, MAGIC, AVB_FOOTER_SIZE };