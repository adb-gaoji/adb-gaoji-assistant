/**
 * V1.2.12：Tea 制作改为「先选原厂 boot，再自动挑供体」。
 *
 * 背景（真实故障）：用户点「用原厂 boot 自动制作」时得到
 *   「未能自动匹配 Tea 模板，已阻止输出。」
 *   「读不到设备机型信息，无法自动匹配模板。请先连接手机并授权 USB 调试。」
 *
 * 根因：旧流程一上来就 getStatus() 读手机、按机型匹配模板，读不到设备
 * 就直接 return。可 Tea 的运行时（tea64/tea32/teapolicy/tea.product）是
 * ARM64 通用件，不随机型变化——制作只需要「一张原厂 boot + 一份完整供体」。
 * 用户刚重新刷机、手机还没连上，就被卡在了第一步之外。
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const matcher = require('../src/tea_matcher.js');

const manifest = require('../resources/tea-templates/manifest.json');

test('自动挑供体：不传设备信息也必须成功（这是旧版失败的场景）', () => {
  const donor = matcher.pickTeaDonor(manifest, 'X:/templates', () => true);
  assert.ok(donor, '没有设备信息时也必须能挑出供体');
  assert.ok(donor.template && donor.path && donor.relative);
});

test('自动挑供体：优先选标记为 tea_core_donor 的那份', () => {
  const donor = matcher.pickTeaDonor(manifest, 'X:/templates', () => true);
  assert.equal(donor.template.tea_core_donor, true, '必须挑中 Tea 核心供体');
  // v1.2.13 更正：唯一实测「国网不闪退」的通用供体是 S30 安卓12 那份。
  // X30 Pro / eqs 那张是**机型专属成品**，虽然同样是第 3 代核心，但它带着
  // X30 Pro 自己的 .backup/init，拿去做别的机型会卡开机，不能再标 tea_core_donor
  // （否则它 8+4 分会盖过真正该用的那份）。
  assert.equal(donor.template.id, 'android12-s30-init-boot-ant-tea');
});

test('自动挑供体：reference_only 模板永远不能当供体', () => {
  const only = {
    templates: [{
      id: 'ref',
      reference_only: true,
      tea_core_donor: true,
      files: ['a.img']
    }]
  };
  assert.equal(matcher.pickTeaDonor(only, 'X:/t', () => true), null,
    '即使标了 tea_core_donor，reference_only 也不能用于输出');
});

test('自动挑供体：文件不存在时跳过，去找下一份可用的', () => {
  const m = {
    templates: [
      { id: 'missing', tea_core_donor: true, files: ['nope.img'] },
      { id: 'present', files: ['yes.img'] }
    ]
  };
  const donor = matcher.pickTeaDonor(m, 'X:/t', (p) => p.endsWith('yes.img'));
  assert.equal(donor.template.id, 'present');
});

test('自动挑供体：一份可用的都没有时返回 null，不硬凑', () => {
  assert.equal(matcher.pickTeaDonor({ templates: [] }, 'X:/t', () => true), null);
  assert.equal(matcher.pickTeaDonor({}, 'X:/t', () => true), null);
  assert.equal(matcher.pickTeaDonor(manifest, 'X:/t', () => false), null,
    '文件全不存在时必须返回 null');
});

test('回归：模板清单里确实存在带 Tea 运行时的供体', () => {
  const donors = (manifest.templates || []).filter((t) => t.tea_core_donor);
  assert.ok(donors.length >= 1, '至少要有一份 Tea 核心供体');
});

test('回归：真实模板库能挑出供体，且路径指向磁盘上真实存在的文件', () => {
  const fs = require('node:fs');
  const library = path.join(__dirname, '..', 'resources', 'tea-templates');
  const donor = matcher.pickTeaDonor(manifest, library, (p) => fs.existsSync(p));
  assert.ok(donor, '真实模板库必须能挑出供体（否则用户点按钮就会失败）');
  assert.ok(fs.existsSync(donor.path), '挑出的供体文件必须真实存在：' + donor.path);
});