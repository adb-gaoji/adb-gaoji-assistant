const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const handlerSource = fs.readFileSync(path.join(root, 'src', 'action_handlers.js'), 'utf8');
const rendererSource = fs.readFileSync(path.join(root, 'src', 'renderer.js'), 'utf8');
const htmlSource = fs.readFileSync(path.join(root, 'src', 'renderer.html'), 'utf8');

function auditMirrorSession() {
  const scrcpyBody = handlerSource.match(/async function scrcpy\([\s\S]*?\n  \}/)?.[0] || '';
  const checks = [
    ['session-registry-present', () => handlerSource.includes('const mirrorSessions = new Map()')],
    ['duplicate-session-returns-409', () => scrcpyBody.includes("return fail(`${label}已经在设备 ${serial || '默认设备'} 上运行。`, 409)")],
    ['session-records-process-lifecycle', () => scrcpyBody.includes("state: 'starting'") && scrcpyBody.includes("state = 'running'") && scrcpyBody.includes("state = 'exited'")],
    ['session-stop-handler-present', () => /handlers\['stop-mirror'\][\s\S]*?\.child\.kill\(\)/.test(handlerSource)],
    ['session-status-handler-present', () => handlerSource.includes("handlers['mirror-session-status']")],
    ['projection-actions-bind-selected-serial', () => /startSelectedMirror\(payload/.test(handlerSource) && /handlers\['start-mirror'\]\s*=\s*async \(payload\)/.test(handlerSource)],
    ['renderer-registers-session-actions', () => htmlSource.includes('data-action="mirror-session-status"') && htmlSource.includes('data-action="stop-mirror"') && rendererSource.includes("'stop-mirror': '停止投屏'")]
  ];
  const findings = checks.filter(([, check]) => !check()).map(([id]) => ({ severity: 'P0', id }));
  return {
    version: 'V20.5.8',
    generatedAt: new Date().toISOString(),
    checks: checks.map(([id, check]) => ({ id, passed: check() })),
    findings,
    warnings: [],
    status: findings.length ? 'findings-require-fix' : 'pass'
  };
}

if (require.main === module) {
  const report = auditMirrorSession();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.findings.some((finding) => finding.severity === 'P0')) process.exitCode = 2;
}

module.exports = { auditMirrorSession };

