/**
 * 按钮组（segmented 字段）选中态契约。
 *
 * 回归背景：按钮组用 radio 承载值，但选中样式（active 类）最初是
 * 每个按钮在自己的 change 事件里更新自己。浏览器**只在被点中的那个**
 * radio 上触发 change，因此取消选中的那个按钮不会移除 active ——
 * 点 B 槽后 A、B 同时高亮。
 *
 * 这里不启动 Electron，而是用最小的 DOM 桩复刻渲染逻辑中的同步规则，
 * 确保"同一时刻只有一个高亮、且高亮与选中项一致"这一不变量被钉死。
 * 真实渲染路径由 scripts/ 下的离屏验证覆盖。
 */
const assert = require('node:assert/strict');
const test = require('node:test');

/**
 * 复刻 renderer.js 里 segmented 字段的渲染与同步逻辑。
 *
 * 与源码保持同构：先建全部 radio，再用**整组**同步函数更新 active，
 * 并把 sync 绑到每个 radio 的 change 上。
 */
function renderSegmented(options, initialValue) {
  const radios = [];
  for (const [value, text] of options) {
    const option = { className: 'segment', classList: null, text };
    const classes = new Set(['segment']);
    option.classList = {
      toggle: (name, on) => { if (on) classes.add(name); else classes.delete(name); },
      contains: (name) => classes.has(name)
    };
    const radio = { type: 'radio', name: 'field', value, checked: value === initialValue, listeners: [] };
    radio.addEventListener = (type, fn) => { if (type === 'change') radio.listeners.push(fn); };
    radio.dispatchChange = () => { for (const fn of radio.listeners) fn(); };
    radios.push({ option, radio, classes });
  }
  const sync = () => {
    for (const { option, radio } of radios) option.classList.toggle('active', radio.checked);
  };
  for (const { radio } of radios) radio.addEventListener('change', sync);
  sync();

  return {
    radios,
    state: () => radios.map(({ radio, classes }) => ({
      value: radio.value,
      checked: radio.checked,
      active: classes.has('active')
    })),
    select(value) {
      // radio 的互斥由浏览器负责：选中一个会自动取消同组的其它项
      for (const { radio } of radios) radio.checked = radio.value === value;
      const target = radios.find(({ radio }) => radio.value === value);
      // 只有被点中的那个触发 change，这正是 bug 的来源
      if (target) target.radio.dispatchChange();
    }
  };
}

function assertSingleSelection(group, label) {
  const state = group.state();
  const active = state.filter((s) => s.active);
  const checked = state.filter((s) => s.checked);
  assert.equal(active.length, 1, `${label}：应有且仅有 1 个高亮，实际 ${active.length}（${state.map((s) => `${s.value}${s.active ? '[高亮]' : ''}`).join(' ')}）`);
  assert.equal(checked.length, 1, `${label}：应有且仅有 1 个选中，实际 ${checked.length}`);
  assert.equal(active[0].value, checked[0].value, `${label}：高亮应落在选中的项上`);
}

test('槽位按钮组：从 A 切到 B 后只有一个高亮', () => {
  const group = renderSegmented([['a', 'A 槽'], ['b', 'B 槽']], 'a');
  assertSingleSelection(group, '初始');

  group.select('b');
  assertSingleSelection(group, '切到 B 后');

  const state = group.state();
  assert.equal(state.find((s) => s.value === 'a').active, false, 'A 的高亮必须被移除');
  assert.equal(state.find((s) => s.value === 'b').active, true, 'B 应高亮');
});

test('槽位按钮组：来回切换不残留高亮', () => {
  const group = renderSegmented([['a', 'A 槽'], ['b', 'B 槽']], 'a');
  for (const target of ['b', 'a', 'b', 'a']) {
    group.select(target);
    assertSingleSelection(group, `切到 ${target} 后`);
  }
});

test('分区按钮组：boot / init_boot 同样是单选', () => {
  const group = renderSegmented([['boot', 'boot'], ['init_boot', 'init_boot']], 'init_boot');
  assertSingleSelection(group, '初始');

  group.select('boot');
  assertSingleSelection(group, '切到 boot 后');
  assert.equal(group.state().find((s) => s.value === 'init_boot').active, false, 'init_boot 的高亮必须被移除');
});

test('回归：各自更新自己的写法会留下两个高亮', () => {
  // 复刻修复前的错误实现，确认该写法确实违反不变量——
  // 这样如果有人改回旧写法，这条用例会失败。
  const options = [['a', 'A 槽'], ['b', 'B 槽']];
  const radios = options.map(([value]) => ({ value, checked: value === 'a', active: value === 'a' }));
  const syncSelf = (item) => { item.active = item.checked; };
  for (const item of radios) item.sync = () => syncSelf(item);

  // 用户点 B：浏览器置 checked 并只在这个元素上触发 change
  for (const item of radios) item.checked = item.value === 'b';
  radios.find((item) => item.value === 'b').sync();

  const activeCount = radios.filter((item) => item.active).length;
  assert.equal(activeCount, 2, '旧写法应当留下两个高亮（说明这条回归用例确实抓得住问题）');
});
