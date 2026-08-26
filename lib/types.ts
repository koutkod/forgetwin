export type Severity = 'critical' | 'serious' | 'moderate' | 'minor';
export type IssueCategory = 'structure' | 'forms' | 'images' | 'keyboard' | 'aria' | 'links' | 'tables' | 'color' | 'language' | 'other';
export type IssueStatus = 'open' | 'proposed' | 'fixed' | 'needs-review' | 'ignored';
export type Decision = 'safe-auto-fix' | 'agent-proposal' | 'human-review-required';
export type Screen = 'overview' | 'issues' | 'review' | 'compare' | 'reader' | 'history' | 'publish' | 'tools';

export interface AccessibilityIssue {
  id: string;
  ruleId: string;
  title: string;
  description: string;
  wcagCriterion?: string;
  wcagLevel?: 'A' | 'AA' | 'AAA';
  severity: Severity;
  category: IssueCategory;
  selector: string;
  elementHtml: string;
  explanation: string;
  suggestedFix: string;
  confidence: number;
  requiresHumanReview: boolean;
  decision: Decision;
  reviewQuestion?: string;
  reviewOptions?: string[];
}

export interface RemediationChange {
  id: string;
  issueIds: string[];
  action: string;
  before: string;
  after: string;
  source: 'human' | 'agent' | 'ui';
  confidence?: number;
  timestamp: string;
  reverted: boolean;
}

export interface AgentActivity {
  id: string;
  tool: string;
  summary: string;
  kind: 'read' | 'write' | 'human' | 'system';
  timestamp: string;
}

export interface ProjectState {
  projectId: string;
  projectName: string;
  slug: string;
  sourceType: 'demo' | 'html' | 'url';
  audited: boolean;
  auditId?: string;
  detectedIssueIds: string[];
  ignoredIssueIds: string[];
  changes: RemediationChange[];
  humanContext: Record<string, string>;
  version: number;
  verifiedVersion?: number;
  publishedVersion?: number;
  publishedAt?: string;
  screen: Screen;
  selectedIssueId?: string;
  activity: AgentActivity[];
}

export interface AuditSummary {
  auditId: string;
  totalIssues: number;
  critical: number;
  serious: number;
  moderate: number;
  minor: number;
  humanReviewRequired: number;
  score: number;
}
