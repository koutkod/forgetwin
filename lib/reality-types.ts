export type ViewId = 'dashboard' | 'workspace' | 'graph' | 'claims' | 'review' | 'risk' | 'receipt' | 'history';

export type TrustStatus = 'verified' | 'unresolved' | 'contradicted' | 'human';
export type RiskLevel = 'Not assessed' | 'Low risk' | 'Guarded risk' | 'High risk' | 'Critical risk';
export type CaseMode = 'demo' | 'live';
export type CaseType = 'job_offer' | 'email' | 'website' | 'invoice' | 'marketplace' | 'identity' | 'other';
export type HumanQuestionCode = 'job_application_history' | 'purchase_recognition' | 'prior_relationship' | 'message_expected';

export interface Entity {
  id: string;
  kind: 'organization' | 'person' | 'email' | 'domain' | 'website' | 'phone' | 'job' | 'request';
  label: string;
  value: string;
  status: TrustStatus;
}

export interface Evidence {
  id: string;
  title: string;
  source: string;
  summary: string;
  direction: 'supports' | 'contradicts' | 'context';
  reliability: 'High' | 'Medium' | 'Human provided';
  untrusted?: boolean;
  adjudicable?: boolean;
  live?: boolean;
  locator?: string;
  contentPreview?: string;
  contentDigest?: string;
  provider?: 'firecrawl' | 'deterministic' | 'human';
}

export interface Claim {
  id: string;
  title: string;
  detail: string;
  status: TrustStatus;
  confidence: number;
  evidenceIds: string[];
  whatWouldProve: string;
  reason: string;
}

export interface GraphNode {
  id: string;
  type: 'claim' | 'entity' | 'evidence';
  label: string;
  sublabel: string;
  status: TrustStatus;
  x: number;
  y: number;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  status: TrustStatus;
}

export interface AgentEvent {
  id: string;
  tool: string;
  detail: string;
  at: string;
  source: 'WebMCP' | 'UI' | 'Human';
  outcome: 'success' | 'waiting';
}

export interface HistoryEvent {
  id: string;
  title: string;
  detail: string;
  at: string;
  kind: 'agent' | 'human' | 'system';
}

export interface SourceRecord {
  id: string;
  label: string;
  type: string;
  recorded: boolean;
  locator?: string;
  live?: boolean;
}

export interface EvidenceLink {
  id: string;
  claimId: string;
  evidenceId: string;
  relationship: 'supports' | 'contradicts' | 'context';
}

export interface RiskFactor {
  id: string;
  title: string;
  points: number;
  detail: string;
  basisIds: string[];
}

export interface LiveSourceData {
  success: boolean;
  requestedUrl: string;
  provider?: 'firecrawl';
  untrusted?: true;
  trustInferred?: false;
  finalUrl?: string;
  title?: string;
  description?: string;
  markdown?: string;
  links?: string[];
  statusCode?: number;
  cacheState?: string;
  cachedAt?: string;
  fetchedAt?: string;
  contentDigest?: string;
  error?: string;
}

export interface RealityState {
  schemaVersion: 2;
  revision: number;
  activeView: ViewId;
  caseId: string;
  caseNonce: string;
  caseMode: CaseMode;
  caseTitle: string;
  caseType: CaseType;
  inputText: string;
  inputUrl: string | null;
  webEvidenceStatus: 'idle' | 'loading' | 'live' | 'fallback' | 'error';
  webEvidenceMessage: string | null;
  phase: 'ready' | 'investigating' | 'awaiting-human' | 'assessed' | 'receipt-ready';
  caseCreated: boolean;
  messageAdded: boolean;
  entitiesExtracted: boolean;
  claimsExtracted: boolean;
  graphBuilt: boolean;
  selectedNodeId: string | null;
  selectedClaimId: string | null;
  entities: Entity[];
  claims: Claim[];
  evidence: Evidence[];
  sources: SourceRecord[];
  evidenceLinks: EvidenceLink[];
  graphNodes: GraphNode[];
  graphEdges: GraphEdge[];
  humanAnswer: 'yes' | 'no' | 'unsure' | null;
  humanQuestionCode: HumanQuestionCode | null;
  humanQuestionPending: boolean;
  riskFactors: RiskFactor[];
  riskScore: number;
  riskLevel: RiskLevel;
  riskCalculated: boolean;
  receiptGenerated: boolean;
  safePlanGenerated: boolean;
  activity: AgentEvent[];
  history: HistoryEvent[];
}

export interface ToolResult {
  ok: true;
  case_id: string;
  case_nonce: string;
  revision: number;
  message: string;
  data?: unknown;
}

export interface LiveCaseInput {
  title: string;
  caseType: CaseType;
  text: string;
  url: string;
}

export type CommandName =
  | 'create_case'
  | 'add_evidence'
  | 'extract_entities'
  | 'extract_claims'
  | 'inspect_claim'
  | 'record_source'
  | 'link_evidence'
  | 'verify_claim'
  | 'contradict_claim'
  | 'mark_unresolved'
  | 'request_human_context'
  | 'calculate_risk'
  | 'build_evidence_graph'
  | 'generate_trust_receipt'
  | 'create_safe_action_plan';
