const fs = require('node:fs');
const path = require('node:path');
const { parseWirelessPairingRequest } = require('../src/action_handlers');

const root = path.resolve(__dirname, '..');
const handlerSource = fs.readFileSync(path.join(root, 'src', 'action_handlers.js'), 'utf8');
const rendererSource = fs.readFileSync(path.join(root, 'src', 'renderer.js'), 'utf8');
const htmlSource = fs.readFileSync(path.join(root, 'src', 'renderer.html'), 'utf8');

function auditWirelessPairing() {
  const pairingBody = handlerSource.match(/handlers\['wireless-pair'\][\s\S]*?\n  \};/)?.[0] || '';
  const checks = [
    ['pairing-code-and-port-validation', () => Boolean(parseWirelessPairingRequest({ host: '192.168.1.88', pairPort: 37123, pairingCode: '123456' }))
      && !parseWirelessPairingRequest({ host: '192.168.1.88', pairPort: 37123, pairingCode: '12345' })],
    ['pair-command-uses-pairing-endpoint', () => pairingBody.includes("['pair', request.pairing.serial, request.pairingCode]")],
    ['connection-port-is-separate', () => pairingBody.includes('request.connection.serial') && pairingBody.includes("['connect', request.connection.serial]")],
    ['renderer-exposes-pairing-fields', () => /'wireless-pair':\s*\{[\s\S]*?pairPort[\s\S]*?pairingCode[\s\S]*?connectPort/.test(rendererSource)],
    ['ui-registers-wireless-pair-action', () => htmlSource.includes('data-action="wireless-pair"')]
  ];
  const findings = checks.filter(([, check]) => !check()).map(([id]) => ({ severity: 'P0', id }));
  return {
    version: 'V20.5.7',
    generatedAt: new Date().toISOString(),
    checks: checks.map(([id, check]) => ({ id, passed: check() })),
    findings,
    warnings: [],
    status: findings.length ? 'findings-require-fix' : 'pass'
  };
}

if (require.main === module) {
  const report = auditWirelessPairing();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.findings.some((finding) => finding.severity === 'P0')) process.exitCode = 2;
}

module.exports = { auditWirelessPairing };

