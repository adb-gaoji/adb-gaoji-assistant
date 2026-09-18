const fs = require('node:fs');
const path = require('node:path');
const { parseWirelessEndpoint } = require('../src/action_handlers');

const root = path.resolve(__dirname, '..');
const handlerSource = fs.readFileSync(path.join(root, 'src', 'action_handlers.js'), 'utf8');
const rendererSource = fs.readFileSync(path.join(root, 'src', 'renderer.js'), 'utf8');

function auditWirelessCast() {
  const wirelessAdbBody = handlerSource.match(/handlers\['wireless-adb'\][\s\S]*?\n  \};/)?.[0] || '';
  const wirelessMirrorBody = handlerSource.match(/handlers\['wireless-mirror'\][\s\S]*?\n  \};/)?.[0] || '';
  const scrcpyBody = handlerSource.match(/async function scrcpy\([\s\S]*?\n  \}/)?.[0] || '';
  const checks = [
    ['strict-ipv4-and-port-validation', () => Boolean(parseWirelessEndpoint('192.168.1.88', 5555))
      && !parseWirelessEndpoint('256.168.1.88', 5555)
      && !parseWirelessEndpoint('192.168.1', 5555)
      && !parseWirelessEndpoint('192.168.1.88', 65536)],
    ['wireless-adb-selected-device-guard', () => wirelessAdbBody.includes('requireSelectedAdb(payload)')],
    ['wireless-adb-connects-resolved-endpoint', () => wirelessAdbBody.includes('endpoint.serial')],
    ['wireless-mirror-selected-device-guard', () => wirelessMirrorBody.includes('requireSelectedAdb(payload)')],
    ['wireless-mirror-uses-wireless-serial', () => wirelessMirrorBody.includes('endpoint.serial') && wirelessMirrorBody.includes('mirrorSerial')],
    ['scrcpy-receives-explicit-serial', () => scrcpyBody.includes("['--serial', serial, ...args]")],
    ['renderer-exposes-wireless-endpoint-fields', () => /'wireless-mirror':\s*\{[\s\S]*?name: 'host'[\s\S]*?name: 'port'/.test(rendererSource)]
  ];
  const findings = checks.filter(([, check]) => !check()).map(([id]) => ({ severity: 'P0', id }));
  return {
    version: 'V20.5.6',
    generatedAt: new Date().toISOString(),
    checks: checks.map(([id, check]) => ({ id, passed: check() })),
    findings,
    warnings: [],
    status: findings.length ? 'findings-require-fix' : 'pass'
  };
}

if (require.main === module) {
  const report = auditWirelessCast();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.findings.some((finding) => finding.severity === 'P0')) process.exitCode = 2;
}

module.exports = { auditWirelessCast };

