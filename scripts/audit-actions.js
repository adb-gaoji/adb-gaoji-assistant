const fs = require('node:fs');
const path = require('node:path');
const { ACTION_IDS, createActionHandlers } = require('../src/action_handlers');
const { FASTBOOT_REQUIRED_ACTIONS, ADB_REQUIRED_ACTIONS, DANGEROUS_ACTIONS: REGISTRY_DANGEROUS } = require('../src/actions.registry');

const root = path.resolve(__dirname, '..');
const actionSource = fs.readFileSync(path.join(root, 'src', 'action_handlers.js'), 'utf8');
const rendererSource = fs.readFileSync(path.join(root, 'src', 'renderer.js'), 'utf8');
const mainSource = fs.readFileSync(path.join(root, 'src', 'main.js'), 'utf8');

/**
 * 从 main.js 的 dispatchAction switch 中抽取所有 case 标签。
 *
 * 为什么不用手写白名单：此前界面动作是否"已登记"靠一个手写的
 * specialUiActions 集合放行，新增 main.js 动作时忘了同步就会误报 P1，
 * 而误报多了之后真正的缺口反而被淹没。改为从源码自动抽取，
 * 新增动作只要写了 case 就会被识别，漏写 case 则会暴露出来。
 */
function collectMainSwitchActions() {
  const ids = new Set();
  for (const match of mainSource.matchAll(/case '([a-z0-9-]+)':/g)) ids.add(match[1]);
  return ids;
}
const mainSwitchActions = collectMainSwitchActions();

const DEVICE_BOUND_ACTIONS = new Set([
  'adb-reboot-system', 'launch-package', 'install-apk-single', 'install-apk-batch', 'install-framework',
  'export-apk', 'export-apks-batch', 'uninstall-package', 'uninstall-packages-batch', 'clear-app-data',
  'freeze-app-user0', 'freeze-apps-user0-batch', 'unfreeze-app-user0', 'unfreeze-apps-user0-batch',
  'gms-uninstall', 'gms-fix-crash', 'gms-persistent-fix', 'clear-storage-cache', 'clear-storage-junk',
  'clear-storage-photos', 'clear-storage-videos', 'list-packages', 'storage-summary', 'list-storage-files',
  'export-storage-files', 'pull-path', 'push-file', 'screenshot', 'screenrecord', 'change-dpi', 'change-size',
  'reset-display', 'wireless-adb', 'wireless-mirror', 'check-zygisk', 'configure-denylist-user-apps',
  'list-magisk-modules', 'backup-key-partitions', 'bootanim-backup', 'bootanim-extract-portable',
  'bootanim-install-zip', 'bootanim-install-checked', 'bootanim-install-latest-portable', 'bootanim-restore'
]);

const DANGEROUS_ACTIONS = new Set([
  'flash-image', 'fastboot-set-active', 'lenovo-unlock-go', 'moto-bl-unlock', 'reboot-fastbootd',
  'gms-uninstall', 'gms-fix-crash', 'gms-persistent-fix', 'uninstall-package', 'uninstall-packages-batch',
  'clear-app-data', 'freeze-app-user0', 'freeze-apps-user0-batch', 'clear-storage-cache', 'clear-storage-junk',
  'clear-storage-photos', 'clear-storage-videos', 'bootanim-install-zip', 'bootanim-install-checked',
  'bootanim-install-latest-portable', 'bootanim-restore', 'reset-display'
]);

function createNoopContext() {
  const noopResult = async () => ({ code: 0, stdout: '', stderr: '' });
  return {
    app: { getPath: () => path.join(root, '.audit-output') },
    dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }), showMessageBox: async () => ({ response: 1 }) },
    shell: { openPath: async () => '', openExternal: async () => undefined },
    adb: noopResult,
    fastboot: noopResult,
    runProcess: noopResult,
    sendLog: () => undefined,
    getResourceRoot: () => path.join(root, 'resources'),
    getMainWindow: () => null,
    getStatus: async () => ({ mode: '未连接' }),
    getSelectedFirmware: () => null,
    lines: (value) => String(value || '').split(/\r?\n/).filter(Boolean),
    uniqueOutputPath: (dir, name) => path.join(dir, name),
    getActionHistoryPath: () => path.join(root, '.audit-output', 'action-history.jsonl'),
    getCommandHistoryPath: () => path.join(root, '.audit-output', 'command-history.jsonl'),
    getRendererLogPath: () => path.join(root, '.audit-output', 'renderer.log')
  };
}

function extractHandlerBody(action) {
  const marker = `handlers['${action}']`;
  const start = actionSource.indexOf(marker);
  if (start < 0) return '';
  const next = actionSource.indexOf("\n  handlers['", start + marker.length);
  return actionSource.slice(start, next < 0 ? actionSource.length : next);
}

function auditActions() {
  const handlers = createActionHandlers(createNoopContext());
  const ids = [...new Set(ACTION_IDS)];
  const handlerIds = Object.keys(handlers);
  const missingHandlers = ids.filter((id) => !handlerIds.includes(id));
  const extraHandlers = handlerIds.filter((id) => !ids.includes(id));
  const uiActions = [...rendererSource.matchAll(/data-action="([^"]+)"/g)].map((match) => match[1]);
  const htmlSource = fs.readFileSync(path.join(root, 'src', 'renderer.html'), 'utf8');
  const htmlUiActions = [...htmlSource.matchAll(/data-action="([^"]+)"/g)].map((match) => match[1]);

  // 界面动作的合法来源有三处：
  //   1) action_handlers.js 的 ACTION_IDS（绝大多数）
  //   2) main.js 的 dispatchAction switch（需要主进程能力，如弹文件选择框）
  //   3) renderer.js 里自己消费、不发给主进程的纯前端动作
  //      （例如 firmware-downloads 只是展开本地固件库面板）
  // 判据全部取自源码而非手写白名单，避免新增动作时漏同步。
  const rendererLocalActions = new Set(
    [...rendererSource.matchAll(/closest\('\[data-action="([^"]+)"\]'\)/g)].map((match) => match[1])
  );
  const unregisteredUiActions = [...new Set([...uiActions, ...htmlUiActions])]
    .filter((id) => !ids.includes(id) && !mainSwitchActions.has(id) && !rendererLocalActions.has(id));
  const directAdbActions = [...DEVICE_BOUND_ACTIONS].filter((id) => {
    const body = extractHandlerBody(id);
    return body.includes('adb(') && !body.includes('adbFor(') && !body.includes('requireSelectedAdb');
  });
  const shellInterpolationLines = actionSource.split(/\r?\n/)
    .map((line, index) => ({ line: index + 1, text: line }))
    .filter(({ text }) => /\['shell',\s*'-c',\s*`/.test(text));
  const storageExportUsesBasename = /const target = path\.join\(dir, path\.basename\(String\(file\.path\)\)/.test(actionSource);
  const storagePathTraversalGuard = /normalizeStorageRemotePath[\s\S]*segment === '\.\.'/ .test(actionSource)
    && /handlers\['export-storage-files'\][\s\S]*normalizeStorageRemotePath/.test(actionSource);
  const dangerActions = [...DANGEROUS_ACTIONS];

  // 注册表里声明的模式要求，必须对应真实存在的动作。
  // 否则会出现"界面以为某动作需要 Fastboot、实际该动作根本不存在"这类静默失配：
  // 用户看到按钮被禁用，却不知道原因。
  const registryKnown = new Set([...ids, ...mainSwitchActions]);
  const registryOrphans = [
    ...FASTBOOT_REQUIRED_ACTIONS.filter((id) => !registryKnown.has(id)).map((id) => `fastboot:${id}`),
    ...ADB_REQUIRED_ACTIONS.filter((id) => !registryKnown.has(id)).map((id) => `adb:${id}`),
    ...REGISTRY_DANGEROUS.filter((id) => !registryKnown.has(id)).map((id) => `danger:${id}`)
  ];

  // 哪些危险动作有专属确认文案（registry 的 ACTION_CONFIRMS 或按钮的 data-confirm），
  // 其余走通用兜底。仅用于统计展示，不参与判定。
  const registrySource = fs.readFileSync(path.join(root, 'src', 'actions.registry.js'), 'utf8');
  const confirmTexts = [...registrySource.matchAll(/^\s*'([a-z0-9-]+)':/gm)].map((m) => m[1]);
  const confirmHandled = new Set([
    ...confirmTexts,
    ...[...htmlSource.matchAll(/data-action="([^"]+)"[^>]*data-confirm=/g)].map((m) => m[1])
  ]);

  // 危险动作的确认层必须真的兜住它们。
  //
  // 判据不是"每个按钮都要写 data-confirm"——renderer.js 里的
  // askRiskConfirmation 会用通用文案兜底，没写 data-confirm 属于正常设计。
  // 真正要保证的是**这条兜底链路本身存在**：
  //   1) renderer.js 里存在通用确认函数，且被危险动作分支调用；
  //   2) 主进程会拒绝缺少 riskConfirmed 标记的危险请求。
  // 缺任何一条，危险动作就可能被静默放行——那才是 P0。
  const hasRiskConfirmFlow =
    /function askRiskConfirmation\s*\(/.test(rendererSource) &&
    /DANGEROUS_ACTIONS\.has\(action\)/.test(rendererSource);
  const mainRejectsUnconfirmed =
    /riskConfirmed/.test(mainSource) &&
    /DANGEROUS_ACTIONS\.has\(action\)|DANGEROUS_ACTIONS\.includes\(action\)/.test(mainSource);

  const findings = [];
  if (missingHandlers.length) findings.push({ severity: 'P0', id: 'missing-handler', actions: missingHandlers });
  if (unregisteredUiActions.length) findings.push({ severity: 'P1', id: 'unregistered-ui-action', actions: unregisteredUiActions });
  if (directAdbActions.length) findings.push({ severity: 'P0', id: 'device-action-without-selected-serial-guard', actions: directAdbActions });
  if (registryOrphans.length) findings.push({ severity: 'P1', id: 'registry-action-not-implemented', actions: registryOrphans });
  if (!hasRiskConfirmFlow) findings.push({ severity: 'P0', id: 'risk-confirm-flow-missing', detail: '界面缺少通用危险确认流程' });
  if (!mainRejectsUnconfirmed) findings.push({ severity: 'P0', id: 'main-process-does-not-enforce-risk-confirmed', detail: '主进程未强制校验 riskConfirmed 标记' });
  if (shellInterpolationLines.length) findings.push({ severity: 'P1', id: 'shell-command-interpolation', lines: shellInterpolationLines });
  if (storageExportUsesBasename) findings.push({ severity: 'P1', id: 'storage-export-basename-collision', action: 'export-storage-files' });
  if (!storagePathTraversalGuard) findings.push({ severity: 'P1', id: 'storage-export-path-boundary-unverified', action: 'export-storage-files' });
  return {
    version: 'V20.5.2',
    generatedAt: new Date().toISOString(),
    actions: { declared: ids.length, handlers: handlerIds.length, missingHandlers, extraHandlers, unregisteredUiActions },
    dangerActions: {
      declared: dangerActions.length,
      // 写明专属确认文案与走通用兜底的数量，便于人工判断覆盖是否合理
      withCustomConfirmText: REGISTRY_DANGEROUS.filter((id) => confirmHandled.has(id)).length,
      usingGenericConfirm: REGISTRY_DANGEROUS.filter((id) => !confirmHandled.has(id)).length
    },
    findings,
    status: findings.length ? 'findings-require-fix' : 'pass'
  };
}

if (require.main === module) {
  const report = auditActions();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.findings.some((finding) => finding.severity === 'P0')) process.exitCode = 2;
  else if (report.findings.length) process.exitCode = 1;
}

module.exports = { auditActions };
