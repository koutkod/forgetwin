import { ISSUE_BY_ID, ISSUE_CATALOG } from './demo-content';
import type { AccessibilityIssue, AuditSummary, Severity } from './types';

function hasAccessibleName(element: Element) {
  const ariaLabel = element.getAttribute('aria-label')?.trim();
  const labelledBy = element.getAttribute('aria-labelledby');
  if (ariaLabel) return true;
  if (labelledBy && labelledBy.split(/\s+/).every((id) => element.ownerDocument.getElementById(id))) return true;
  if (element.textContent?.trim() && !element.matches('input')) return true;
  if (element.id && element.ownerDocument.querySelector(`label[for="${CSS.escape(element.id)}"]`)) return true;
  return Boolean(element.closest('label'));
}

export function runAudit(html: string): AccessibilityIssue[] {
  // Client components are pre-rendered by the Sites runtime. The first server
  // render always uses the untouched deterministic fixture; the browser reruns
  // the real DOM audit immediately and after every state change.
  if (typeof DOMParser === 'undefined') return ISSUE_CATALOG;
  const document = new DOMParser().parseFromString(html, 'text/html');
  const found = new Set<string>();

  if (!document.documentElement.getAttribute('lang')?.trim()) found.add('lang');
  if (!document.title.trim() || /^(report|home|untitled)$/i.test(document.title.trim())) found.add('doc-title');
  if (document.querySelectorAll('main').length !== 1) found.add('main');

  const customButton = document.querySelector('[data-node-id="report-cta"][role="button"]');
  if (customButton && !customButton.hasAttribute('tabindex')) found.add('keyboard-cta');

  const email = document.querySelector('[data-node-id="email-input"]');
  if (email && !hasAccessibleName(email)) found.add('email-label');
  const consent = document.querySelector('[data-node-id="consent-input"]');
  if (consent && !hasAccessibleName(consent)) found.add('consent-label');

  const menu = document.querySelector('[data-node-id="menu-button"]');
  if (menu && !menu.getAttribute('aria-label') && menu.textContent?.trim() === '☰') found.add('menu-name');

  const chart = document.querySelector('[data-node-id="energy-chart"][role="img"]');
  if (chart && !chart.getAttribute('aria-label') && !chart.getAttribute('aria-describedby')) found.add('chart-alt');
  const seal = document.querySelector('img[data-node-id="city-seal"]');
  if (seal && !seal.hasAttribute('alt')) found.add('seal-alt');

  const table = document.querySelector('table[data-node-id="energy-table"]');
  if (table) {
    if (!table.querySelector('tr:first-child th')) found.add('table-headers');
    if (!table.querySelector('caption') && !table.getAttribute('aria-label') && !table.getAttribute('aria-labelledby')) found.add('table-caption');
  }

  const headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')];
  const levels = headings.map((heading) => Number(heading.tagName.slice(1)));
  if (levels[0] !== 1 || levels.some((level, index) => index > 0 && level > levels[index - 1] + 1)) found.add('heading-order');

  if ([...document.querySelectorAll('a')].some((link) => /^(click here|read more|learn more)$/i.test(link.textContent?.trim() ?? ''))) found.add('generic-link');
  if ([...document.querySelectorAll('[aria-labelledby]')].some((element) => element.getAttribute('aria-labelledby')?.split(/\s+/).some((id) => !document.getElementById(id)))) found.add('aria-reference');
  if (document.querySelector('[data-contrast="fail"]')) found.add('contrast');

  const ids = [...document.querySelectorAll('[id]')].map((element) => element.id).filter(Boolean);
  if (new Set(ids).size !== ids.length) found.add('duplicate-id');

  const region = document.querySelector('[data-node-id="newsletter-region"]');
  if (region && !region.getAttribute('aria-label') && !region.getAttribute('aria-labelledby')) found.add('region-name');
  const frame = document.querySelector('iframe[data-node-id="project-map"]');
  if (frame && !frame.getAttribute('title')) found.add('iframe-title');

  return ISSUE_CATALOG.filter((item) => found.has(item.id));
}

const WEIGHTS: Record<Severity, number> = { critical: 8, serious: 4, moderate: 2, minor: 1 };

export function calculateScore(issues: AccessibilityIssue[]) {
  const risk = issues.reduce((total, issue) => total + WEIGHTS[issue.severity], 0);
  return Math.max(0, Math.round(100 * (1 - Math.min(risk / 128, 1))));
}

export function summarizeAudit(issues: AccessibilityIssue[], auditId = `audit_${Date.now()}`): AuditSummary {
  const count = (severity: Severity) => issues.filter((issue) => issue.severity === severity).length;
  return {
    auditId,
    totalIssues: issues.length,
    critical: count('critical'),
    serious: count('serious'),
    moderate: count('moderate'),
    minor: count('minor'),
    humanReviewRequired: issues.filter((issue) => issue.requiresHumanReview).length,
    score: calculateScore(issues),
  };
}

function replaceSecond(source: string, needle: string, replacement: string) {
  const first = source.indexOf(needle);
  const second = first < 0 ? -1 : source.indexOf(needle, first + needle.length);
  return second < 0 ? source : `${source.slice(0, second)}${replacement}${source.slice(second + needle.length)}`;
}

export function applyFixes(originalHtml: string, fixedIssueIds: Set<string>, humanContext: Record<string, string>) {
  let html = originalHtml;
  if (fixedIssueIds.has('lang')) html = html.replace('<html>', '<html lang="en">');
  if (fixedIssueIds.has('doc-title')) html = html.replace('<title>Report</title>', '<title>2026 Community Energy Report | City of Arbor Creek</title>');
  if (fixedIssueIds.has('main')) {
    html = html.replace('<div class="report-shell" data-node-id="report-shell">', '<main class="report-shell" data-node-id="report-shell">');
    html = html.replace('\n  </div>\n  <footer class="footer">', '\n  </main>\n  <footer class="footer">');
  }
  if (fixedIssueIds.has('heading-order')) html = html.replaceAll('<h3 ', '<h1 ').replaceAll('</h3>', '</h1>').replaceAll('<h5', '<h2').replaceAll('</h5>', '</h2>');
  if (fixedIssueIds.has('aria-reference')) html = html.replace('data-node-id="chart-heading"', 'data-node-id="chart-heading" id="chart-heading"').replace('aria-labelledby="missing-heading"', 'aria-labelledby="chart-heading"');
  if (fixedIssueIds.has('region-name')) html = html.replace('<section class="newsletter" data-node-id="newsletter-region">', '<section class="newsletter" data-node-id="newsletter-region" aria-labelledby="newsletter-heading">');
  if (fixedIssueIds.has('keyboard-cta')) html = html.replace('<div class="report-cta" data-node-id="report-cta" role="button">Download report</div>', '<a class="report-cta" data-node-id="report-cta" href="#download">Download report</a>');
  if (fixedIssueIds.has('email-label')) html = html.replace('<input data-node-id="email-input" type="email" placeholder="Email address">', '<label for="newsletter-email">Email address</label><input id="newsletter-email" data-node-id="email-input" type="email" autocomplete="email">');
  if (fixedIssueIds.has('consent-label')) html = html.replace('<span class="consent"><input data-node-id="consent-input" type="checkbox"> Receive monthly updates</span>', '<label class="consent"><input data-node-id="consent-input" type="checkbox"> Receive monthly updates</label>');
  if (fixedIssueIds.has('menu-name')) html = html.replace('<button class="menu-button" data-node-id="menu-button">', '<button class="menu-button" data-node-id="menu-button" aria-label="Open site menu">');
  if (fixedIssueIds.has('table-headers')) html = html.replace('<tr><td>Sector</td><td>2025 MWh</td><td>2026 MWh</td></tr>', '<tr><th scope="col">Sector</th><th scope="col">2025 MWh</th><th scope="col">2026 MWh</th></tr>');

  if (fixedIssueIds.has('chart-alt')) {
    const context = humanContext['chart-alt'] || 'Energy consumption decreased 17% compared with last year.';
    html = html.replace('data-node-id="energy-chart" role="img"', 'data-node-id="energy-chart" role="img" aria-describedby="chart-description"');
    html = html.replace('</div>\n      <p class="chart-note" data-contrast="fail">2023–2026', `</div><p id="chart-description">${escapeHtml(context)}</p>\n      <p class="chart-note" data-contrast="fail">2023–2026`);
  }
  if (fixedIssueIds.has('generic-link')) {
    const context = humanContext['generic-link'] || 'Download the 2026 energy dataset.';
    html = html.replace('>click here</a>', `>${escapeHtml(context.replace(/\.$/, ''))}</a>`);
  }
  if (fixedIssueIds.has('seal-alt')) {
    const context = humanContext['seal-alt'] || 'City of Arbor Creek seal';
    const alt = /decorative/i.test(context) ? '' : context.replace(/\.$/, '');
    html = html.replace('data-node-id="city-seal" src="/og.png"', `data-node-id="city-seal" src="/og.png" alt="${escapeAttribute(alt)}"`);
  }
  if (fixedIssueIds.has('table-caption')) {
    const context = humanContext['table-caption'] || '2025 and 2026 energy consumption in megawatt-hours by sector.';
    html = html.replace('<table class="energy-table" data-node-id="energy-table">', `<table class="energy-table" data-node-id="energy-table"><caption>${escapeHtml(context)}</caption>`);
  }
  if (fixedIssueIds.has('contrast')) html = html.replace('class="chart-note" data-contrast="fail"', 'class="chart-note" style="color:#43565b"');
  if (fixedIssueIds.has('duplicate-id')) html = replaceSecond(html, 'id="stats"', 'id="executive-summary"');
  if (fixedIssueIds.has('iframe-title')) html = html.replace('data-node-id="project-map" src=', 'data-node-id="project-map" title="Map of municipal energy projects" src=');
  return html;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[character] ?? character));
}

function escapeAttribute(value: string) {
  return escapeHtml(value).replace(/`/g, '&#096;');
}

export function fixedIdsFromChanges(changes: { issueIds: string[]; reverted: boolean }[]) {
  return new Set(changes.filter((change) => !change.reverted).flatMap((change) => change.issueIds));
}

export function unresolvedIssuesFromHtml(html: string, ignored: string[] = []) {
  return runAudit(html).filter((issue) => !ignored.includes(issue.id));
}

export function statusForIssue(issue: AccessibilityIssue, fixedIds: Set<string>, ignored: string[], context: Record<string, string>) {
  if (fixedIds.has(issue.id)) return 'fixed' as const;
  if (ignored.includes(issue.id)) return 'ignored' as const;
  if (issue.requiresHumanReview) return context[issue.id] ? 'proposed' as const : 'needs-review' as const;
  return 'open' as const;
}

export function catalogIssue(id: string) {
  const issue = ISSUE_BY_ID[id];
  if (!issue) throw new Error(`Unknown accessibility issue: ${id}`);
  return issue;
}

export interface OutlineItem { id: string; depth: number; label: string; kind: 'landmark' | 'heading' | 'graphic' | 'link' | 'control' | 'table'; }

export function getScreenReaderOutline(html: string): OutlineItem[] {
  if (typeof DOMParser === 'undefined') return [];
  const document = new DOMParser().parseFromString(html, 'text/html');
  const result: OutlineItem[] = [];
  const elements = [...document.querySelectorAll('header,nav,main,[role="main"],section[aria-label],section[aria-labelledby],h1,h2,h3,h4,h5,h6,[role="img"],img,a,button,input,table,footer')];
  elements.forEach((element, index) => {
    const tag = element.tagName.toLowerCase();
    let kind: OutlineItem['kind'] = 'control';
    let label = '';
    let depth = 0;
    if (tag === 'header') { kind = 'landmark'; label = 'Banner'; }
    else if (tag === 'nav') { kind = 'landmark'; label = 'Navigation'; depth = 1; }
    else if (tag === 'main' || element.getAttribute('role') === 'main') { kind = 'landmark'; label = 'Main'; }
    else if (tag === 'footer') { kind = 'landmark'; label = 'Content information'; }
    else if (tag === 'section') { kind = 'landmark'; label = `Region: ${accessibleName(element) || 'unlabeled'}`; }
    else if (/^h[1-6]$/.test(tag)) { kind = 'heading'; depth = Number(tag.slice(1)); label = `Heading level ${depth}: ${element.textContent?.trim() || 'unlabeled'}`; }
    else if (tag === 'img' || element.getAttribute('role') === 'img') { kind = 'graphic'; label = `Graphic: ${accessibleName(element) || 'unlabeled'}`; depth = 2; }
    else if (tag === 'a') { kind = 'link'; label = `Link: ${accessibleName(element) || 'unlabeled'}`; depth = 2; }
    else if (tag === 'table') { kind = 'table'; label = `Table: ${element.querySelector('caption')?.textContent?.trim() || 'unlabeled'}`; depth = 2; }
    else if (tag === 'input') { kind = 'control'; label = `${element.getAttribute('type') === 'checkbox' ? 'Checkbox' : 'Edit text'}: ${accessibleName(element) || 'unlabeled'}`; depth = 2; }
    else { kind = 'control'; label = `Button: ${accessibleName(element) || 'unlabeled'}`; depth = 2; }
    result.push({ id: `${kind}-${index}`, depth: Math.min(depth, 3), label, kind });
  });
  return result;
}

function accessibleName(element: Element) {
  const aria = element.getAttribute('aria-label');
  if (aria) return aria;
  const ids = element.getAttribute('aria-labelledby');
  if (ids) return ids.split(/\s+/).map((id) => element.ownerDocument.getElementById(id)?.textContent?.trim()).filter(Boolean).join(' ');
  if (element.tagName === 'IMG') return element.getAttribute('alt') ?? '';
  if (element.id) {
    const label = element.ownerDocument.querySelector(`label[for="${CSS.escape(element.id)}"]`);
    if (label) return label.textContent?.trim() ?? '';
  }
  const wrappedLabel = element.closest('label');
  if (wrappedLabel) return wrappedLabel.textContent?.trim() ?? '';
  if (element.getAttribute('aria-describedby')) return element.getAttribute('aria-describedby')!.split(/\s+/).map((id) => element.ownerDocument.getElementById(id)?.textContent?.trim()).filter(Boolean).join(' ');
  return element.textContent?.trim() ?? '';
}
