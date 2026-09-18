const assert = require('node:assert/strict');
const test = require('node:test');
const { auditUiState } = require('../scripts/audit-ui-state');

test('V20.5.5 UI state audit passes feedback, context preservation and responsive contracts', () => {
  const report = auditUiState();
  assert.equal(report.version, 'V20.5.5');
  assert.equal(report.status, 'pass');
  assert.equal(report.findings.length, 0);
  assert.ok(report.checks.find((check) => check.id === 'app-scroll-position-preserved')?.passed);
  assert.ok(report.checks.find((check) => check.id === 'responsive-sidebar-retained')?.passed);
});
