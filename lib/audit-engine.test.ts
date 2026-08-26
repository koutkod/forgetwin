import { beforeAll, describe, expect, it } from 'vitest';
import { DEMO_HTML, HUMAN_REVIEW_IDS, SAFE_ISSUE_IDS } from './demo-content';
import { applyFixes, calculateScore, fixedIdsFromChanges, runAudit } from './audit-engine';
import { INITIAL_PROJECT_STATE, applyIssueState, applySafeState, revertChangeState, submitContextState } from './project-state';

beforeAll(() => {
  if (!globalThis.CSS) Object.defineProperty(globalThis, 'CSS', {value:{}});
  if (!globalThis.CSS.escape) globalThis.CSS.escape = (value:string) => value.replace(/[^a-zA-Z0-9_-]/g,'\\$&');
});

describe('deterministic accessibility audit', () => {
  it('finds the designed 18-issue demo inventory', () => {
    const issues = runAudit(DEMO_HTML);
    expect(issues).toHaveLength(18);
    expect(issues.filter((issue) => issue.severity === 'critical')).toHaveLength(2);
    expect(issues.filter((issue) => issue.severity === 'serious')).toHaveLength(5);
    expect(issues.filter((issue) => issue.severity === 'moderate')).toHaveLength(7);
    expect(issues.filter((issue) => issue.severity === 'minor')).toHaveLength(4);
    expect(calculateScore(issues)).toBe(58);
  });

  it('detects missing language, image alternatives, form labels, and heading order', () => {
    const ids = runAudit(DEMO_HTML).map((issue) => issue.id);
    expect(ids).toEqual(expect.arrayContaining(['lang','chart-alt','seal-alt','email-label','consent-label','heading-order']));
  });
});

describe('safe remediation', () => {
  it('applies deterministic fixes while leaving every human decision unresolved', () => {
    const initialIssues = runAudit(DEMO_HTML);
    const next = applySafeState(INITIAL_PROJECT_STATE, initialIssues.map((issue) => issue.id), 'agent');
    const currentHtml = applyFixes(DEMO_HTML, fixedIdsFromChanges(next.changes), next.humanContext);
    const remaining = runAudit(currentHtml);
    expect(remaining.some((issue) => SAFE_ISSUE_IDS.includes(issue.id))).toBe(false);
    expect(HUMAN_REVIEW_IDS.every((id) => remaining.some((issue) => issue.id === id))).toBe(true);
    expect(remaining).toHaveLength(7);
    expect(calculateScore(remaining)).toBe(89);
  });
});

describe('human review and reversible history', () => {
  it('requires context, then unlocks and applies the chart description', () => {
    const safe = applySafeState(INITIAL_PROJECT_STATE, runAudit(DEMO_HTML).map((issue) => issue.id));
    const withContext = submitContextState(safe,'chart-alt','Energy consumption decreased 17% compared with last year.');
    const fixed = applyIssueState(withContext,'chart-alt','Added an approved chart description','unlabeled chart',withContext.humanContext['chart-alt'],.49,'human');
    const html = applyFixes(DEMO_HTML,fixedIdsFromChanges(fixed.changes),fixed.humanContext);
    expect(runAudit(html).some((issue) => issue.id === 'chart-alt')).toBe(false);
    expect(calculateScore(runAudit(html))).toBe(92);
  });

  it('restores the previous HTML state when a change is reverted', () => {
    const safe = applySafeState(INITIAL_PROJECT_STATE,runAudit(DEMO_HTML).map((issue) => issue.id));
    const langChange = safe.changes.find((change) => change.issueIds.includes('lang'))!;
    const reverted = revertChangeState(safe,langChange.id);
    const html = applyFixes(DEMO_HTML,fixedIdsFromChanges(reverted.changes),reverted.humanContext);
    expect(runAudit(html).some((issue) => issue.id === 'lang')).toBe(true);
  });
});

describe('agent safety expectations', () => {
  it('keeps read-only audit operations free of content mutations', () => {
    const before = DEMO_HTML;
    runAudit(before);
    expect(DEMO_HTML).toBe(before);
  });

  it('never includes human-review issues in the safe fix set', () => {
    expect(SAFE_ISSUE_IDS.some((id) => HUMAN_REVIEW_IDS.includes(id))).toBe(false);
  });
});
