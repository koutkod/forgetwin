import type { CaseType, Claim, Entity, GraphEdge, GraphNode, HumanQuestionCode, RealityState, RiskFactor } from './reality-types';

const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const URL_RE = /https?:\/\/[^\s<>()"']+/gi;
const PHONE_RE = /(?:\+?\d[\d ().-]{7,}\d)/g;
const MONEY_RE = /(?:[$€£]\s?\d[\d,]*(?:\.\d{2})?|\b\d[\d,]*\s?(?:USD|EUR|GBP)\b)/gi;

function unique(values: string[], limit = 8) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].slice(0, limit);
}

function trimPunctuation(value: string) {
  return value.replace(/[),.;!?]+$/g, '');
}

function hostFor(value: string) {
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function combinedText(state: Pick<RealityState, 'inputText' | 'inputUrl' | 'evidence'>) {
  const live = state.evidence.filter((item) => item.live).map((item) => item.contentPreview ?? '').join('\n');
  return [state.inputText, state.inputUrl ?? '', live].filter(Boolean).join('\n').slice(0, 24000);
}

function sentenceCandidates(text: string) {
  return unique(
    text
      .replace(/\r/g, '')
      .split(/(?<=[.!?])\s+|\n+/)
      .map((sentence) => sentence.replace(/\s+/g, ' ').trim())
      .filter((sentence) => sentence.length >= 28 && sentence.length <= 220)
      .filter((sentence) => !/^(system|assistant|developer)\s*:/i.test(sentence))
      .filter((sentence) => /\b(?:is|are|will|has|have|offers?|requires?|belongs?|authorized|approved|selected|won|owe|due|pay|upload|verify)\b/i.test(sentence)),
    3,
  );
}

function caseVerification(caseType: CaseType) {
  switch (caseType) {
    case 'job_offer':
      return 'Locate the role on the company’s official careers site and contact recruiting through details obtained there—not through this message.';
    case 'invoice':
      return 'Open the vendor or account portal independently from a saved bookmark or official website and match the invoice number, amount, and recipient.';
    case 'marketplace':
      return 'Use the marketplace’s official order and seller records, then keep payment and messaging inside the platform.';
    case 'identity':
      return 'Confirm the person through an official organization directory or a known contact channel obtained independently.';
    case 'website':
      return 'Confirm the exact domain from the organization’s independently located official site and corroborate ownership with a primary source.';
    default:
      return 'Confirm the claim with a primary source reached independently from the links, phone numbers, and reply addresses in the suspicious content.';
  }
}

export function analyzeLiveEntities(state: RealityState): Entity[] {
  const text = combinedText(state);
  const emails = unique(text.match(EMAIL_RE) ?? [], 4);
  const urls = unique([...(text.match(URL_RE) ?? []).map(trimPunctuation), ...(state.inputUrl ? [state.inputUrl] : [])], 4);
  const domains = unique([...emails.map((email) => email.split('@')[1]?.toLowerCase() ?? ''), ...urls.map(hostFor)], 5);
  const phones = unique(text.match(PHONE_RE) ?? [], 3);
  const money = unique(text.match(MONEY_RE) ?? [], 3);
  const entities: Entity[] = [];

  const add = (kind: Entity['kind'], label: string, value: string) => {
    entities.push({ id: `entity-live-${entities.length + 1}`, kind, label, value: value.slice(0, 180), status: 'unresolved' });
  };

  emails.forEach((email) => add('email', 'Email address', email));
  domains.forEach((domain) => add('domain', 'Domain', domain));
  urls.forEach((url) => add('website', 'Website', url));
  phones.forEach((phone) => add('phone', 'Phone number', phone));

  const organization = text.match(/\b([A-Z][A-Za-z0-9&.-]+(?:\s+[A-Z][A-Za-z0-9&.-]+){0,3})\s+(?:Inc\.?|LLC|Ltd\.?|Corporation|Corp\.?|Company)\b/);
  if (organization) add('organization', 'Claimed organization', organization[0]);

  if (state.caseType === 'job_offer') {
    const role = text.match(/\b(?:(?:Senior|Junior|Lead|Staff|Principal|Remote)\s+){0,2}[A-Z][A-Za-z+/.-]+(?:\s+[A-Z][A-Za-z+/.-]+){0,3}\s+(?:Engineer|Developer|Manager|Designer|Analyst|Scientist|Recruiter)\b/);
    add('job', 'Claimed role', [role?.[0] ?? 'Job offer', money[0]].filter(Boolean).join(' · '));
  }

  const sensitive = unique((text.match(/\b(?:social security|ssn|government id|passport|driver'?s license|bank details|bank account|routing number|seed phrase|verification code|password|login credentials)\b/gi) ?? []), 6);
  if (sensitive.length) add('request', 'Sensitive request', sensitive.join(', '));
  else if (money.length) add('request', 'Money mentioned', money.join(', '));

  if (!entities.length) add('request', 'Imported content', 'Unstructured message or document requiring independent verification');
  return entities.slice(0, 12);
}

export function analyzeLiveClaims(state: RealityState): Claim[] {
  const text = combinedText(state);
  const emails = unique(text.match(EMAIL_RE) ?? [], 2);
  const urls = unique([...(text.match(URL_RE) ?? []).map(trimPunctuation), ...(state.inputUrl ? [state.inputUrl] : [])], 3);
  const domains = unique([...emails.map((email) => email.split('@')[1]?.toLowerCase() ?? ''), ...urls.map(hostFor)], 3);
  const claims: Array<Omit<Claim, 'id'>> = [];
  const verification = caseVerification(state.caseType);

  const add = (title: string, detail: string, whatWouldProve = verification) => {
    if (claims.some((claim) => claim.title === title)) return;
    claims.push({ title: title.slice(0, 120), detail: detail.slice(0, 360), status: 'unresolved', confidence: 50, evidenceIds: ['evidence-message'], whatWouldProve, reason: 'Candidate claim extracted from untrusted content. No truth status is inferred from appearance or wording.' });
  };

  const coreByType: Record<CaseType, [string, string]> = {
    job_offer: ['The job offer is authorized', 'The role, compensation, recruiter, and hiring process are genuinely authorized by the claimed employer.'],
    email: ['The message and its request are legitimate', 'The sender is authorized and the requested action is safe and expected.'],
    website: ['The website represents the claimed organization', 'The site’s exact domain and operators have a verified relationship to the identity it presents.'],
    invoice: ['The invoice is valid and payable', 'The vendor, account, amount, and payment instructions match an independently confirmed obligation.'],
    marketplace: ['The listing and seller are legitimate', 'The listing, seller identity, item, and payment path match official marketplace records.'],
    identity: ['The online identity belongs to the claimed person', 'The profile, contact details, and organization relationship can be independently confirmed.'],
    other: ['The imported request is legitimate', 'The identity, authority, and requested action are supported by independent evidence.'],
  };
  add(...coreByType[state.caseType]);

  emails.forEach((email) => add(`The sender ${email} is authorized`, `The owner of ${email} is authorized to make the claims and requests contained in the evidence.`));
  domains.forEach((domain) => add(`The domain ${domain} is officially operated`, `The exact domain ${domain} belongs to, or is approved by, the organization it claims to represent.`, 'Find the organization through an independent search or known official record and confirm that it lists this exact domain.'));

  if (/\b(?:social security|ssn|government id|passport|bank details|routing number|seed phrase|verification code|password|credentials)\b/i.test(text)) {
    add('The sensitive-data request is part of a legitimate process', 'The requested identity, banking, or account data can be submitted safely through the channel supplied.', 'Do not submit anything. Reach the organization through an independently obtained official channel and ask it to confirm the exact process.');
  }
  if (/\b(?:wire|gift card|crypto|bitcoin|usdt|deposit|processing fee|advance fee|payment)\b/i.test(text)) {
    add('The requested payment method is authorized', 'The amount, recipient, and payment rail are part of a real obligation.', 'Confirm the amount and recipient inside an independently reached official account or order portal before paying.');
  }

  for (const sentence of sentenceCandidates(text)) {
    if (claims.length >= 8) break;
    const title = sentence.length > 82 ? `${sentence.slice(0, 79)}…` : sentence;
    add(title, `Candidate factual statement preserved from the imported content: “${sentence}”`);
  }

  return claims.slice(0, 8).map((claim, index) => ({ id: `claim-live-${index + 1}`, ...claim }));
}

export function deriveLiveRiskFactors(state: RealityState): RiskFactor[] {
  const text = combinedText(state);
  const domains = unique([...(text.match(URL_RE) ?? []).map((url) => hostFor(trimPunctuation(url))), ...((text.match(EMAIL_RE) ?? []).map((email) => email.split('@')[1]?.toLowerCase() ?? ''))], 8);
  const factors: RiskFactor[] = [];
  const add = (id: string, title: string, points: number, detail: string) => factors.push({ id, title, points, detail, basisIds: ['evidence-message'] });

  if (/\b(?:within\s+\d+\s+hours?|act now|immediately|urgent|today only|final notice|account will be|expires? today)\b/i.test(text)) add('urgency', 'Time pressure or urgency', 12, 'The content pressures the recipient to act before independent verification.');
  if (/\b(?:social security|ssn|government id|passport|driver'?s license|bank details|bank account|routing number|seed phrase)\b/i.test(text)) add('sensitive-data', 'Sensitive identity or financial data requested', 22, 'High-impact personal data is requested through a channel that has not been independently verified.');
  if (/\b(?:password|login credentials|verification code|one[- ]time code|otp|security code)\b/i.test(text)) add('credentials', 'Credentials or security code requested', 22, 'Legitimate support and recruiting processes should not ask for reusable passwords or one-time security codes.');
  if (/\b(?:gift cards?|crypto(?:currency)?|bitcoin|usdt|wire transfer|western union|moneygram|advance fee|processing fee)\b/i.test(text)) add('payment-rail', 'High-risk or irreversible payment method', 20, 'The requested payment rail is difficult to reverse and deserves independent confirmation.');
  if (/\b(?:signal|telegram|whatsapp|move (?:this|our) conversation|text me)\b/i.test(text)) add('off-platform', 'Move to an off-platform channel', 12, 'The recipient is directed away from the organization or marketplace’s normal communication channel.');
  if (/\b(?:no (?:additional )?interview|required no interview|profile was selected|guaranteed return|guaranteed profit|you have won|prize winner)\b/i.test(text)) add('implausible-process', 'Unusual or implausible process claim', 12, 'The process bypasses a normal verification or decision step.');
  if (domains.length > 1) add('domain-mismatch', 'Multiple contact domains need confirmation', 10, `The content uses ${domains.length} distinct domains. Each relationship must be confirmed independently.`);
  if (/\b(?:ignore (?:all )?(?:previous|prior) instructions|system\s*:|developer\s*:|reveal (?:your )?(?:prompt|instructions))\b/i.test(text)) add('prompt-injection', 'Instruction-like content quarantined', 8, 'The evidence contains instruction-shaped text. RealityOS stores it as data and does not execute it.');
  return factors;
}

export function buildLiveGraph(state: RealityState): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const positions: Array<[number, number]> = [[50, 14], [20, 22], [80, 22], [12, 48], [88, 48], [22, 76], [78, 76], [50, 86], [36, 38], [64, 38], [34, 62], [66, 62], [50, 50], [8, 82], [92, 82]];
  const nodes: GraphNode[] = [];
  const claimNodeIds = new Map<string, string>();
  const entityNodeIds = new Map<string, string>();
  let cursor = 0;

  for (const claim of state.claims.slice(0, 5)) {
    const nodeId = `node-${claim.id}`;
    const [x, y] = positions[cursor++ % positions.length];
    nodes.push({ id: nodeId, type: 'claim', label: claim.title, sublabel: 'Candidate claim', status: claim.status, x, y });
    claimNodeIds.set(claim.id, nodeId);
  }
  for (const entity of state.entities.slice(0, 6)) {
    const nodeId = `node-${entity.id}`;
    const [x, y] = positions[cursor++ % positions.length];
    nodes.push({ id: nodeId, type: 'entity', label: entity.value, sublabel: entity.label, status: entity.status, x, y });
    entityNodeIds.set(entity.id, nodeId);
  }

  const contextEvidence = state.evidence.slice(0, 3);
  for (const evidence of contextEvidence) {
    const [x, y] = positions[cursor++ % positions.length];
    nodes.push({ id: `node-${evidence.id}`, type: 'evidence', label: evidence.title, sublabel: evidence.live ? 'Live untrusted source' : evidence.source, status: evidence.reliability === 'Human provided' ? 'human' : 'unresolved', x, y });
  }

  const edges: GraphEdge[] = [];
  const messageNode = nodes.find((node) => node.id === 'node-evidence-message');
  if (messageNode) state.entities.slice(0, 6).forEach((entity, index) => edges.push({ id: `edge-entity-${index + 1}`, source: entityNodeIds.get(entity.id)!, target: messageNode.id, label: 'extracted from', status: 'unresolved' }));
  for (const link of state.evidenceLinks) {
    const sourceNode = nodes.find((node) => node.id === `node-${link.evidenceId}`);
    const targetNode = claimNodeIds.get(link.claimId);
    const claim = state.claims.find((item) => item.id === link.claimId);
    if (!sourceNode || !targetNode || !claim) continue;
    const status = link.relationship === 'supports' && claim.status === 'verified' ? 'verified' : link.relationship === 'contradicts' && claim.status === 'contradicted' ? 'contradicted' : 'unresolved';
    edges.push({ id: link.id.replace(/^link-/, 'edge-link-'), source: sourceNode.id, target: targetNode, label: link.relationship, status });
  }
  const humanNode = nodes.find((node) => node.id === 'node-evidence-human');
  const firstClaim = state.claims[0] ? claimNodeIds.get(state.claims[0].id) : undefined;
  if (humanNode && firstClaim) edges.push({ id: 'edge-human-context', source: humanNode.id, target: firstClaim, label: 'human context', status: 'human' });
  return { nodes, edges };
}

export function questionCodeForCase(caseType: CaseType): HumanQuestionCode {
  if (caseType === 'job_offer') return 'job_application_history';
  if (caseType === 'invoice') return 'purchase_recognition';
  if (caseType === 'marketplace' || caseType === 'website' || caseType === 'identity') return 'prior_relationship';
  return 'message_expected';
}

export function questionCopy(code: HumanQuestionCode | null) {
  switch (code) {
    case 'job_application_history': return { lead: 'Before this offer arrived:', question: 'Did you actually apply for this job?', yes: 'I applied for this role', no: 'I never applied' };
    case 'purchase_recognition': return { lead: 'Before this invoice arrived:', question: 'Do you recognize this purchase or vendor?', yes: 'I recognize it', no: 'I do not recognize it' };
    case 'prior_relationship': return { lead: 'Before this interaction:', question: 'Have you previously dealt with this person, seller, or site?', yes: 'I have dealt with them', no: 'No prior relationship' };
    default: return { lead: 'Before this request arrived:', question: 'Were you expecting this message or request?', yes: 'I was expecting it', no: 'It was unexpected' };
  }
}

export function safeActionForCase(state: Pick<RealityState, 'caseType' | 'inputUrl'>) {
  const avoid = state.inputUrl ? 'Do not use the submitted URL as your verification path.' : 'Do not use contact details contained in the suspicious material.';
  return `${caseVerification(state.caseType)} ${avoid}`;
}

export function caseFingerprint(state: Pick<RealityState, 'caseId' | 'caseTitle' | 'inputUrl'>) {
  const input = `${state.caseId}|${state.caseTitle}|${state.inputUrl ?? ''}`;
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const hex = (hash >>> 0).toString(16).toUpperCase().padStart(8, '0');
  return `${hex.slice(0, 4)}-${hex.slice(4)}-ROS-LIVE`;
}
