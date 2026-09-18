#!/usr/bin/env node
/**
 * 文档链接检查。
 *
 * 检查 Markdown 文档里的相对链接与页内锚点是否真实存在。
 * 死链在 GitHub 上不会报错，只会让读者点进 404——所以需要自动化兜住。
 *
 * 退出码：
 *   0  全部有效
 *   1  存在死链（阻断）
 *
 * 用法：
 *   node scripts/audit-links.js
 *   node scripts/audit-links.js --verbose
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const verbose = process.argv.includes('--verbose');

/** 需要检查的文档。新增面向用户的文档时加到这里。 */
const DOCUMENTS = [
  'README.md',
  'SUPPORT.md',
  'CONTRIBUTING.md',
  'ROADMAP.md',
  'SECURITY.md',
  'CODE_OF_CONDUCT.md',
  'VERSIONS.md',
  'CHANGELOG.md',
  'THIRD-PARTY-NOTICES.md',
  'docs/good-first-issues.md',
  'design/README.md',
  '.github/pull_request_template.md'
];

/** 外链域名白名单——只校验格式，不联网（CI 里联网检查会不稳定）。 */
const EXTERNAL_PREFIXES = ['http://', 'https://', 'mailto:'];

/**
 * GitHub 的标题锚点算法：转小写、去掉标点（emoji 也算标点被删除）、
 * 空格换连字符。注意 GitHub **不做首尾连字符裁剪**——
 * 标题 `## ⭐ 主打功能` 的真实锚点是 `#-主打功能`（emoji 被删，
 * 原空格变成前导连字符并保留）。这里的实现必须与 GitHub 一致，
 * 否则会把有效链接误报成死链。
 */
function toAnchor(heading) {
  return heading
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fa5\s-]/g, '')
    .replace(/\s+/g, '-');
}

/** 拆出文档里的标题集合，用于校验页内锚点。 */
function collectAnchors(text) {
  const anchors = new Set();
  for (const match of text.matchAll(/^#{1,6}\s+(.+?)\s*$/gm)) {
    anchors.add(toAnchor(match[1]));
  }
  return anchors;
}

/** 拆出 <a name="x"> / <a id="x"> 这类显式锚点。 */
function collectExplicitAnchors(text) {
  const anchors = new Set();
  for (const match of text.matchAll(/<a\s+(?:name|id)=["']([^"']+)["']/gi)) {
    anchors.add(match[1]);
  }
  return anchors;
}

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

const findings = [];
let linkCount = 0;
let anchorCount = 0;

for (const rel of DOCUMENTS) {
  const full = path.join(root, rel);
  if (!fs.existsSync(full)) {
    findings.push(`${rel}：文档不存在（DOCUMENTS 列表过期？）`);
    continue;
  }
  const text = fs.readFileSync(full, 'utf8');
  const dir = path.dirname(full);
  const anchors = new Set([...collectAnchors(text), ...collectExplicitAnchors(text)]);

  // 屏蔽代码块，避免把示例里的链接当成真链接
  const stripped = text.replace(/```[\s\S]*?```/g, (block) => ' '.repeat(block.length));

  for (const match of stripped.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
    const target = match[1];
    const line = lineOf(stripped, match.index);
    if (EXTERNAL_PREFIXES.some((prefix) => target.startsWith(prefix))) continue;

    if (target.startsWith('#')) {
      anchorCount++;
      const anchor = target.slice(1);
      if (!anchors.has(anchor)) {
        findings.push(`${rel}:${line}：页内锚点不存在 #${anchor}`);
      }
      continue;
    }

    const [filePart, anchorPart] = target.split('#');
    if (!filePart) continue;
    linkCount++;
    const resolved = path.resolve(dir, decodeURIComponent(filePart));
    if (!fs.existsSync(resolved)) {
      findings.push(`${rel}:${line}：文件不存在 -> ${filePart}`);
      continue;
    }
    // 跨文件锚点：只在该文件是 markdown 时校验
    if (anchorPart && /\.md$/i.test(filePart)) {
      anchorCount++;
      const targetText = fs.readFileSync(resolved, 'utf8');
      const targetAnchors = new Set([...collectAnchors(targetText), ...collectExplicitAnchors(targetText)]);
      if (!targetAnchors.has(anchorPart)) {
        findings.push(`${rel}:${line}：${filePart} 中不存在锚点 #${anchorPart}`);
      }
    }
  }
}

console.log('文档链接审计');
console.log(`  检查文档：${DOCUMENTS.length} 个`);
console.log(`  相对链接：${linkCount} 个`);
console.log(`  页内锚点：${anchorCount} 个`);
if (verbose) for (const rel of DOCUMENTS) console.log(`    - ${rel}`);

if (!findings.length) {
  console.log('  结果：全部有效');
  process.exit(0);
}

console.log(`  结果：发现 ${findings.length} 个问题`);
for (const item of findings) console.log(`    FAIL ${item}`);
process.exit(1);
