const assert = require('node:assert/strict');
const test = require('node:test');
const { auditTaskFlow } = require('../scripts/audit-task-flow');

test('V20.5.3 task flow audit passes core lifecycle and records cancellation gap', () => {
  const report = auditTaskFlow();
  assert.equal(report.version, 'V20.5.3');
  assert.equal(report.findings.filter((finding) => finding.severity === 'P0').length, 0);
  assert.ok(report.findings.some((finding) => finding.id === 'task-cancellation-unavailable'));
  assert.equal(report.status, 'partial');
});
