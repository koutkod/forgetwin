import { describe, expect, it } from 'vitest';
import { validatePublicHttpUrl } from '../app/api/evidence/route';
import { createLiveInitialState } from './reality-data';
import { applyTool, riskForState } from './reality-engine';

function liveCase() {
  let state = createLiveInitialState({
    title: 'Suspicious Acme recruiter message',
    caseType: 'job_offer',
    url: 'https://recruiting-example.test/offer',
    text: 'Act within 24 hours. Send your SSN and bank details to recruiter@recruiting-example.test on Signal. No interview is required for the Senior AI Engineer role.',
  });
  state = applyTool(state, 'create_case', { case_mode: 'live', title: state.caseTitle, case_type: state.caseType, expected_revision: state.revision }, 'UI').state;
  state = applyTool(state, 'add_evidence', { text: state.inputText, url: state.inputUrl, expected_revision: state.revision }, 'UI').state;
  return state;
}

describe('real-input investigations', () => {
  it('extracts only unresolved candidates from the submitted content', () => {
    let state = liveCase();
    state = applyTool(state, 'extract_entities', { expected_revision: state.revision }, 'UI').state;
    state = applyTool(state, 'extract_claims', { expected_revision: state.revision }, 'UI').state;
    expect(state.entities.some((entity) => entity.value.includes('recruiting-example.test'))).toBe(true);
    expect(state.entities.some((entity) => entity.value.includes('NVIDIA'))).toBe(false);
    expect(state.claims.length).toBeGreaterThan(2);
    expect(state.claims.every((claim) => claim.status === 'unresolved')).toBe(true);
    expect(riskForState(state).score).toBeGreaterThanOrEqual(50);
  });

  it('does not let subject content adjudicate its own claim', () => {
    let state = liveCase();
    state = applyTool(state, 'record_source', { locator: state.inputUrl, source_role: 'subject', source_data: { success: true, requestedUrl: state.inputUrl!, finalUrl: state.inputUrl!, markdown: 'Suspicious page', contentDigest: `sha256-${'a'.repeat(64)}` }, expected_revision: state.revision }, 'UI').state;
    state = applyTool(state, 'extract_entities', { expected_revision: state.revision }, 'UI').state;
    state = applyTool(state, 'extract_claims', { expected_revision: state.revision }, 'UI').state;
    const claim = state.claims[0];
    const evidence = state.evidence.find((item) => item.id.startsWith('evidence-live-'))!;
    state = applyTool(state, 'link_evidence', { claim_id: claim.id, evidence_id: evidence.id, relationship: 'supports', expected_revision: state.revision }, 'UI').state;
    expect(() => applyTool(state, 'verify_claim', { claim_id: claim.id, basis_ids: [evidence.id], expected_revision: state.revision }, 'UI')).toThrow(/context-only/i);
  });

  it('requires a persisted compatible link before a reviewed independent source can adjudicate', () => {
    let state = liveCase();
    state = applyTool(state, 'record_source', { locator: 'https://official.example.com/security', source_role: 'independent', source_data: { success: true, requestedUrl: 'https://official.example.com/security', finalUrl: 'https://official.example.com/security', markdown: 'Official security guidance', contentDigest: `sha256-${'b'.repeat(64)}` }, expected_revision: state.revision }, 'UI').state;
    state = applyTool(state, 'extract_entities', { expected_revision: state.revision }, 'UI').state;
    state = applyTool(state, 'extract_claims', { expected_revision: state.revision }, 'UI').state;
    const claim = state.claims[0];
    const evidence = state.evidence.find((item) => item.adjudicable)!;
    expect(() => applyTool(state, 'verify_claim', { claim_id: claim.id, basis_ids: [evidence.id], expected_revision: state.revision }, 'UI')).toThrow(/link every basis/i);
    state = applyTool(state, 'link_evidence', { claim_id: claim.id, evidence_id: evidence.id, relationship: 'supports', expected_revision: state.revision }, 'UI').state;
    state = applyTool(state, 'verify_claim', { claim_id: claim.id, basis_ids: [evidence.id], expected_revision: state.revision }, 'UI').state;
    expect(state.claims[0].status).toBe('verified');
  });
});

describe('protected URL boundary', () => {
  it('accepts normal public URLs and blocks local or disguised private targets', () => {
    expect(validatePublicHttpUrl('https://example.com/path')).toBe('https://example.com/path');
    expect(() => validatePublicHttpUrl('http://localhost./admin')).toThrow();
    expect(() => validatePublicHttpUrl('http://127.0.0.1/')).toThrow();
    expect(() => validatePublicHttpUrl('http://192.168.1.10/')).toThrow();
    expect(() => validatePublicHttpUrl('http://[::ffff:7f00:1]/')).toThrow();
    expect(() => validatePublicHttpUrl('https://example.com:8443/')).toThrow();
  });
});
