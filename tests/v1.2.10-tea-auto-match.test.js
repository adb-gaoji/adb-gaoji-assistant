const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { androidMajor, matchTeaTemplate, pickTeaSlotFile } = require('../src/tea_matcher');

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'resources', 'tea-templates', 'manifest.json'), 'utf8'));

/** 造一个设备状态；默认是已实机验证过的 XT2241-1 / eqs / Android 14。 */
function device(props = {}, slotInfo = {}) {
  return {
    props: { manufacturer: 'motorola', device: 'eqs', model: 'XT2241-1', android: '14', ...props },
    slotInfo: { isAbDevice: true, currentSlot: 'a', ...slotInfo }
  };
}

// ---------------------------------------------------------------------------
// 自动匹配：用户不该被问"你的手机该用哪个模板"
// ---------------------------------------------------------------------------

test('按设备代号自动匹配到 XT2241 的 Android 14 模板，无需用户选择', () => {
  const r = matchTeaTemplate(manifest, device());
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.template.code, 'eqs');
  assert.equal(r.template.android, '14');
});

test('优先选用实机验证过的模板，而不是随便挑一个', () => {
  const r = matchTeaTemplate(manifest, device());
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.template.real_device_verified, true, '应优先实机验证过的模板');
});

test('代号匹配不到时退回机型名匹配', () => {
  const r = matchTeaTemplate(manifest, device({ device: 'unknown_code' }));
  assert.equal(r.ok, true, r.reason);
  assert.match(r.reason, /机型名/, '应说明是按机型名匹配的');
});

test('机型完全不认识时明确报错并列出模板库覆盖范围，而不是猜一个', () => {
  const r = matchTeaTemplate(manifest, device({ device: 'zzz', model: 'GT-I9300' }));
  assert.equal(r.ok, false, '不认识的机型不能猜模板');
  assert.match(r.reason, /没有适配当前设备的模板/);
  assert.match(r.reason, /模板库覆盖/, '应告诉用户模板库覆盖了哪些机型');
});

test('读不到设备信息时拒绝匹配，而不是继续输出', () => {
  const r = matchTeaTemplate(manifest, { props: {} });
  assert.equal(r.ok, false);
  assert.match(r.reason, /读不到设备机型信息/);
});

test('reference_only 模板即使在机型匹配上时也不允许直接输出', () => {
  // X30 Pro 有一个 android13 的 reference_only 模板；构造设备只命中它。
  const onlyReference = {
    templates: [
      { id: 'ref-only', android: '13', model: 'Motorola X30 Pro', code: 'x30pro',
        partition: 'init_boot', reference_only: true, files: ['a.img'], notes: '仅结构参考' }
    ]
  };
  const r = matchTeaTemplate(onlyReference, device({ device: 'x30pro', model: 'X30 Pro', android: '13' }));
  assert.equal(r.ok, false, 'reference_only 模板不能作为输出');
  assert.match(r.reason, /reference_only/);
});

test('同机型多个等价模板无法区分时，列出来而不是任选其一', () => {
  const ambiguous = {
    templates: [
      { id: 'tpl-a', android: '14', model: 'M', code: 'c', files: ['a.img'] },
      { id: 'tpl-b', android: '14', model: 'M', code: 'c', files: ['b.img'] }
    ]
  };
  const r = matchTeaTemplate(ambiguous, device({ device: 'c', model: 'M' }));
  assert.equal(r.ok, false, '存在歧义时必须报错而非任选');
  assert.match(r.reason, /无法自动决定/);
  assert.match(r.reason, /tpl-a/);
  assert.match(r.reason, /tpl-b/);
});

// ---------------------------------------------------------------------------
// 槽位自动判定
// ---------------------------------------------------------------------------

test('活动槽位是 B 时自动取 B 槽镜像', () => {
  const template = { files: ['boot_a.img', 'boot_b.img'] };
  const pick = pickTeaSlotFile(template, device({}, { isAbDevice: true, currentSlot: 'b' }));
  assert.equal(pick.slot, 'B');
  assert.equal(pick.relative, 'boot_b.img');
});

test('活动槽位是 A 时自动取 A 槽镜像', () => {
  const template = { files: ['boot_a.img', 'boot_b.img'] };
  const pick = pickTeaSlotFile(template, device({}, { isAbDevice: true, currentSlot: 'a' }));
  assert.equal(pick.slot, 'A');
  assert.equal(pick.relative, 'boot_a.img');
});

test('单槽机型固定取第一个镜像', () => {
  const template = { files: ['boot.img'] };
  const pick = pickTeaSlotFile(template, device({}, { isAbDevice: false, currentSlot: '' }));
  assert.equal(pick.relative, 'boot.img');
});

test('androidMajor 能解析各种版本写法', () => {
  assert.equal(androidMajor('14'), 14);
  assert.equal(androidMajor('13/14'), 13);
  assert.equal(androidMajor('Android 12'), 12);
  assert.equal(androidMajor(''), 0);
});
