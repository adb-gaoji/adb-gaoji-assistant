/**
 * LZ4 解压（含 Android boot 用的 legacy 帧格式）。
 *
 * 为什么自己写而不是引依赖：
 *   · 项目目前只依赖一个图标库，为了解一个 ramdisk 引入 lz4 依赖不划算；
 *   · LZ4 块格式的解压算法本身很小，且规范稳定，自己实现可控；
 *   · 打包体积敏感（安装包已 550MB），少一个依赖少一份风险。
 *
 * 覆盖两种格式：
 *   1. LZ4 legacy 帧（magic 0x184C2102）：Android boot 最常见；
 *   2. 裸块序列：无帧头，直接是一串 block。
 * 两种情况下每个 block 都是 [compressedSize(4)][数据]，compressedSize 高位为 1 表示未压缩。
 */

const LEGACY_MAGIC = 0x184C2102;
const BLOCK_SIZE = 8 * 1024 * 1024;

/**
 * 解压单个 LZ4 block。
 *
 * block 结构：一串 sequence，每个 sequence：
 *   token(1) —— 高4位字面量长度、低4位匹配长度（都是 15 表示还有后续字节）
 *   [字面量长度扩展字节…] 字面量数据
 *   [匹配偏移(2, 小端)]  匹配长度扩展字节…
 * 末尾允许只有字面量、没有匹配偏移。
 */
function decompressBlock(src, dest, destOffset) {
  let ip = 0;            // 输入游标
  let op = destOffset;   // 输出游标
  const destEnd = dest.length;

  while (ip < src.length) {
    const token = src[ip++];
    let literalLength = token >> 4;
    if (literalLength === 15) {
      let more;
      do { more = src[ip++]; literalLength += more; } while (more === 255);
    }

    if (ip + literalLength > src.length) throw new Error('LZ4 块损坏：字面量超出输入范围');
    if (op + literalLength > destEnd) throw new Error('LZ4 块损坏：字面量超出输出范围');
    src.copy(dest, op, ip, ip + literalLength);
    ip += literalLength;
    op += literalLength;

    // 末尾可能只剩字面量，没有匹配部分。
    if (ip >= src.length) break;

    if (ip + 2 > src.length) throw new Error('LZ4 块损坏：缺少匹配偏移');
    const offset = src.readUInt16LE(ip); ip += 2;
    if (offset === 0) throw new Error('LZ4 块损坏：匹配偏移为 0');

    let matchLength = token & 0x0f;
    if (matchLength === 15) {
      let more;
      do { more = src[ip++]; matchLength += more; } while (more === 255);
    }
    matchLength += 4; // 最小匹配长度

    const matchStart = op - offset;
    if (matchStart < 0) throw new Error('LZ4 块损坏：匹配位置越界');
    if (op + matchLength > destEnd) throw new Error('LZ4 块损坏：匹配超出输出范围');

    // 逐字节复制：匹配区域可能与写入区域重叠，不能用 copy 一次拷完。
    for (let i = 0; i < matchLength; i += 1) {
      dest[op] = dest[matchStart + i];
      op += 1;
    }
  }
  return op - destOffset;
}

/** 判断一段 buffer 是否是 legacy 帧（magic 打头）。 */
function isLegacyLz4(buf) {
  return buf.length >= 4 && buf.readUInt32LE(0) === LEGACY_MAGIC;
}

/**
 * 解压 Android boot 的 LZ4 ramdisk。
 *
 * 返回 { data: Buffer, compressedSize: number }：
 * compressedSize 是**实际消耗掉的输入字节数**，重打包时要靠它知道原始长度。
 */
function decompress(buf) {
  let offset = 0;
  const chunks = [];
  let total = 0;

  if (isLegacyLz4(buf)) offset = 4;

  while (offset + 4 <= buf.length) {
    const size = buf.readUInt32LE(offset);
    offset += 4;

    // 最高位为 1：该块未压缩，直接搬运。
    if (size & 0x80000000) {
      const raw = size & 0x7fffffff;
      if (offset + raw > buf.length) throw new Error('LZ4 数据截断');
      chunks.push(Buffer.from(buf.slice(offset, offset + raw)));
      total += raw;
      offset += raw;
      continue;
    }

    if (size === 0 || size > buf.length - offset) {
      // 末尾的 0 或越界长度视为结束，不报错——有些打包器会留尾。
      break;
    }
    const block = buf.slice(offset, offset + size);
    offset += size;

    const out = Buffer.alloc(BLOCK_SIZE);
    const written = decompressBlock(block, out, 0);
    chunks.push(out.slice(0, written));
    total += written;
  }

  return { data: Buffer.concat(chunks, total), compressedSize: offset };
}

/**
 * 压缩单个 LZ4 block（标准 LZ4 块格式，与内核/官方实现兼容）。
 *
 * 算法是 LZ4 的标准做法：4 字节哈希表找最近匹配，
 * 找到就输出 [token][字面量][偏移][匹配延长]，找不到就继续攒字面量。
 * 参数上做了保守选择——不追求极限压缩率，只求**产物一定能被解压**，
 * 因为这块数据最终要进 boot 分区，压错等于开不了机。
 */
const MIN_MATCH = 4;
const HASH_LOG = 16;
const HASH_SIZE = 1 << HASH_LOG;
const MAX_DISTANCE = 65535;   // 偏移字段只有 2 字节
const LAST_LITERALS = 5;      // 结尾至少留 5 字节字面量
const MF_LIMIT = 12;          // 尾部不再找匹配的余量

function hash(sequence) {
  return ((sequence * 2654435761) >>> (32 - HASH_LOG)) & (HASH_SIZE - 1);
}

function writeLength(dst, start, length) {
  let len = length;
  let p = start;
  while (len >= 255) { dst[p++] = 255; len -= 255; }
  dst[p++] = len;
  return p;
}

function compressBlock(src) {
  const srcLen = src.length;
  // 最坏情况：每个字节都要额外开销；给足余量避免反复扩容。
  const dst = Buffer.alloc(srcLen + Math.ceil(srcLen / 255) + 16 + 16);
  const table = new Int32Array(HASH_SIZE).fill(-1);

  let anchor = 0;   // 当前未输出的字面量起点
  let ip = 0;       // 扫描游标
  let op = 0;       // 输出游标
  const matchLimit = srcLen - MF_LIMIT;

  if (srcLen >= MF_LIMIT) {
    while (ip < matchLimit) {
      const seq = src.readUInt32LE(ip);
      const h = hash(seq);
      const candidate = table[h];
      table[h] = ip;

      if (candidate < 0 || ip - candidate > MAX_DISTANCE ||
          src.readUInt32LE(candidate) !== seq) {
        ip += 1;
        continue;
      }

      // 先向后延长匹配
      let matched = MIN_MATCH;
      const maxMatch = srcLen - LAST_LITERALS - ip;
      while (matched < maxMatch && src[candidate + matched] === src[ip + matched]) matched += 1;

      const literalLength = ip - anchor;
      const tokenLiteral = Math.min(literalLength, 15);
      const tokenMatch = Math.min(matched - MIN_MATCH, 15);
      dst[op++] = (tokenLiteral << 4) | tokenMatch;

      if (literalLength >= 15) op = writeLength(dst, op, literalLength - 15);
      src.copy(dst, op, anchor, ip);
      op += literalLength;

      dst.writeUInt16LE(ip - candidate, op); op += 2;
      if (matched - MIN_MATCH >= 15) op = writeLength(dst, op, matched - MIN_MATCH - 15);

      ip += matched;
      anchor = ip;
    }
  }

  // 收尾：剩下的全部作为字面量
  const literalLength = srcLen - anchor;
  const tokenLiteral = Math.min(literalLength, 15);
  dst[op++] = tokenLiteral << 4;
  if (literalLength >= 15) op = writeLength(dst, op, literalLength - 15);
  src.copy(dst, op, anchor, srcLen);
  op += literalLength;

  return dst.slice(0, op);
}

/**
 * 把数据压成 Android boot 使用的 LZ4 legacy 帧。
 *
 * 帧结构：magic(4) 后紧跟若干 block，每个 block 前缀 4 字节长度。
 * 与解压侧对称——本模块的 decompress 能读回自己的输出。
 */
function compress(data, blockSize = BLOCK_SIZE) {
  const size = Math.max(1, blockSize);
  const parts = [Buffer.alloc(4)];
  parts[0].writeUInt32LE(LEGACY_MAGIC, 0);

  for (let offset = 0; offset < data.length; offset += size) {
    const chunk = data.slice(offset, Math.min(offset + size, data.length));
    const compressed = compressBlock(chunk);

    // 压不动就按「未压缩块」存（长度最高位置 1），避免体积反而变大。
    if (compressed.length >= chunk.length) {
      const header = Buffer.alloc(4);
      header.writeUInt32LE(chunk.length | 0x80000000, 0);
      parts.push(header, chunk);
    } else {
      const header = Buffer.alloc(4);
      header.writeUInt32LE(compressed.length, 0);
      parts.push(header, compressed);
    }
  }
  // 数据为空时也要给出一个合法帧，方便调用方统一处理。
  if (!data.length) {
    const header = Buffer.alloc(4);
    header.writeUInt32LE(0x80000000, 0);
    parts.push(header, Buffer.alloc(0));
  }
  return Buffer.concat(parts);
}

module.exports = { decompress, decompressBlock, compress, compressBlock, isLegacyLz4, LEGACY_MAGIC, BLOCK_SIZE };
