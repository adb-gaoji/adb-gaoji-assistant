// 把仓库占位链接替换为真实地址。
// 用法：node scripts/set-repo-url.js <owner>/<repo>
// 例：  node scripts/set-repo-url.js zhangsan/adb-gaoji-assistant
const fs = require('node:fs');
const path = require('node:path');

const slug = process.argv[2];
if (!slug || !/^[\w.-]+\/[\w.-]+$/.test(slug)) {
  console.error('用法: node scripts/set-repo-url.js <owner>/<repo>');
  console.error('例:   node scripts/set-repo-url.js zhangsan/adb-gaoji-assistant');
  process.exit(1);
}

const root = path.join(__dirname, '..');
const base = `https://github.com/${slug}`;

// 占位符形态：https://github.com/ 后面紧跟 ) 或空白或行尾
const placeholder = /https:\/\/github\.com\/(?=[)\s"'#]|$)/g;
// 顺带修掉半角裸 URL 类型的引用
const targets = [
  'README.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'CODE_OF_CONDUCT.md',
  'THIRD-PARTY-NOTICES.md',
  'VERSIONS.md',
  '.github/pull_request_template.md',
  '.github/ISSUE_TEMPLATE/bug_report.yml',
  '.github/ISSUE_TEMPLATE/feature_request.yml',
  '.github/ISSUE_TEMPLATE/device_report.yml',
  '.github/ISSUE_TEMPLATE/config.yml'
];

let changed = 0;
for (const rel of targets) {
  const full = path.join(root, rel);
  if (!fs.existsSync(full)) continue;
  const before = fs.readFileSync(full, 'utf8');
  const count = (before.match(placeholder) || []).length;
  if (!count) continue;
  const after = before.replace(placeholder, `${base}/`);
  fs.writeFileSync(full, after, 'utf8');
  console.log(`  ${rel}: 替换 ${count} 处`);
  changed += count;
}

// package.json 补 repository / bugs / homepage
const pkgPath = path.join(root, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
pkg.repository = { type: 'git', url: `git+${base}.git` };
pkg.bugs = { url: `${base}/issues` };
pkg.homepage = `${base}#readme`;
fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
console.log('  package.json: 已写入 repository / bugs / homepage');

// 把指向仓库根目录的链接指向具体子路径
const precise = [
  ['README.md', /(\[Releases\]\()https:\/\/github\.com\/[^)]*\/\)/g, `$1${base}/releases)`],
  ['README.md', /(\[Issues\]\()https:\/\/github\.com\/[^)]*\/\)/g, `$1${base}/issues)`],
  ['CONTRIBUTING.md', /(\[Issue 模板\]\()https:\/\/github\.com\/[^)]*\/\)/g, `$1${base}/issues/new/choose)`],
  ['.github/ISSUE_TEMPLATE/bug_report.yml', /(\[最新版本\]\()https:\/\/github\.com\/[^)]*\/\)/g, `$1${base}/releases/latest)`],
  ['.github/ISSUE_TEMPLATE/bug_report.yml', /(\[私密漏洞报告\]\()https:\/\/github\.com\/[^)]*\/\)/g, `$1${base}/security/advisories/new)`]
];
for (const [rel, re, to] of precise) {
  const full = path.join(root, rel);
  if (!fs.existsSync(full)) continue;
  const before = fs.readFileSync(full, 'utf8');
  const after = before.replace(re, to);
  if (after !== before) {
    fs.writeFileSync(full, after, 'utf8');
    console.log(`  ${rel}: 已指向具体子路径`);
  }
}

// config.yml 的 contact_links 需要具体地址
const cfgPath = path.join(root, '.github/ISSUE_TEMPLATE/config.yml');
if (fs.existsSync(cfgPath)) {
  let cfg = fs.readFileSync(cfgPath, 'utf8');
  cfg = cfg
    .replace(/(安全漏洞[\s\S]*?url:\s*)\S+/, `$1${base}/security/advisories/new`)
    .replace(/(使用问题与讨论[\s\S]*?url:\s*)\S+/, `$1${base}/discussions`)
    .replace(/(贡献指南[\s\S]*?url:\s*)\S+/, `$1${base}/blob/main/CONTRIBUTING.md`);
  fs.writeFileSync(cfgPath, cfg, 'utf8');
  console.log('  .github/ISSUE_TEMPLATE/config.yml: 已指向具体子路径');
}

// lock 同步
const lockPath = path.join(root, 'package-lock.json');
const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
lock.name = pkg.name;
lock.version = pkg.version;
lock.packages[''].name = pkg.name;
lock.packages[''].version = pkg.version;
if (!lock.packages[''].repository) lock.packages[''].repository = pkg.repository;
fs.writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
console.log('  package-lock.json: 已同步');

console.log('');
console.log(`完成，共替换 ${changed} 处，仓库地址 ${base}`);
