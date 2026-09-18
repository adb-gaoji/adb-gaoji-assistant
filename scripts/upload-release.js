#!/usr/bin/env node
/**
 * 把构建好的安装包上传到 GitHub Release。
 *
 * 用法：
 *   GITHUB_TOKEN=<token> node scripts/upload-release.js v1.1.0
 *   node scripts/upload-release.js v1.1.0 --dist dist --archive "C:\path\to\installers"
 *
 * 为什么单独写一个脚本、而不是复用 electron-builder 的 publish：
 *
 * 1) electron-builder 的 GitHub publish 需要把 token 写进环境或配置，
 *    而这里的发布流程是「本地打包 → 归档到桌面 → 手工确认后上传」，
 *    打包与发布分成两步，出问题时不至于半路中断留下残缺 Release。
 *
 * 2) GitHub 上传附件会把非 ASCII 文件名剥离成 `ADB._V1.1.0_.exe`，
 *    与 README / VERSIONS.md / 自动更新配置里写的名字对不上。
 *    本脚本显式使用 ASCII 名称，保证文档与实际下载地址一致。
 *
 * 3) 支持断点式重跑：已存在同名附件时跳过，不会重复占用带宽。
 */
'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');

const REPO = process.env.GITHUB_REPOSITORY || 'adb-gaoji/adb-gaoji-assistant';

function parseArgs(argv) {
  const options = { tag: '', dist: 'dist', archive: '', owner: '', repo: REPO };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dist') options.dist = argv[++i];
    else if (arg === '--archive') options.archive = argv[++i];
    else if (arg === '--repo') options.repo = argv[++i];
    else if (!arg.startsWith('--') && !options.tag) options.tag = arg;
  }
  return options;
}

function apiPath(repo, suffix) {
  return `/repos/${repo}${suffix}`;
}

function api(token, method, apiPathValue, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = https.request({
      hostname: 'api.github.com',
      path: apiPathValue,
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

function uploadAsset(token, repo, releaseId, file, name) {
  return new Promise((resolve, reject) => {
    const stat = fs.statSync(file);
    const url = new URL(`https://uploads.github.com${apiPath(repo, `/releases/${releaseId}/assets`)}?name=${encodeURIComponent(name)}`);
    process.stdout.write(`  上传 ${name}（${(stat.size / 1048576).toFixed(1)} MB）`);
    const startedAt = Date.now();
    let lastPercent = -10;
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        Authorization: `token ${token}`,
        'User-Agent': 'adb-gaoji-assistant',
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/octet-stream',
        'Content-Length': stat.size
      }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode === 201) {
          const json = JSON.parse(data);
          const seconds = ((Date.now() - startedAt) / 1000).toFixed(0);
          process.stdout.write(`\r  完成 ${name}（${seconds}s）\n`);
          resolve(json);
        } else {
          process.stdout.write('\n');
          reject(new Error(`上传 ${name} 失败 HTTP ${res.statusCode}：${data.slice(0, 300)}`));
        }
      });
    });
    req.on('error', reject);
    const stream = fs.createReadStream(file);
    stream.on('data', () => {
      const percent = Math.floor((req.socket.bytesWritten / stat.size) * 100);
      if (percent >= lastPercent + 10) {
        lastPercent = percent;
        process.stdout.write(`\r  ${name} ${percent}%`);
      }
    });
    stream.on('error', reject);
    stream.pipe(req);
  });
}

/** GitHub 会剥离非 ASCII 文件名，这里统一映射成 ASCII 再上传。 */
function toAssetName(fileName, version) {
  if (/\.blockmap$/.test(fileName)) return `ADB-GaoJi-Assistant-V${version}-Setup.exe.blockmap`;
  if (/\.exe$/.test(fileName)) return `ADB-GaoJi-Assistant-V${version}-Setup.exe`;
  return fileName.replace(/[^\x20-\x7E]/g, '');
}

function findInstallers(options, version) {
  const dirs = [options.dist, options.archive].filter(Boolean);
  const found = [];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir)) {
      if (!entry.includes(`V${version}`) && !entry.includes(version)) continue;
      if (!/安装包\.exe(\.blockmap)?$/.test(entry)) continue;
      const full = path.join(dir, entry);
      if (!found.some((item) => item.name === entry)) found.push({ file: full, name: entry });
    }
  }
  return found;
}

(async () => {
  const options = parseArgs(process.argv.slice(2));
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!token) {
    console.error('缺少 GITHUB_TOKEN 环境变量。');
    console.error('用法：GITHUB_TOKEN=<token> node scripts/upload-release.js v1.1.0');
    process.exit(2);
  }
  if (!options.tag) {
    console.error('缺少 tag 参数。用法：node scripts/upload-release.js v1.1.0');
    process.exit(2);
  }

  const version = options.tag.replace(/^v/, '');
  const files = findInstallers(options, version);
  if (!files.length) {
    console.error(`未找到 V${version} 的安装包。请先运行 npm run dist，或用 --dist / --archive 指定目录。`);
    process.exit(1);
  }

  const release = await api(token, 'GET', apiPath(options.repo, `/releases/tags/${options.tag}`));
  if (release.status !== 200) {
    console.error(`获取 Release ${options.tag} 失败 HTTP ${release.status}。请先创建 Release。`);
    process.exit(1);
  }
  const releaseId = release.json.id;
  const existing = new Set((release.json.assets || []).map((asset) => asset.name));
  console.log(`Release ${options.tag}（id=${releaseId}），现有附件 ${existing.size} 个。`);

  const uploaded = [];
  for (const item of files) {
    const assetName = toAssetName(item.name, version);
    if (existing.has(assetName)) {
      console.log(`  已存在，跳过 ${assetName}`);
      continue;
    }
    const asset = await uploadAsset(token, options.repo, releaseId, item.file, assetName);
    uploaded.push(asset);
  }

  const final = await api(token, 'GET', apiPath(options.repo, `/releases/tags/${options.tag}`));
  console.log('\n附件列表：');
  for (const asset of final.json.assets || []) {
    console.log(`  ${asset.name}  ${(asset.size / 1048576).toFixed(1)} MB`);
    console.log(`    ${asset.browser_download_url}`);
  }
  if (!uploaded.length) console.log('\n（没有新上传的附件）');
})().catch((error) => {
  console.error(`失败：${error.message}`);
  process.exit(1);
});
