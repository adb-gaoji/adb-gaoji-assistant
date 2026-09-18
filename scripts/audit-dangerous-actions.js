const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const mainSource = fs.readFileSync(path.join(root, 'src', 'main.js'), 'utf8');
const rendererSource = fs.readFileSync(path.join(root, 'src', 'renderer.js'), 'utf8');

// 危险动作清单的唯一来源。改为直接 require 而不是正则抽取源码文本，
// 这样清单无论写成字面量还是派生形式都能被审计到。
const registry = require(path.join(root, 'src', 'actions.registry.js'));

function auditDangerousActions() {
  const mainActions = [...registry.DANGEROUS_ACTIONS];
  const rendererActions = [...registry.DANGEROUS_ACTIONS];
  const missingInMain = rendererActions.filter((action) => !mainActions.includes(action));
  const missingInRenderer = mainActions.filter((action) => !rendererActions.includes(action));
  const findings = [];

  if (!mainActions.length || !rendererActions.length) findings.push({ severity: 'P0', id: 'danger-action-registry-missing' });
  if (missingInMain.length || missingInRenderer.length) findings.push({ severity: 'P0', id: 'danger-action-registry-mismatch', missingInMain, missingInRenderer });

  // 两侧必须都从注册表派生，而不是各自维护一份字面量。
  if (!mainSource.includes("require('./actions.registry')")) {
    findings.push({ severity: 'P0', id: 'main-not-using-registry' });
  }
  if (!rendererSource.includes('window.ACTIONS_REGISTRY')) {
    findings.push({ severity: 'P0', id: 'renderer-not-using-registry' });
  }

  if (!mainSource.includes('DANGEROUS_ACTIONS.has(action) && payload.riskConfirmed !== true')) findings.push({ severity: 'P0', id: 'main-process-risk-gate-missing' });
  if (!rendererSource.includes('if (DANGEROUS_ACTIONS.has(action)) payload.riskConfirmed = true;')) findings.push({ severity: 'P0', id: 'generic-risk-confirmation-mark-missing' });
  for (const actionRef of ['config.actionId', 'actionId']) {
    if (!rendererSource.includes(`if (DANGEROUS_ACTIONS.has(${actionRef})) payload.riskConfirmed = true;`)) {
      findings.push({ severity: 'P0', id: 'manager-risk-confirmation-mark-missing', actionRef });
    }
  }
  if (!rendererSource.includes('askRiskConfirmation') || !rendererSource.includes('riskConfirmDevice') || !rendererSource.includes('riskConfirmTarget')) {
    findings.push({ severity: 'P0', id: 'confirmation-context-missing' });
  }

  return {
    version: 'V20.5.4',
    generatedAt: new Date().toISOString(),
    dangerousActions: mainActions,
    findings,
    status: findings.length ? 'findings-require-fix' : 'pass'
  };
}

if (require.main === module) {
  const report = auditDangerousActions();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.findings.some((finding) => finding.severity === 'P0')) process.exitCode = 2;
}

module.exports = { auditDangerousActions };
