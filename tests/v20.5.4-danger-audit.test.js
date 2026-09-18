const assert = require('node:assert/strict');
const test = require('node:test');
const { auditDangerousActions } = require('../scripts/audit-dangerous-actions');

test('V20.5.4 dangerous actions require matching renderer confirmation and main-process enforcement', () => {
  const report = auditDangerousActions();
  assert.equal(report.version, 'V20.5.4');
  assert.equal(report.status, 'pass');
  assert.equal(report.findings.length, 0);
  assert.ok(report.dangerousActions.includes('firmware-flash'));
  assert.ok(report.dangerousActions.includes('clear-storage-photos'));
});
