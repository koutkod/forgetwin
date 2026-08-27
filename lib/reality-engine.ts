import { CLAIM_FIXTURES, DEMO_CASE_ID, ENTITY_FIXTURES, EVIDENCE_FIXTURES, GRAPH_EDGES, GRAPH_NODES } from './reality-data';
import type { CommandName, RealityState, ToolResult, TrustStatus } from './reality-types';

const sourceEvidence: Record<string, string[]> = {
  'source-official-careers': ['evidence-official-domain', 'evidence-role', 'evidence-request'],
  'source-domain-registry': ['evidence-domain-age', 'evidence-portal'],
  'source-email-headers': ['evidence-email-auth'],
  'source-recruiter-directory': ['evidence-recruiter'],
};

const toolCopy: Record<CommandName, string> = {
  create_case: 'Created the NVIDIA offer investigation',
  add_evidence: 'Preserved the suspicious message as untrusted evidence',
  extract_entities: 'Extracted company, recruiter, domains, role, and sensitive requests',
  extract_claims: 'Mapped six independently verifiable claims',
  inspect_claim: 'Inspected claim and its current evidence basis',
  record_source: 'Recorded independent source provenance',
  link_evidence: 'Linked evidence to a specific claim',
  verify_claim: 'Verified a narrow claim with evidence',
  contradict_claim: 'Recorded a contradiction with supporting evidence',
  mark_unresolved: 'Marked a claim unresolved pending stronger evidence',
  request_human_context: 'Asked for missing application context',
  calculate_risk: 'Recalculated deterministic case risk',
  build_evidence_graph: 'Built the claim and evidence graph',
  generate_trust_receipt: 'Generated a shareable Trust Receipt',
  create_safe_action_plan: 'Created the safest next-action plan',
};

function safeId(input: unknown, fallback: string) {
  return typeof input === 'string' && /^[a-z][a-z0-9_-]{0,63}$/.test(input) ? input : fallback;
}

function clone(state: RealityState): RealityState {
  return structuredClone(state);
}

function addTimeline(state: RealityState, tool: CommandName, source: 'WebMCP' | 'Human', outcome: 'success' | 'waiting' = 'success') {
  const id = `event-${state.activity.length + 1}-${tool}`;
  state.activity = [{ id, tool, detail: toolCopy[tool], at: 'now', source, outcome }, ...state.activity].slice(0, 40);
  state.history = [
    ...state.history,
    { id: `history-${state.history.length + 1}-${tool}`, title: tool.replaceAll('_', ' '), detail: toolCopy[tool], at: 'Just now', kind: source === 'Human' ? 'human' : 'agent' },
  ];
}

function requireCase(state: RealityState) {
  if (!state.caseCreated) throw new Error('Create the active case before using this tool.');
}

function requireRevision(state: RealityState, input: Record<string, unknown>) {
  if (input.expected_revision !== undefined && input.expected_revision !== state.revision) {
    throw new Error(`State changed. Retry using revision ${state.revision}.`);
  }
}

function addEvidenceByIds(state: RealityState, ids: string[]) {
  const present = new Set(state.evidence.map((item) => item.id));
  for (const id of ids) {
    const evidence = EVIDENCE_FIXTURES.find((item) => item.id === id);
    if (evidence && !present.has(id)) state.evidence.push({ ...evidence });
  }
}

function setClaimStatus(state: RealityState, claimId: string, status: TrustStatus) {
  const claim = state.claims.find((item) => item.id === claimId);
  if (!claim) throw new Error('Claim not found in the active case.');
  claim.status = status;
  if (status === 'verified') claim.confidence = Math.max(claim.confidence, 96);
  if (status === 'contradicted') claim.confidence = Math.max(claim.confidence, 94);
}

export function riskForState(state: RealityState) {
  const contradicted = state.claims.filter((claim) => claim.status === 'contradicted').length;
  const unresolved = state.claims.filter((claim) => claim.status === 'unresolved').length;
  let score = contradicted * 20 + unresolved * 5 + (state.caseCreated ? 2 : 0);
  if (state.humanAnswer === 'no') score += 24;
  if (state.humanAnswer === 'unsure') score += 10;
  if (state.humanAnswer === 'yes') score += 2;
  score = Math.min(100, score);
  const level = score >= 80 ? 'Critical risk' : score >= 50 ? 'High risk' : score >= 25 ? 'Guarded risk' : 'Low risk';
  return { score, level } as const;
}

export function applyTool(
  current: RealityState,
  tool: CommandName,
  rawInput: Record<string, unknown> = {},
  source: 'WebMCP' | 'Human' = 'WebMCP',
): { state: RealityState; result: ToolResult } {
  const state = clone(current);
  requireRevision(state, rawInput);
  let data: unknown;
  let mutation = true;

  switch (tool) {
    case 'create_case': {
      if (state.caseCreated) throw new Error('The demo case already exists. Reset the demo to start again.');
      state.caseCreated = true;
      state.phase = 'investigating';
      state.activeView = 'workspace';
      data = { status: 'open', title: 'Suspicious NVIDIA AI Engineer offer' };
      break;
    }
    case 'add_evidence': {
      requireCase(state);
      state.messageAdded = true;
      addEvidenceByIds(state, ['evidence-message']);
      data = { evidence_id: 'evidence-message', stored_as_untrusted: true, content_echoed: false };
      break;
    }
    case 'extract_entities': {
      requireCase(state);
      if (!state.messageAdded) throw new Error('Add evidence before extracting entities.');
      state.entities = ENTITY_FIXTURES.map((entity) => ({ ...entity, status: 'unresolved' }));
      state.entitiesExtracted = true;
      data = { count: state.entities.length, entity_ids: state.entities.map((entity) => entity.id) };
      break;
    }
    case 'extract_claims': {
      requireCase(state);
      if (!state.messageAdded) throw new Error('Add evidence before extracting claims.');
      state.claims = CLAIM_FIXTURES.map((claim) => ({ ...claim, status: 'unresolved', confidence: 50, evidenceIds: [] }));
      state.claimsExtracted = true;
      data = { count: state.claims.length, claim_ids: state.claims.map((claim) => claim.id), truth_established: false };
      break;
    }
    case 'inspect_claim': {
      requireCase(state);
      const claimId = safeId(rawInput.claim_id, '');
      const claim = state.claims.find((item) => item.id === claimId);
      if (!claim) throw new Error('Claim not found in the active case.');
      mutation = false;
      data = { claim, evidence: state.evidence.filter((item) => claim.evidenceIds.includes(item.id)), human_context: state.humanAnswer };
      break;
    }
    case 'record_source': {
      requireCase(state);
      const sourceId = safeId(rawInput.source_id, '');
      const record = state.sources.find((item) => item.id === sourceId);
      if (!record) throw new Error('Choose a known deterministic source for this demo.');
      record.recorded = true;
      addEvidenceByIds(state, sourceEvidence[sourceId] ?? []);
      data = { source_id: sourceId, recorded: true, trust_inferred: false };
      break;
    }
    case 'link_evidence': {
      requireCase(state);
      const claimId = safeId(rawInput.claim_id, '');
      const evidenceId = safeId(rawInput.evidence_id, '');
      const claim = state.claims.find((item) => item.id === claimId);
      if (!claim || !state.evidence.some((item) => item.id === evidenceId)) throw new Error('Claim or evidence is not available in the active case.');
      if (!claim.evidenceIds.includes(evidenceId)) claim.evidenceIds.push(evidenceId);
      data = { link_id: `link-${claimId}-${evidenceId}`, claim_id: claimId, evidence_id: evidenceId };
      break;
    }
    case 'verify_claim': {
      requireCase(state);
      const claimId = safeId(rawInput.claim_id, 'claim-company');
      setClaimStatus(state, claimId, 'verified');
      if (claimId === 'claim-company') {
        const entity = state.entities.find((item) => item.id === 'entity-nvidia');
        const official = state.entities.find((item) => item.id === 'entity-official-domain');
        if (entity) entity.status = 'verified';
        if (official) official.status = 'verified';
      }
      data = { claim_id: claimId, status: 'verified' };
      break;
    }
    case 'contradict_claim': {
      requireCase(state);
      const claimId = safeId(rawInput.claim_id, '');
      setClaimStatus(state, claimId, 'contradicted');
      const entityMap: Record<string, string[]> = {
        'claim-domain': ['entity-domain', 'entity-email'],
        'claim-portal': ['entity-portal'],
        'claim-request': ['entity-request'],
      };
      for (const entityId of entityMap[claimId] ?? []) {
        const entity = state.entities.find((item) => item.id === entityId);
        if (entity) entity.status = 'contradicted';
      }
      data = { claim_id: claimId, status: 'contradicted' };
      break;
    }
    case 'mark_unresolved': {
      requireCase(state);
      const claimId = safeId(rawInput.claim_id, '');
      setClaimStatus(state, claimId, 'unresolved');
      data = { claim_id: claimId, status: 'unresolved', needs_independent_verification: true };
      break;
    }
    case 'request_human_context': {
      requireCase(state);
      if (!state.claimsExtracted) throw new Error('Extract claims before requesting human context.');
      state.humanQuestionPending = true;
      state.phase = 'awaiting-human';
      state.activeView = 'review';
      data = { request_id: 'human-request-application-history', question_code: 'job_application_history', status: 'awaiting_human' };
      break;
    }
    case 'calculate_risk': {
      requireCase(state);
      if (!state.claimsExtracted) throw new Error('Extract claims before calculating risk.');
      const risk = riskForState(state);
      state.riskScore = risk.score;
      state.riskLevel = risk.level;
      state.riskCalculated = true;
      if (state.humanAnswer) state.phase = 'assessed';
      data = { score: risk.score, level: risk.level, provisional: state.humanAnswer === null, based_on_revision: state.revision };
      break;
    }
    case 'build_evidence_graph': {
      requireCase(state);
      if (!state.entitiesExtracted || !state.claimsExtracted) throw new Error('Extract entities and claims before building the graph.');
      state.graphBuilt = true;
      state.graphNodes = GRAPH_NODES.filter((node) => state.humanAnswer || node.id !== 'node-human').map((node) => ({ ...node }));
      state.graphEdges = GRAPH_EDGES.filter((edge) => state.humanAnswer || edge.id !== 'edge-8').map((edge) => ({ ...edge }));
      data = { node_count: state.graphNodes.length, edge_count: state.graphEdges.length, graph_is_evidence_map_not_verdict: true };
      break;
    }
    case 'create_safe_action_plan': {
      requireCase(state);
      if (!state.riskCalculated || state.riskScore < 50) throw new Error('Calculate a high or critical risk assessment before creating the action plan.');
      state.safePlanGenerated = true;
      data = { step_codes: ['DO_NOT_REPLY', 'DO_NOT_UPLOAD_DOCUMENTS', 'VERIFY_VIA_OFFICIAL_NVIDIA_CAREERS', 'REPORT_IMPERSONATION', 'PRESERVE_EVIDENCE'], external_actions_taken: false };
      break;
    }
    case 'generate_trust_receipt': {
      requireCase(state);
      if (!state.humanAnswer) throw new Error('Human context is required before generating the Trust Receipt.');
      if (!state.riskCalculated) throw new Error('Calculate risk before generating the Trust Receipt.');
      state.receiptGenerated = true;
      state.phase = 'receipt-ready';
      state.activeView = 'receipt';
      data = { receipt_id: 'TR-ROS-NVDA-0826', risk_level: state.riskLevel, score: state.riskScore, case_fingerprint: '7A9F-1C42-ROS-NVDA' };
      break;
    }
  }

  if (mutation) state.revision += 1;
  addTimeline(state, tool, source, tool === 'request_human_context' ? 'waiting' : 'success');
  return {
    state,
    result: { ok: true, case_id: DEMO_CASE_ID, revision: state.revision, message: toolCopy[tool], data },
  };
}

export function applyHumanAnswer(current: RealityState, answer: 'yes' | 'no' | 'unsure'): RealityState {
  const state = clone(current);
  if (!state.humanQuestionPending) throw new Error('There is no pending human question.');
  state.humanAnswer = answer;
  state.humanQuestionPending = false;
  state.phase = 'investigating';
  state.revision += 1;
  addEvidenceByIds(state, ['evidence-human']);
  if (state.graphBuilt && !state.graphNodes.some((node) => node.id === 'node-human')) {
    state.graphNodes.push({ ...GRAPH_NODES.find((node) => node.id === 'node-human')! });
    state.graphEdges.push({ ...GRAPH_EDGES.find((edge) => edge.id === 'edge-8')! });
  }
  state.activity = [{ id: `event-${state.activity.length + 1}-human`, tool: 'human_context', detail: answer === 'no' ? 'Human confirmed: did not apply for this job' : `Human response recorded: ${answer}`, at: 'now', source: 'Human', outcome: 'success' }, ...state.activity];
  state.history.push({ id: `history-${state.history.length + 1}-human`, title: 'Human context recorded', detail: answer === 'no' ? 'Recipient confirmed they did not apply for the role.' : `Recipient answered ${answer}.`, at: 'Just now', kind: 'human' });
  return state;
}
