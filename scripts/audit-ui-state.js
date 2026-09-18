const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const renderer = fs.readFileSync(path.join(root, 'src', 'renderer.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'src', 'renderer.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src', 'styles.css'), 'utf8');

function has(pattern, source) {
  return pattern.test(source);
}

function auditUiState() {
  const checks = [
    ['task-status-success-warning-error-running', () => ['success', 'warning', 'error', 'running'].every((state) => renderer.includes(`setTaskStatus('${state}'`) || renderer.includes(`finishTask('${state}'`) || renderer.includes(`state === '${state}'`))],
    ['task-status-accessible-live-region', () => html.includes('id="taskStatus"') && html.includes('role="status"') && html.includes('aria-live="polite"')],
    ['task-status-style-states', () => ['success', 'warning', 'error', 'running'].every((state) => css.includes(`.task-status[data-state="${state}"]`) || state === 'running' && css.includes('.task-status[data-state="running"]'))],
    ['app-filter-sort-state-preserved', () => {
      const hasInitialState = /appManagerState\s*=\s*\{[\s\S]*?filter:\s*'user'[\s\S]*?sort:\s*'name-asc'[\s\S]*?query:\s*''/.test(renderer);
      const filteredApps = renderer.match(/function filteredApps\(\)\s*\{[\s\S]*?\n\}/)?.[0] || '';
      return hasInitialState && ['filter', 'sort', 'query'].every((key) => filteredApps.includes(`appManagerState.${key}`));
    }],
    ['app-scroll-position-preserved', () => /listScrollTop:\s*0/.test(renderer) && /previousScrollTop[\s\S]*?list\.scrollTop\s*=\s*Math\.min\(previousScrollTop, maxScrollTop\)/.test(renderer) && /addEventListener\('scroll'[\s\S]*?appManagerState\.listScrollTop/.test(renderer)],
    ['app-selection-preserved-after-refresh', () => /selectedPackages:\s*new Set\(\)/.test(renderer) && /availablePackages[\s\S]*?selectedPackages\]\.filter/.test(renderer) && /selectedPackage\s*=\s*appManagerState\.apps\.some/.test(renderer)],
    ['storage-feedback-live-region', () => html.includes('id="storageManagerMessage" role="status" aria-live="polite"') && html.includes('id="storageFileMessage" role="status" aria-live="polite"')],
    ['responsive-sidebar-retained', () => html.includes('<aside class="sidebar app-header">')
      && /\.app-shell\s*\{[^}]*grid-template-columns:\s*232px\s+minmax\(0,\s*1fr\)/.test(css)
      && /@media \(max-width:\s*920px\)[\s\S]*?\.app-shell\s*\{[^}]*grid-template-columns:\s*208px\s+minmax\(0,\s*1fr\)/.test(css)
      && /@media \(max-width:\s*760px\)[\s\S]*?\.app-shell\s*\{[^}]*grid-template-columns:\s*72px\s+minmax\(0,\s*1fr\)/.test(css)],
    ['small-screen-table-overflow', () => /@media \(max-width: 680px\)[\s\S]*?table, \.ui-table \{ display: block; overflow-x: auto; white-space: nowrap; \}/.test(css)]
  ];

  const findings = checks
    .filter(([, check]) => !check())
    .map(([id]) => ({ severity: 'P0', id }));

  const warnings = [];
  if (/\.app-header \.nav-list/.test(css)) {
    warnings.push({ severity: 'P2', id: 'legacy-top-nav-css-leftover', note: '存在旧顶部导航兼容样式，但 DOM 当前仍为左侧 sidebar。' });
  }

  return {
    version: 'V20.5.5',
    generatedAt: new Date().toISOString(),
    checks: checks.map(([id, check]) => ({ id, passed: check() })),
    findings,
    warnings,
    status: findings.length ? 'findings-require-fix' : 'pass'
  };
}

if (require.main === module) {
  const report = auditUiState();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.findings.some((finding) => finding.severity === 'P0')) process.exitCode = 2;
}

module.exports = { auditUiState };
