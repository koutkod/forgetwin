import { CLAIM_FIXTURES, ENTITY_FIXTURES, EVIDENCE_FIXTURES, GRAPH_EDGES, GRAPH_NODES } from './reality-data';
import { analyzeLiveClaims, analyzeLiveEntities, buildLiveGraph, caseFingerprint, deriveLiveRiskFactors, questionCodeForCase, safeActionForCase } from './live-analysis';
import type { CommandName, LiveSourceData, RealityState, RiskFactor, ToolResult, TrustStatus } from './reality-types';

const sourceEvidence: Record<string, string[]> = {
  'source-official-careers': ['evidence-official-domain', 'evidence-role', 'evidence-request'],
  'source-domain-registry': ['evidence-domain-age', 'evidence-portal'],
  'source-email-headers': ['evidence-email-auth'],
  'source-recruiter-directory': ['evidence-recruiter'],
};

const demoToolCopy: Record<CommandName, string> = {
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

const liveToolCopy: Record<CommandName, string> = {
  create_case: 'Created a real-input trust investigation',
  add_evidence: 'Quarantined submitted content as untrusted evidence',
  extract_entities: 'Extracted candidate entities without inferring truth',
  extract_claims: 'Extracted narrow candidate claims as unresolved',
  inspect_claim: 'Inspected claim and its current evidence basis',
  record_source: 'Recorded a live source and its retrieval provenance',
  link_evidence: 'Linked recorded evidence to a specific claim',
  verify_claim: 'Recorded a verified claim with an explicit evidence basis',
  contradict_claim: 'Recorded a contradiction with an explicit evidence basis',
  mark_unresolved: 'Preserved the claim as unresolved',
  request_human_context: 'Requested one piece of missing human context',
  calculate_risk: 'Calculated controlled, factor-based risk',
  build_evidence_graph: 'Built the live case evidence graph',
  generate_trust_receipt: 'Generated a shareable Trust Receipt',
  create_safe_action_plan: 'Created a safe independent-verification plan',
};

function toolCopy(state: RealityState, tool: CommandName) {
  return (state.caseMode === 'demo' ? demoToolCopy : liveToolCopy)[tool];
}

function safeId(input: unknown, fallback: string) {
  return typeof input === 'string' && /^[a-z][a-z0-9_-]{0,63}$/.test(input) ? input : fallback;
}

function clone(state: RealityState): RealityState {
  return structuredClone(state);
}

function addTimeline(state: RealityState, tool: CommandName, source: 'WebMCP' | 'UI' | 'Human', outcome: 'success' | 'waiting' = 'success') {
  const detail = toolCopy(state, tool);
  const id = `event-${state.activity.length + 1}-${tool}`;
  state.activity = [{ id, tool, detail, at: 'now', source, outcome }, ...state.activity].slice(0, 40);
  state.history = [...state.history, { id: `history-${state.history.length + 1}-${tool}`, title: tool.replaceAll('_', ' '), detail, at: 'Just now', kind: source === 'Human' ? 'human' : 'agent' }];
}

function requireCase(state: RealityState) {
  if (!state.caseCreated) throw new Error('Create the active case before using this tool.');
}

function requireRevision(state: RealityState, input: Record<string, unknown>) {
  if (input.expected_revision !== undefined && input.expected_revision !== state.revision) throw new Error(`State changed. Retry using revision ${state.revision}.`);
  if (input.expected_case_nonce !== undefined && input.expected_case_nonce !== state.caseNonce) throw new Error('The case instance changed. Inspect the current case before retrying.');
}

function addEvidenceByIds(state: RealityState, ids: string[]) {
  const present = new Set(state.evidence.map((item) => item.id));
  for (const id of ids) {
    const evidence = EVIDENCE_FIXTURES.find((item) => item.id === id);
    if (evidence && !present.has(id)) state.evidence.push({ ...evidence });
  }
}

function basisIds(rawInput: Record<string, unknown>) {
  return Array.isArray(rawInput.basis_ids) ? rawInput.basis_ids.filter((item): item is string => typeof item === 'string') : [];
}

function setClaimStatus(state: RealityState, claimId: string, status: TrustStatus) {
  const claim = state.claims.find((item) => item.id === claimId);
  if (!claim) throw new Error('Claim not found in the active case.');
  claim.status = status;
  if (status === 'verified') claim.confidence = Math.max(claim.confidence, 96);
  if (status === 'contradicted') claim.confidence = Math.max(claim.confidence, 94);
  if (status === 'unresolved') claim.confidence = Math.min(claim.confidence, 65);
}

function demoRiskFactors(state: RealityState): RiskFactor[] {
  return [
    { id: 'lookalike-domain', title: 'Lookalike recruiting domain', points: 20, detail: 'New domain does not match nvidia.com.', basisIds: ['evidence-domain-age'] },
    { id: 'unverified-portal', title: 'Unverified onboarding portal', points: 20, detail: 'Sensitive data requested on an unrelated domain.', basisIds: ['evidence-portal'] },
    { id: 'sensitive-request', title: 'Sensitive identity + banking request', points: 20, detail: 'Government ID, SSN card, and banking details requested.', basisIds: ['evidence-request'] },
    { id: 'email-auth', title: 'Email authentication failure', points: 12, detail: 'SPF failed and DKIM was absent.', basisIds: ['evidence-email-auth'] },
    ...(state.humanAnswer === 'no' ? [{ id: 'did-not-apply', title: 'Recipient did not apply', points: 24, detail: 'Decisive human-provided context.', basisIds: ['evidence-human'] }] : []),
    ...(state.humanAnswer === 'unsure' ? [{ id: 'application-unclear', title: 'Application history is unclear', points: 10, detail: 'Human-provided context remains uncertain.', basisIds: ['evidence-human'] }] : []),
    ...(state.humanAnswer === 'yes' ? [{ id: 'applied-context', title: 'Recipient applied for a similar role', points: 2, detail: 'Expected contact lowers concern only slightly because the contradictory infrastructure evidence remains.', basisIds: ['evidence-human'] }] : []),
  ];
}

function riskAssessmentForState(state: RealityState) {
  if (state.caseMode === 'demo') {
    const contradicted = state.claims.filter((claim) => claim.status === 'contradicted').length;
    const unresolved = state.claims.filter((claim) => claim.status === 'unresolved').length;
    let score = contradicted * 20 + unresolved * 5 + (state.caseCreated ? 2 : 0);
    if (state.humanAnswer === 'no') score += 24;
    if (state.humanAnswer === 'unsure') score += 10;
    if (state.humanAnswer === 'yes') score += 2;
    score = Math.min(100, score);
    const level = score >= 80 ? 'Critical risk' : score >= 50 ? 'High risk' : score >= 25 ? 'Guarded risk' : 'Low risk';
    return { score, level, factors: demoRiskFactors(state) } as const;
  }

  const factors = deriveLiveRiskFactors(state);
  if (state.humanAnswer === 'no') factors.push({ id: 'unexpected-context', title: 'Human says the contact was unexpected', points: 22, detail: 'The recipient did not initiate or recognize the claimed relationship.', basisIds: ['evidence-human'] });
  if (state.humanAnswer === 'unsure') factors.push({ id: 'uncertain-context', title: 'Human context remains uncertain', points: 8, detail: 'The recipient cannot yet confirm that the relationship or request was expected.', basisIds: ['evidence-human'] });
  const contradicted = state.claims.filter((claim) => claim.status === 'contradicted').length;
  const unresolved = state.claims.filter((claim) => claim.status === 'unresolved').length;
  if (contradicted) factors.push({ id: 'claim-contradictions', title: `${contradicted} claim${contradicted === 1 ? '' : 's'} contradicted by reviewed evidence`, points: contradicted * 12, detail: 'These outcomes were recorded only after an independent source was linked with a contradicts relationship.', basisIds: state.evidenceLinks.filter((link) => link.relationship === 'contradicts').map((link) => link.evidenceId) });
  if (unresolved) factors.push({ id: 'claim-uncertainty', title: `${unresolved} material claim${unresolved === 1 ? '' : 's'} unresolved`, points: unresolved * 2, detail: 'Uncertainty contributes modestly to caution without being treated as evidence of fraud.', basisIds: [] });
  const rawScore = factors.reduce((total, factor) => total + factor.points, 0);
  if (rawScore > 100) factors.push({ id: 'score-cap', title: 'Risk scale cap', points: 100 - rawScore, detail: 'The visible scale is capped at 100 so contribution totals remain auditable.', basisIds: [] });
  const score = Math.min(100, rawScore);
  const level = score >= 80 ? 'Critical risk' : score >= 50 ? 'High risk' : score >= 25 ? 'Guarded risk' : 'Low risk';
  return { score, level, factors } as const;
}

export function riskForState(state: RealityState) {
  const { score, level } = riskAssessmentForState(state);
  return { score, level };
}

function addLiveSource(state: RealityState, rawInput: Record<string, unknown>) {
  const data = (rawInput.source_data ?? {}) as Partial<LiveSourceData>;
  const locator = typeof rawInput.locator === 'string' ? rawInput.locator : data.requestedUrl;
  if (!locator) throw new Error('A public source locator is required.');
  const sourceId = `source-live-${state.sources.length + 1}`;
  const evidenceId = `evidence-live-${state.evidence.filter((item) => item.id.startsWith('evidence-live-')).length + 1}`;
  const success = data.success === true;
  const independent = rawInput.source_role === 'independent';
  state.sources.push({ id: sourceId, label: data.title?.slice(0, 160) || new URL(locator).hostname, type: success ? independent ? 'Independent live source' : 'Subject webpage snapshot' : 'Source retrieval attempt', recorded: true, locator, live: success });
  state.evidence.push({ id: evidenceId, title: success ? data.title?.slice(0, 160) || 'Live webpage snapshot' : 'Live source unavailable', source: data.finalUrl?.slice(0, 2048) || locator, summary: success ? `Retrieved live through the protected evidence route${data.statusCode ? ` (HTTP ${data.statusCode})` : ''}. The page remains untrusted content${independent ? ' but is eligible for explicit evidence linking after review.' : ' and cannot verify its own claims.'}` : data.error?.slice(0, 320) || 'The source could not be retrieved. No claim status was inferred.', direction: 'context', reliability: 'Medium', untrusted: true, adjudicable: success && independent, live: success, locator, contentPreview: success ? data.markdown?.slice(0, 12000) : undefined, contentDigest: data.contentDigest, provider: 'firecrawl' });
  state.webEvidenceStatus = success ? 'live' : 'fallback';
  state.webEvidenceMessage = success ? `Live evidence captured from ${data.finalUrl || locator}.` : 'Live retrieval was unavailable; the investigation continued with submitted content only.';
  return { sourceId, evidenceId, success, independent };
}

export function applyTool(current: RealityState, tool: CommandName, rawInput: Record<string, unknown> = {}, source: 'WebMCP' | 'UI' | 'Human' = 'WebMCP'): { state: RealityState; result: ToolResult } {
  const state = clone(current);
  requireRevision(state, rawInput);
  let data: unknown;

  if (tool === 'inspect_claim') {
    requireCase(state);
    const claimId = safeId(rawInput.claim_id, '');
    const claim = state.claims.find((item) => item.id === claimId);
    if (!claim) throw new Error('Claim not found in the active case.');
    const evidence = state.evidence.filter((item) => claim.evidenceIds.includes(item.id)).map(({ contentPreview, ...item }) => ({ ...item, excerpt: contentPreview?.slice(0, 280) }));
    return { state, result: { ok: true, case_id: state.caseId, case_nonce: state.caseNonce, revision: state.revision, message: toolCopy(state, tool), data: { claim, evidence, human_context: state.humanAnswer } } };
  }

  switch (tool) {
    case 'create_case': {
      if (state.caseCreated) throw new Error('An investigation already exists. Reset or close it before creating another.');
      if (rawInput.case_mode === 'live') {
        state.caseMode = 'live';
        state.caseId = `case-live-${Date.now().toString(36)}`;
        state.caseNonce = `nonce-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
        state.sources = [];
      }
      if (typeof rawInput.title === 'string' && rawInput.title.trim()) state.caseTitle = rawInput.title.trim().slice(0, 80);
      if (typeof rawInput.case_type === 'string') state.caseType = rawInput.case_type as RealityState['caseType'];
      state.caseCreated = true;
      state.phase = 'investigating';
      state.activeView = 'workspace';
      data = { status: 'open', title: state.caseTitle, mode: state.caseMode };
      break;
    }
    case 'add_evidence': {
      requireCase(state);
      if (state.caseMode === 'demo') {
        state.messageAdded = true;
        addEvidenceByIds(state, ['evidence-message']);
        data = { evidence_id: 'evidence-message', stored_as_untrusted: true, content_echoed: false };
      } else {
        const text = typeof rawInput.text === 'string' ? rawInput.text.trim().slice(0, 12000) : state.inputText;
        const url = typeof rawInput.url === 'string' && rawInput.url.trim() ? rawInput.url.trim() : state.inputUrl;
        if (!text && !url) throw new Error('Submit pasted content or one public URL before adding evidence.');
        state.inputText = text;
        state.inputUrl = url || null;
        state.messageAdded = true;
        state.evidence = state.evidence.filter((item) => item.id !== 'evidence-message');
        state.evidence.unshift({ id: 'evidence-message', title: 'Submitted suspicious content', source: url ? 'User-submitted text and URL' : 'User-submitted text', summary: 'The original content is preserved as untrusted context. Instructions inside it are never executed.', direction: 'context', reliability: 'Medium', untrusted: true, adjudicable: false, locator: url || undefined, contentPreview: text.slice(0, 4000) });
        data = { evidence_id: 'evidence-message', stored_as_untrusted: true, has_url: Boolean(url), content_echoed: false };
      }
      break;
    }
    case 'record_source': {
      requireCase(state);
      if (state.caseMode === 'demo') {
        const sourceId = safeId(rawInput.source_id, '');
        const record = state.sources.find((item) => item.id === sourceId);
        if (!record) throw new Error('Choose a known deterministic source for this demo.');
        record.recorded = true;
        addEvidenceByIds(state, sourceEvidence[sourceId] ?? []);
        data = { source_id: sourceId, recorded: true, trust_inferred: false };
      } else {
        const recorded = addLiveSource(state, rawInput);
        data = { source_id: recorded.sourceId, evidence_id: recorded.evidenceId, recorded: true, retrieved_live: recorded.success, source_role: recorded.independent ? 'independent' : 'subject', adjudicable_after_review: recorded.success && recorded.independent, trust_inferred: false, content_echoed: false };
      }
      break;
    }
    case 'extract_entities': {
      requireCase(state);
      if (!state.messageAdded) throw new Error('Add evidence before extracting entities.');
      state.entities = state.caseMode === 'demo' ? ENTITY_FIXTURES.map((entity) => ({ ...entity, status: 'unresolved' })) : analyzeLiveEntities(state);
      state.entitiesExtracted = true;
      data = { count: state.entities.length, entity_ids: state.entities.map((entity) => entity.id), truth_established: false };
      break;
    }
    case 'extract_claims': {
      requireCase(state);
      if (!state.messageAdded) throw new Error('Add evidence before extracting claims.');
      state.claims = state.caseMode === 'demo' ? CLAIM_FIXTURES.map((claim) => ({ ...claim, status: 'unresolved', confidence: 50, evidenceIds: [] })) : analyzeLiveClaims(state);
      state.claimsExtracted = true;
      data = { count: state.claims.length, claim_ids: state.claims.map((claim) => claim.id), truth_established: false };
      break;
    }
    case 'link_evidence': {
      requireCase(state);
      const claimId = safeId(rawInput.claim_id, '');
      const evidenceId = safeId(rawInput.evidence_id, '');
      const claim = state.claims.find((item) => item.id === claimId);
      if (!claim || !state.evidence.some((item) => item.id === evidenceId)) throw new Error('Claim or evidence is not available in the active case.');
      if (!claim.evidenceIds.includes(evidenceId)) claim.evidenceIds.push(evidenceId);
      const relationship = rawInput.relationship === 'supports' || rawInput.relationship === 'contradicts' ? rawInput.relationship : 'context';
      const linkId = `link-${claimId}-${evidenceId}`;
      state.evidenceLinks = state.evidenceLinks.filter((link) => link.id !== linkId);
      state.evidenceLinks.push({ id: linkId, claimId, evidenceId, relationship });
      data = { link_id: linkId, claim_id: claimId, evidence_id: evidenceId, relationship };
      break;
    }
    case 'verify_claim':
    case 'contradict_claim': {
      requireCase(state);
      const claimId = safeId(rawInput.claim_id, '');
      if (!claimId) throw new Error('A valid claim ID is required.');
      const basis = basisIds(rawInput);
      if (state.caseMode === 'live') {
        if (!basis.length) throw new Error('Live claim outcomes require at least one recorded evidence basis.');
        if (basis.some((id) => !state.evidence.some((item) => item.id === id))) throw new Error('Every basis ID must reference recorded evidence in this case.');
        if (basis.some((id) => !state.evidence.find((item) => item.id === id)?.adjudicable)) throw new Error('Subject content and failed retrievals are context-only. Use a reviewed independent source as the basis.');
        const requiredRelationship = tool === 'verify_claim' ? 'supports' : 'contradicts';
        if (basis.some((id) => !state.evidenceLinks.some((link) => link.claimId === claimId && link.evidenceId === id && link.relationship === requiredRelationship))) throw new Error(`Link every basis to this claim as ${requiredRelationship} before recording the outcome.`);
      }
      const status = tool === 'verify_claim' ? 'verified' : 'contradicted';
      setClaimStatus(state, claimId, status);
      const claim = state.claims.find((item) => item.id === claimId)!;
      basis.forEach((id) => { if (!claim.evidenceIds.includes(id)) claim.evidenceIds.push(id); });
      if (state.caseMode === 'demo') {
        const entityMap: Record<string, string[]> = tool === 'verify_claim' ? { 'claim-company': ['entity-nvidia', 'entity-official-domain'] } : { 'claim-domain': ['entity-domain', 'entity-email'], 'claim-portal': ['entity-portal'], 'claim-request': ['entity-request'] };
        for (const entityId of entityMap[claimId] ?? []) {
          const entity = state.entities.find((item) => item.id === entityId);
          if (entity) entity.status = status;
        }
      }
      data = { claim_id: claimId, status, basis_ids: basis };
      break;
    }
    case 'mark_unresolved': {
      requireCase(state);
      const claimId = safeId(rawInput.claim_id, '');
      if (!claimId) throw new Error('A valid claim ID is required.');
      setClaimStatus(state, claimId, 'unresolved');
      data = { claim_id: claimId, status: 'unresolved', needs_independent_verification: true };
      break;
    }
    case 'request_human_context': {
      requireCase(state);
      if (!state.claimsExtracted) throw new Error('Extract claims before requesting human context.');
      state.humanQuestionCode = state.caseMode === 'demo' ? 'job_application_history' : questionCodeForCase(state.caseType);
      state.humanQuestionPending = true;
      state.phase = 'awaiting-human';
      state.activeView = 'review';
      data = { request_id: `human-request-${state.humanQuestionCode}`, question_code: state.humanQuestionCode, status: 'awaiting_human' };
      break;
    }
    case 'calculate_risk': {
      requireCase(state);
      if (!state.claimsExtracted) throw new Error('Extract claims before calculating risk.');
      const risk = riskAssessmentForState(state);
      state.riskScore = risk.score;
      state.riskLevel = risk.level;
      state.riskFactors = risk.factors.map((factor) => ({ ...factor, basisIds: [...factor.basisIds] }));
      state.riskCalculated = true;
      if (state.humanAnswer) state.phase = 'assessed';
      data = { score: risk.score, level: risk.level, factor_count: risk.factors.length, provisional: state.humanAnswer === null, based_on_revision: state.revision + 1 };
      break;
    }
    case 'build_evidence_graph': {
      requireCase(state);
      if (!state.entitiesExtracted || !state.claimsExtracted) throw new Error('Extract entities and claims before building the graph.');
      state.graphBuilt = true;
      if (state.caseMode === 'demo') {
        state.graphNodes = GRAPH_NODES.filter((node) => state.humanAnswer || node.id !== 'node-human').map((node) => ({ ...node }));
        state.graphEdges = GRAPH_EDGES.filter((edge) => state.humanAnswer || edge.id !== 'edge-8').map((edge) => ({ ...edge }));
      } else {
        const graph = buildLiveGraph(state);
        state.graphNodes = graph.nodes;
        state.graphEdges = graph.edges;
      }
      data = { node_count: state.graphNodes.length, edge_count: state.graphEdges.length, graph_is_evidence_map_not_verdict: true };
      break;
    }
    case 'create_safe_action_plan': {
      requireCase(state);
      if (!state.riskCalculated) throw new Error('Calculate risk before creating the action plan.');
      state.safePlanGenerated = true;
      data = state.caseMode === 'demo' ? { step_codes: ['DO_NOT_REPLY', 'DO_NOT_UPLOAD_DOCUMENTS', 'VERIFY_VIA_OFFICIAL_NVIDIA_CAREERS', 'REPORT_IMPERSONATION', 'PRESERVE_EVIDENCE'], external_actions_taken: false } : { step_codes: ['PAUSE_REQUEST', 'PRESERVE_EVIDENCE', 'VERIFY_INDEPENDENTLY', 'USE_OFFICIAL_CHANNEL', 'ESCALATE_IF_CONFIRMED'], safest_action: safeActionForCase(state), external_actions_taken: false };
      break;
    }
    case 'generate_trust_receipt': {
      requireCase(state);
      if (!state.humanAnswer) throw new Error('Human context is required before generating the Trust Receipt.');
      if (!state.riskCalculated) throw new Error('Calculate risk before generating the Trust Receipt.');
      state.receiptGenerated = true;
      state.phase = 'receipt-ready';
      state.activeView = 'receipt';
      data = { receipt_id: state.caseMode === 'demo' ? 'TR-ROS-NVDA-0826' : `TR-ROS-${state.caseId.slice(-8).toUpperCase()}`, risk_level: state.riskLevel, score: state.riskScore, case_fingerprint: state.caseMode === 'demo' ? '7A9F-1C42-ROS-NVDA' : caseFingerprint(state) };
      break;
    }
  }

  if (['add_evidence', 'record_source', 'extract_entities', 'extract_claims', 'link_evidence', 'verify_claim', 'contradict_claim', 'mark_unresolved'].includes(tool)) {
    state.riskCalculated = false;
    state.receiptGenerated = false;
    state.safePlanGenerated = false;
    if (state.phase === 'receipt-ready' || state.phase === 'assessed') state.phase = 'investigating';
  }
  state.revision += 1;
  addTimeline(state, tool, source, tool === 'request_human_context' ? 'waiting' : 'success');
  return { state, result: { ok: true, case_id: state.caseId, case_nonce: state.caseNonce, revision: state.revision, message: toolCopy(state, tool), data } };
}

export function applyHumanAnswer(current: RealityState, answer: 'yes' | 'no' | 'unsure'): RealityState {
  const state = clone(current);
  if (!state.humanQuestionPending) throw new Error('There is no pending human question.');
  state.humanAnswer = answer;
  state.humanQuestionPending = false;
  state.phase = 'investigating';
  state.revision += 1;
  state.riskCalculated = false;
  state.receiptGenerated = false;
  state.safePlanGenerated = false;
  if (state.caseMode === 'demo') {
    if (answer === 'no') addEvidenceByIds(state, ['evidence-human']);
    else {
      state.evidence = state.evidence.filter((item) => item.id !== 'evidence-human');
      state.evidence.push({ id: 'evidence-human', title: 'Applicant context', source: 'Human response', summary: answer === 'yes' ? 'The recipient states they applied for a similar role.' : 'The recipient is unsure whether they applied for this role.', direction: 'context', reliability: 'Human provided' });
    }
    if (state.graphBuilt && !state.graphNodes.some((node) => node.id === 'node-human')) {
      const humanNode = { ...GRAPH_NODES.find((node) => node.id === 'node-human')! };
      if (answer !== 'no') humanNode.label = answer === 'yes' ? 'Applied previously' : 'Application unclear';
      state.graphNodes.push(humanNode);
      state.graphEdges.push({ ...GRAPH_EDGES.find((edge) => edge.id === 'edge-8')! });
    }
  } else {
    state.evidence = state.evidence.filter((item) => item.id !== 'evidence-human');
    state.evidence.push({ id: 'evidence-human', title: 'Recipient context', source: 'Human response in RealityOS', summary: answer === 'no' ? 'The recipient says the contact, purchase, relationship, or request was not initiated or expected.' : answer === 'yes' ? 'The recipient recognizes or expected the underlying relationship.' : 'The recipient is not sure whether the relationship or request was expected.', direction: 'context', reliability: 'Human provided' });
    if (state.graphBuilt) {
      const graph = buildLiveGraph(state);
      state.graphNodes = graph.nodes;
      state.graphEdges = graph.edges;
    }
  }
  const detail = answer === 'no' ? 'Human confirmed the contact or request was unexpected' : `Human response recorded: ${answer}`;
  state.activity = [{ id: `event-${state.activity.length + 1}-human`, tool: 'human_context', detail, at: 'now', source: 'Human', outcome: 'success' }, ...state.activity];
  state.history.push({ id: `history-${state.history.length + 1}-human`, title: 'Human context recorded', detail, at: 'Just now', kind: 'human' });
  return state;
}
