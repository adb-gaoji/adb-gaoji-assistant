const assert = require('node:assert/strict');
const test = require('node:test');
const {
  PRIMARY_USER,
  parseUserSpaces,
  cloneUsers,
  planInstall,
  buildInstalledUsersCommand,
  parseInstalledUsers
} = require('../src/clone_policy');

// 摩托罗拉国行的真实用户空间输出（取自 XT2241-1）
const MOTOROLA_USERS = `Users:
	UserInfo{0:机主:4c13} running
	UserInfo{900:应用分身:1010} running
	UserInfo{901:应用分身:1010} running
	UserInfo{902:应用分身:1010} running
	UserInfo{903:应用分身:1010} running
	UserInfo{904:应用分身:1010} running
	UserInfo{905:应用分身:1010} running
	UserInfo{906:应用分身:1010} running
	UserInfo{907:应用分身:1010} running
	UserInfo{908:应用分身:1010} running
	UserInfo{909:应用分身:1010} running
`;

test('parseUserSpaces 解析摩托罗拉的多分身输出', () => {
  const users = parseUserSpaces(MOTOROLA_USERS);
  assert.equal(users.length, 11);
  assert.equal(users[0].id, 0);
  assert.equal(users[0].name, '机主');
  assert.equal(users[0].running, true);
  assert.equal(users[1].id, 900);
  assert.equal(users[1].name, '应用分身');
  assert.equal(users[10].id, 909);
});

test('parseUserSpaces 处理单用户设备', () => {
  const users = parseUserSpaces('Users:\n\tUserInfo{0:Owner:13} running\n');
  assert.equal(users.length, 1);
  assert.equal(users[0].id, 0);
  assert.equal(users[0].name, 'Owner');
});

test('parseUserSpaces 处理空输入与异常文本', () => {
  assert.deepEqual(parseUserSpaces(''), []);
  assert.deepEqual(parseUserSpaces(null), []);
  assert.deepEqual(parseUserSpaces('error: no such command'), []);
  assert.deepEqual(parseUserSpaces('Users:\n'), []);
});

test('cloneUsers 只保留非主用户', () => {
  const users = parseUserSpaces(MOTOROLA_USERS);
  const clones = cloneUsers(users);
  assert.equal(clones.length, 10);
  assert.equal(clones.some((u) => u.id === 0), false);
  assert.deepEqual(clones.map((u) => u.id), [900, 901, 902, 903, 904, 905, 906, 907, 908, 909]);
});

test('planInstall：新应用只装主空间，不新建分身', () => {
  const users = parseUserSpaces(MOTOROLA_USERS);
  const plan = planInstall({ users, existingUsers: [0] });
  assert.equal(plan.primary, PRIMARY_USER);
  assert.deepEqual(plan.clones, []);
  // 10 个分身全部被跳过
  assert.equal(plan.skipped.length, 10);
  assert.match(plan.reason, /没有装过该应用/);
  assert.match(plan.reason, /不会新建分身/);
});

test('planInstall：已有分身时补装那些分身', () => {
  const users = parseUserSpaces(MOTOROLA_USERS);
  // 微信的场景：主空间 + 900/901/902 装过
  const plan = planInstall({ users, existingUsers: [0, 900, 901, 902] });
  assert.deepEqual(plan.clones, [900, 901, 902]);
  assert.equal(plan.skipped.length, 7);
  assert.match(plan.reason, /已在 3 个分身中安装过/);
});

test('planInstall：设备没有分身时只装主空间', () => {
  const users = [{ id: 0, name: '机主', running: true }];
  const plan = planInstall({ users, existingUsers: [0] });
  assert.deepEqual(plan.clones, []);
  assert.match(plan.reason, /没有应用分身空间/);
});

test('planInstall：显式关闭补装时不碰任何分身', () => {
  const users = parseUserSpaces(MOTOROLA_USERS);
  const plan = planInstall({ users, existingUsers: [0, 900], installToClones: false });
  assert.deepEqual(plan.clones, []);
  assert.equal(plan.skipped.length, 10);
  assert.match(plan.reason, /只装主空间/);
});

test('planInstall：全部 10 个分身都装过时全部同步', () => {
  const users = parseUserSpaces(MOTOROLA_USERS);
  const all = [0, 900, 901, 902, 903, 904, 905, 906, 907, 908, 909];
  const plan = planInstall({ users, existingUsers: all });
  assert.equal(plan.clones.length, 10);
  assert.equal(plan.skipped.length, 0);
});

test('buildInstalledUsersCommand 为每个用户生成一条检测', () => {
  const users = parseUserSpaces(MOTOROLA_USERS);
  const command = buildInstalledUsersCommand('com.tencent.mm', users);
  assert.match(command, /--user 0 com\.tencent\.mm/);
  assert.match(command, /--user 900 com\.tencent\.mm/);
  assert.match(command, /--user 909 com\.tencent\.mm/);
  // 每个检测都要 echo 用户 id，供解析用
  assert.equal((command.match(/echo \d+/g) || []).length, 11);
});

test('parseInstalledUsers 解析检测结果', () => {
  assert.deepEqual(parseInstalledUsers('0\n900\n901\n'), [0, 900, 901]);
  assert.deepEqual(parseInstalledUsers('900\n0\n900\n'), [0, 900]);
  assert.deepEqual(parseInstalledUsers(''), []);
  // 混入的非数字行要忽略
  assert.deepEqual(parseInstalledUsers('0\nsome error\n901\n'), [0, 901]);
});

test('回归：修好前会导致 11 个分身的行为不再出现', () => {
  // 这条用例固定住本次修复的核心不变量：
  // 对"任何分身都没装过"的新应用，plan 里不能出现任何分身 id。
  const users = parseUserSpaces(MOTOROLA_USERS);
  for (const existing of [[], [0]]) {
    const plan = planInstall({ users, existingUsers: existing });
    assert.deepEqual(plan.clones, [], `existingUsers=${JSON.stringify(existing)} 时不应产生分身`);
  }
});
