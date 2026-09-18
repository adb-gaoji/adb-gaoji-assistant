const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const renderer = fs.readFileSync(path.join(root, 'src', 'renderer.js'), 'utf8');
const main = fs.readFileSync(path.join(root, 'src', 'main.js'), 'utf8');

function auditTaskFlow() {
  const checks = [
    ['task-begin-guard', /function beginTask\([\s\S]*?taskState\.current\?\.state === 'running'/],
    ['progress-clamp', /function updateTaskProgress\([\s\S]*?Math\.min\(Number\(completed\)/],
    ['task-finish-history', /function finishTask\([\s\S]*?taskState\.history\.unshift/],
    ['task-finish-clears-ticker', /function finishTask\([\s\S]*?window\.clearInterval\(taskTicker\)/],
    ['backend-conflict-code', /code: 409[\s\S]*已有任务正在执行/],
    ['backend-lock-release', /finally \{[\s\S]*?activeActionTask = null/],
    ['renderer-conflict-feedback', /result\.code === 409 \? 'warning'/],
    ['export-invalid-count', /const invalid = Array\.isArray\(result\.data\?\.invalid\)[\s\S]*invalid\.length/]
  ];
  const findings = checks.filter(([, pattern]) => !pattern.test(pattern === checks[7][1] ? renderer : pattern.source.includes('activeActionTask') || pattern.source.includes('code: 409') ? main : renderer))
    .map(([id]) => ({ severity: 'P0', id }));
  const cancellation = /cancelTask|task.*取消|取消.*task|abortTask|AbortController/i.test(renderer) || /cancelTask|task.*取消|取消.*task|abortTask|AbortController/i.test(main);
  if (!cancellation) findings.push({ severity: 'P1', id: 'task-cancellation-unavailable' });
  return {
    version: 'V20.5.3',
    generatedAt: new Date().toISOString(),
    checks: checks.map(([id]) => ({ id, passed: !findings.some((finding) => finding.id === id) })),
    findings,
    status: findings.some((finding) => finding.severity === 'P0') ? 'findings-require-fix' : findings.length ? 'partial' : 'pass'
  };
}

if (require.main === module) {
  const report = auditTaskFlow();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.findings.some((finding) => finding.severity === 'P0')) process.exitCode = 2;
  else if (report.findings.length) process.exitCode = 1;
}

module.exports = { auditTaskFlow };
