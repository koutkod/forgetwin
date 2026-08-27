export type ViewId = 'dashboard' | 'workspace' | 'graph' | 'claims' | 'review' | 'risk' | 'receipt' | 'history';

export type TrustStatus = 'verified' | 'unresolved' | 'contradicted' | 'human';
export type RiskLevel = 'Not assessed' | 'Low risk' | 'Guarded risk' | 'High risk' | 'Critical risk';

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
  source: 'WebMCP' | 'Human';
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
}

export interface RealityState {
  schemaVersion: 1;
  revision: number;
  activeView: ViewId;
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
  graphNodes: GraphNode[];
  graphEdges: GraphEdge[];
  humanAnswer: 'yes' | 'no' | 'unsure' | null;
  humanQuestionPending: boolean;
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
  revision: number;
  message: string;
  data?: unknown;
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
