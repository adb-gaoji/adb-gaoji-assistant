#!/usr/bin/env node
/**
 * 创建（或更新）GitHub Release，并把安装包 SHA256 写进说明。
 *
 * 用法：
 *   GITHUB_TOKEN=<token> node scripts/create-release.js v1.2.2
 *   node scripts/create-release.js v1.2.2 --repo owner/name --title "自定义标题"
 *
 * 与 upload-release.js 的分工：
 *   本脚本负责「建 Release + 写说明」，upload-release.js 负责「传附件」。
 *   分开是因为附件有 500 MB，上传慢且可能中断；说明可以随时改，
 *   不必为了改一段文字重传安装包。
 *
 * Release 说明的来源：
 *   1. 从 VERSIONS.md 抽取当前版本段落（面向用户的变更说明）；
 *   2. 前置一段本版重点（可选用 --intro 指定文件覆盖）；
 *   3. 自动追加安装包 SHA256，便于下载者核对完整性。
 */
'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const options = { tag: '', repo: 'adb-gaoji/adb-gaoji-assistant', title: '', intro: '', also: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--repo') options.repo = argv[++i];
    else if (arg === '--title') options.title = argv[++i];
    else if (arg === '--intro') options.intro = argv[++i];
    // 把尚未单独发过 Release 的历史版本段落也带上，
    // 否则从更早版本升级的用户不知道中间改了什么。
    else if (arg === '--also') options.also.push(argv[++i].replace(/^v/, ''));
    else if (!arg.startsWith('--') && !options.tag) options.tag = arg;
  }
  return options;
}

function api(token, method, apiPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = https.request({
      hostname: 'api.github.com',
      path: apiPath,
      method,
      headers: Object.assign({
        Authorization: `token ${token}`,
        'User-Agent': 'adb-gaoji-assistant',
        Accept: 'application/vnd.github+json'
      }, payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {})
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (error) { /* 非 JSON 响应 */ }
        resolve({ status: res.statusCode, json, raw: data });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/** 从 VERSIONS.md 抽取某个版本的段落。标题行形如 "  【1.2.2】 日期 · 名称"。 */
function extractVersionSection(version) {
  const text = fs.readFileSync(path.join(ROOT, 'VERSIONS.md'), 'utf8');
  const lines = text.split(/\r?\n/);
  const heads = [];
  lines.forEach((line, index) => {
    const match = line.match(/【(\d+\.\d+\.\d+)】/);
    if (match) heads.push({ version: match[1], line: index });
  });
  const target = heads.find((head) => head.version === version);
  if (!target) return '';
  const next = heads.find((head) => head.line > target.line);
  const start = Math.max(0, target.line - 1);
  const end = next ? Math.max(start, next.line - 2) : lines.length;
  return lines.slice(start, end).join('\n').replace(/\s+$/, '');
}

function sha256(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')))
      .on('error', reject);
  });
}

(async () => {
  const options = parseArgs(process.argv.slice(2));
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!token) {
    console.error('缺少 GITHUB_TOKEN 环境变量。');
    process.exit(2);
  }
  if (!options.tag) {
    console.error('缺少 tag 参数。用法：node scripts/create-release.js v1.2.2');
    process.exit(2);
  }

  const version = options.tag.replace(/^v/, '');
  const installerName = `ADB搞机助手_V${version}_安装包.exe`;
  const installer = path.join(ROOT, 'dist', installerName);
  const assetBase = `ADB-GaoJi-Assistant-V${version}-Setup.exe`;

  // 组装说明
  const parts = [];
  if (options.intro && fs.existsSync(options.intro)) {
    parts.push(fs.readFileSync(options.intro, 'utf8').trim());
  }
  const section = extractVersionSection(version);
  if (section) parts.push(section);

  // 未单独发过 Release 的历史版本一并附上
  for (const older of options.also) {
    const olderSection = extractVersionSection(older);
    if (olderSection) parts.push(olderSection);
    else console.warn(`提示：VERSIONS.md 中没有 ${older} 的段落，已跳过。`);
  }

  if (fs.existsSync(installer)) {
    const hash = await sha256(installer);
    parts.push([
      '## 安装与校验',
      '',
      `下载 \`${assetBase}\`（约 ${(fs.statSync(installer).size / 1048576).toFixed(0)} MB，` +
      '已内置 adb / fastboot / scrcpy / 驱动 / Magisk / 谷歌三件套 / 固件模板，装完离线可用）。',
      '',
      '本版安装包 SHA256：',
      '',
      '```',
      hash,
      '```',
      '',
      '```powershell',
      `Get-FileHash .\\${assetBase} -Algorithm SHA256`,
      '```',
      '',
      '与上面的值对比，一致才说明文件完整。'
    ].join('\n'));
  } else {
    console.warn(`提示：未找到 ${installerName}，说明里不含 SHA256。先运行 npm run dist 再执行本脚本。`);
  }

  const body = parts.join('\n\n---\n\n');
  const title = options.title || `ADB搞机助手 V${version}`;

  console.log(`仓库    : ${options.repo}`);
  console.log(`标签    : ${options.tag}`);
  console.log(`标题    : ${title}`);
  console.log(`说明长度: ${body.length} 字符`);
  console.log('');

  const existing = await api(token, 'GET', `/repos/${options.repo}/releases/tags/${options.tag}`);
  let release;
  if (existing.status === 200) {
    console.log('Release 已存在，更新说明…');
    release = await api(token, 'PATCH', `/repos/${options.repo}/releases/${existing.json.id}`, { body, name: title });
  } else {
    console.log('创建 Release…');
    release = await api(token, 'POST', `/repos/${options.repo}/releases`, {
      tag_name: options.tag,
      target_commitish: 'main',
      name: title,
      body,
      draft: false,
      prerelease: false
    });
  }

  if (release.status !== 200 && release.status !== 201) {
    console.error(`失败 HTTP ${release.status}：${(release.json && release.json.message) || release.raw.slice(0, 300)}`);
    process.exit(1);
  }

  console.log('  成功');
  console.log('  ' + release.json.html_url);
  console.log('');
  console.log('下一步：上传附件（幂等，已存在会跳过）');
  console.log(`  GITHUB_TOKEN=<token> node scripts/upload-release.js ${options.tag}`);
})().catch((error) => {
  console.error('异常：' + error.message);
  process.exit(1);
});
