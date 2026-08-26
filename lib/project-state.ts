import type { AgentActivity, ProjectState, RemediationChange, Screen } from './types';

const now = () => new Date().toISOString();
const uid = (prefix: string) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

export const INITIAL_PROJECT_STATE: ProjectState = {
  projectId: 'arbor_creek_2026',
  projectName: 'City of Arbor Creek · 2026 Community Energy Report',
  slug: 'city-of-arbor-creek-energy-report',
  sourceType: 'demo',
  audited: false,
  detectedIssueIds: [],
  ignoredIssueIds: [],
  changes: [],
  humanContext: {},
  version: 1,
  screen: 'overview',
  activity: [{id:'activity_ready',tool:'load_demo',summary:'Demo content ready for audit',kind:'system',timestamp:now()}],
};

export function addActivity(state: ProjectState, tool: string, summary: string, kind: AgentActivity['kind']): ProjectState {
  return {...state, activity: [{id:uid('activity'),tool,summary,kind,timestamp:now()}, ...state.activity].slice(0, 30)};
}

export function navigate(state: ProjectState, screen: Screen): ProjectState {
  return {...state, screen, selectedIssueId: undefined};
}

export function auditState(state: ProjectState, issueIds: string[], source: 'ui' | 'agent' = 'ui'): ProjectState {
  const auditId = uid('audit');
  const next = {...state, audited:true, auditId, detectedIssueIds:issueIds, screen:'overview' as Screen};
  return addActivity(next, 'audit_content', `Found ${issueIds.length} issues in the tested content`, source === 'agent' ? 'read' : 'system');
}

export function createChange(issueIds: string[], action: string, before: string, after: string, source: RemediationChange['source'], confidence?: number): RemediationChange {
  return {id:uid('change'),issueIds,action,before,after,source,confidence,timestamp:now(),reverted:false};
}

const SAFE_CHANGE_GROUPS = [
  {ids:['lang'],action:'Added document language',before:'<html>',after:'<html lang="en">',confidence:.99},
  {ids:['doc-title'],action:'Named the document',before:'<title>Report</title>',after:'<title>2026 Community Energy Report | City of Arbor Creek</title>',confidence:.95},
  {ids:['main','heading-order','aria-reference','region-name'],action:'Normalized semantic structure',before:'Generic wrapper, skipped headings, unresolved labels',after:'Main landmark, logical headings, resolved region labels',confidence:.94},
  {ids:['keyboard-cta'],action:'Made report download keyboard accessible',before:'<div role="button">Download report</div>',after:'<a href="#download">Download report</a>',confidence:.99},
  {ids:['email-label','consent-label'],action:'Associated newsletter form labels',before:'Unlabeled email and checkbox controls',after:'Visible and programmatically associated labels',confidence:.97},
  {ids:['menu-name'],action:'Named the menu button',before:'<button>☰</button>',after:'<button aria-label="Open site menu">☰</button>',confidence:.96},
  {ids:['table-headers'],action:'Added scoped table headers',before:'Header row used td cells',after:'Header row uses th scope="col"',confidence:.94},
];

export function applySafeState(state: ProjectState, unresolvedIds: string[], source: 'ui' | 'agent' = 'ui') {
  const active = new Set(state.changes.filter((change) => !change.reverted).flatMap((change) => change.issueIds));
  const unresolved = new Set(unresolvedIds);
  const groups = SAFE_CHANGE_GROUPS.map((group) => ({...group, ids:group.ids.filter((id) => unresolved.has(id) && !active.has(id))})).filter((group) => group.ids.length);
  if (!groups.length) return addActivity(state, 'apply_safe_fixes', 'No eligible deterministic fixes remained', source === 'agent' ? 'write' : 'system');
  const changes = groups.map((group) => createChange(group.ids, group.action, group.before, group.after, source === 'agent' ? 'agent' : 'ui', group.confidence));
  const fixedCount = changes.reduce((total, change) => total + change.issueIds.length, 0);
  const next = {...state, changes:[...state.changes,...changes],version:state.version+1,verifiedVersion:undefined,screen:'overview' as Screen};
  return addActivity(next, 'apply_safe_fixes', `Applied ${fixedCount} reversible fixes across ${changes.length} changes`, source === 'agent' ? 'write' : 'system');
}

export function submitContextState(state: ProjectState, issueId: string, context: string, source: 'human' | 'agent' = 'human') {
  const next = {...state,humanContext:{...state.humanContext,[issueId]:context},screen:'review' as Screen};
  return addActivity(next, 'submit_human_context', `Context received for ${issueId.replaceAll('-', ' ')}`, source === 'agent' ? 'write' : 'human');
}

export function applyIssueState(state: ProjectState, issueId: string, label: string, before: string, after: string, confidence: number, source: RemediationChange['source']) {
  const alreadyActive = state.changes.some((change) => !change.reverted && change.issueIds.includes(issueId));
  if (alreadyActive) return state;
  const change = createChange([issueId], label, before, after, source, confidence);
  const next = {...state,changes:[...state.changes,change],version:state.version+1,verifiedVersion:undefined};
  return addActivity(next, 'apply_fix', label, source === 'human' ? 'human' : 'write');
}

export function ignoreIssueState(state: ProjectState, issueId: string) {
  if (state.ignoredIssueIds.includes(issueId)) return state;
  return addActivity({...state,ignoredIssueIds:[...state.ignoredIssueIds,issueId]},'ignore_issue',`Ignored ${issueId.replaceAll('-', ' ')}`,'human');
}

export function revertChangeState(state: ProjectState, changeId: string, source: 'ui' | 'agent' = 'ui') {
  const target = state.changes.find((change) => change.id === changeId);
  if (!target) throw new Error('Change not found');
  const willRestore = target.reverted;
  const changes = state.changes.map((change) => change.id === changeId ? {...change,reverted:!change.reverted} : change);
  const next = {...state,changes,version:state.version+1,verifiedVersion:undefined};
  return addActivity(next, willRestore ? 'restore_fix' : 'revert_fix', `${willRestore ? 'Restored' : 'Reverted'}: ${target.action}`, source === 'agent' ? 'write' : 'human');
}

export function verifyState(state: ProjectState, remainingCount: number, score: number, source: 'ui' | 'agent' = 'ui') {
  const next = {...state,verifiedVersion:state.version};
  return addActivity(next,'verify_content',`Score ${score}; ${remainingCount} automatically detectable issues remain`,source === 'agent' ? 'read' : 'system');
}

export function publishState(state: ProjectState, source: 'ui' | 'agent' = 'ui') {
  const publishedVersion = (state.publishedVersion ?? 0) + 1;
  const next = {...state,publishedVersion,publishedAt:now(),screen:'publish' as Screen};
  return addActivity(next,'publish_accessible_version',`Published Accessible Web Twin v${publishedVersion}`,source === 'agent' ? 'write' : 'system');
}

export function resetState(): ProjectState {
  return {...INITIAL_PROJECT_STATE,activity:[{id:uid('activity'),tool:'reset_demo',summary:'Restored the original City of Arbor Creek demo',kind:'system',timestamp:now()}]};
}
