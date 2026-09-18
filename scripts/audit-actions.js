const fs = require('node:fs');
const path = require('node:path');
const { ACTION_IDS, createActionHandlers } = require('../src/action_handlers');

const root = path.resolve(__dirname, '..');
const actionSource = fs.readFileSync(path.join(root, 'src', 'action_handlers.js'), 'utf8');
const rendererSource = fs.readFileSync(path.join(root, 'src', 'renderer.js'), 'utf8');

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
  const specialUiActions = new Set(['firmware-downloads', 'reboot-system', 'reboot-recovery', 'reboot-fastboot', 'fastboot-reboot', 'firmware-open-url']);
  const unregisteredUiActions = [...new Set(uiActions)].filter((id) => !ids.includes(id) && !specialUiActions.has(id));
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
  const findings = [];
  if (missingHandlers.length) findings.push({ severity: 'P0', id: 'missing-handler', actions: missingHandlers });
  if (unregisteredUiActions.length) findings.push({ severity: 'P1', id: 'unregistered-ui-action', actions: unregisteredUiActions });
  if (directAdbActions.length) findings.push({ severity: 'P0', id: 'device-action-without-selected-serial-guard', actions: directAdbActions });
  if (shellInterpolationLines.length) findings.push({ severity: 'P1', id: 'shell-command-interpolation', lines: shellInterpolationLines });
  if (storageExportUsesBasename) findings.push({ severity: 'P1', id: 'storage-export-basename-collision', action: 'export-storage-files' });
  if (!storagePathTraversalGuard) findings.push({ severity: 'P1', id: 'storage-export-path-boundary-unverified', action: 'export-storage-files' });
  return {
    version: 'V20.5.2',
    generatedAt: new Date().toISOString(),
    actions: { declared: ids.length, handlers: handlerIds.length, missingHandlers, extraHandlers, unregisteredUiActions },
    dangerActions: { declared: dangerActions.length },
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
