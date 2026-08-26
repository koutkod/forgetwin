'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Accessibility, Activity, AlertTriangle, ArrowRight, ArrowUpRight,
  BookOpenText, Bot, Check, CheckCircle2, ChevronRight, CircleAlert, Clock3,
  Code2, Eye, FileCheck2, FileDiff, Filter, Globe2, History, Home, Info,
  Layers3, ListChecks, MonitorUp, RefreshCcw, RotateCcw, Search,
  Send, ShieldCheck, SlidersHorizontal, Sparkles, WandSparkles, X, Zap,
  type LucideIcon,
} from 'lucide-react';
import { DEMO_HTML, HUMAN_REVIEW_IDS, ISSUE_CATALOG } from '../../lib/demo-content';
import {
  applyFixes, calculateScore, fixedIdsFromChanges, getScreenReaderOutline,
  runAudit, statusForIssue, summarizeAudit,
} from '../../lib/audit-engine';
import {
  INITIAL_PROJECT_STATE, applyIssueState, applySafeState, auditState, ignoreIssueState,
  navigate, publishState, resetState, revertChangeState, submitContextState, verifyState,
} from '../../lib/project-state';
import type { AccessibilityIssue, ProjectState, Screen, Severity } from '../../lib/types';
import { useWebMCP, type WebMCPCommandApi } from '../../lib/use-webmcp';

const STORAGE_KEY = 'a11yrelay-demo-state-v1';
const severityOrder: Severity[] = ['critical','serious','moderate','minor'];

type IssueView = AccessibilityIssue & {status: ReturnType<typeof statusForIssue>};

const navItems: {screen:Screen;label:string;icon:LucideIcon}[] = [
  {screen:'overview',label:'Overview',icon:Home},
  {screen:'issues',label:'Issues',icon:ListChecks},
  {screen:'review',label:'Human review',icon:Sparkles},
  {screen:'compare',label:'Compare',icon:FileDiff},
  {screen:'reader',label:'Reader outline',icon:BookOpenText},
  {screen:'history',label:'History',icon:History},
  {screen:'publish',label:'Publish',icon:Globe2},
  {screen:'tools',label:'WebMCP tools',icon:Code2},
];

function htmlForState(state: ProjectState) {
  return applyFixes(DEMO_HTML, fixedIdsFromChanges(state.changes), state.humanContext);
}

function viewsForState(state: ProjectState): IssueView[] {
  const fixed = fixedIdsFromChanges(state.changes);
  return ISSUE_CATALOG.map((issue) => ({...issue,status:statusForIssue(issue,fixed,state.ignoredIssueIds,state.humanContext)}));
}

export default function WorkspaceApp() {
  const [state,setState] = useState<ProjectState>(INITIAL_PROJECT_STATE);
  const stateRef = useRef(state);
  const [liveMessage,setLiveMessage] = useState('City of Arbor Creek demo loaded.');
  const [filterOpen,setFilterOpen] = useState(false);
  const [mobileNav,setMobileNav] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as ProjectState;
        if (parsed.projectId === INITIAL_PROJECT_STATE.projectId) window.setTimeout(() => { stateRef.current = parsed; setState(parsed); }, 0);
      }
    } catch { localStorage.removeItem(STORAGE_KEY); }
  }, []);

  useEffect(() => { localStorage.setItem(STORAGE_KEY,JSON.stringify(state)); },[state]);

  const commit = useCallback((updater:(current:ProjectState)=>ProjectState) => {
    const next = updater(stateRef.current);
    stateRef.current = next;
    setState(next);
    return next;
  },[]);

  const announce = (message:string) => setLiveMessage(message);
  const currentHtml = useMemo(() => htmlForState(state),[state]);
  const originalIssues = useMemo(() => runAudit(DEMO_HTML),[]);
  const currentIssues = useMemo(() => runAudit(currentHtml),[currentHtml]);
  const issueViews = useMemo(() => viewsForState(state),[state]);
  const score = calculateScore(currentIssues);
  const originalScore = calculateScore(originalIssues);

  const doAudit = useCallback((source:'ui'|'agent'='ui') => {
    const current = stateRef.current;
    const found = runAudit(htmlForState(current));
    commit((value) => auditState(value,found.map((issue)=>issue.id),source));
    announce(`Audit complete. ${found.length} automatically detectable issues found.`);
    return summarizeAudit(found,stateRef.current.auditId);
  },[commit]);

  const doSafeFixes = useCallback((minimumConfidence=.9,source:'ui'|'agent'='ui') => {
    const before = stateRef.current;
    const unresolved = runAudit(htmlForState(before)).filter((issue)=>issue.decision==='safe-auto-fix' && issue.confidence>=minimumConfidence);
    const next = commit((value)=>applySafeState(value,unresolved.map((issue)=>issue.id),source));
    const afterIssues = runAudit(htmlForState(next));
    const applied = unresolved.filter((issue)=>!afterIssues.some((candidate)=>candidate.id===issue.id));
    announce(`${applied.length} safe, reversible fixes applied. ${afterIssues.length} issues remain.`);
    return {projectId:next.projectId,applied:applied.map((issue)=>({issueId:issue.id,title:issue.title,confidence:issue.confidence})),remainingIssues:afterIssues.length,score:calculateScore(afterIssues),humanReviewRemaining:afterIssues.filter((issue)=>issue.requiresHumanReview).length};
  },[commit]);

  const doSubmitContext = useCallback((issueId:string,context:string,source:'human'|'agent'='human') => {
    const issue = ISSUE_CATALOG.find((candidate)=>candidate.id===issueId);
    if (!issue?.requiresHumanReview) throw new Error('This issue does not accept human context.');
    commit((value)=>submitContextState(value,issueId,context,source));
    announce(`Context saved for ${issue.title}. A proposal is ready to review.`);
    return {issueId,status:'proposal-ready',context,proposalId:`proposal_${issueId}`};
  },[commit]);

  const doApplyIssue = useCallback((issueId:string,source:'human'|'agent'|'ui'='ui') => {
    const current = stateRef.current;
    const issue = ISSUE_CATALOG.find((candidate)=>candidate.id===issueId);
    if (!issue) throw new Error('Issue not found.');
    if (issue.requiresHumanReview && !current.humanContext[issueId]) throw new Error('Human context is required before this fix can be applied.');
    const after = current.humanContext[issueId] || issue.suggestedFix;
    const next = commit((value)=>applyIssueState(value,issue.id,issue.title,issue.elementHtml,after,issue.confidence,source));
    const remaining = runAudit(htmlForState(next));
    announce(`${issue.title} fixed. The change is available in history.`);
    return {changeId:next.changes.at(-1)?.id,issueId,status:'fixed',version:next.version,remainingIssues:remaining.length,score:calculateScore(remaining)};
  },[commit]);

  const doRevert = useCallback((changeId:string,source:'ui'|'agent'='ui') => {
    const next = commit((value)=>revertChangeState(value,changeId,source));
    const target = next.changes.find((change)=>change.id===changeId);
    const remaining = runAudit(htmlForState(next));
    announce(`${target?.reverted ? 'Reverted' : 'Restored'} ${target?.action ?? 'change'}.`);
    return {changeId,reverted:target?.reverted,version:next.version,remainingIssues:remaining.length,score:calculateScore(remaining)};
  },[commit]);

  const doVerify = useCallback((source:'ui'|'agent'='ui') => {
    const current = stateRef.current;
    const remaining = runAudit(htmlForState(current));
    const next = commit((value)=>verifyState(value,remaining.length,calculateScore(remaining),source));
    const severe = remaining.filter((issue)=>issue.severity==='critical'||issue.severity==='serious').length;
    announce(severe ? `Verification complete. ${severe} critical or serious issues still need attention.` : 'Verification complete. No critical or serious automatically detectable issues remain.');
    return {verifiedVersion:next.verifiedVersion,score:calculateScore(remaining),remainingIssues:remaining.length,criticalOrSerious:severe,manualReviewRecommended:true,statement:severe?'Critical or serious automatically detectable issues remain.':'No critical or serious automatically detectable issues remain in this tested version. Manual accessibility review is still recommended.'};
  },[commit]);

  const doPublish = useCallback((source:'ui'|'agent'='ui') => {
    const current = stateRef.current;
    const remaining = runAudit(htmlForState(current));
    if (current.verifiedVersion!==current.version) throw new Error('Verify the current version before publishing.');
    if (remaining.some((issue)=>issue.severity==='critical')) throw new Error('Resolve critical issues before publishing.');
    const next = commit((value)=>publishState(value,source));
    announce(`Accessible Web Twin version ${next.publishedVersion} published.`);
    return {status:'published',url:`/twin/${next.slug}`,version:next.publishedVersion,publishedAt:next.publishedAt};
  },[commit]);

  const api: WebMCPCommandApi = {
    getState:()=>stateRef.current,
    getProjectStatus:()=>{
      const current=stateRef.current;const issues=runAudit(htmlForState(current));
      return {projectId:current.projectId,name:current.projectName,status:current.publishedVersion?'published':current.verifiedVersion===current.version?'verified':current.changes.length?'remediating':current.audited?'audited':'draft',version:current.version,score:calculateScore(issues),openIssues:issues.length,humanReview:issues.filter((issue)=>issue.requiresHumanReview).length,verified:current.verifiedVersion===current.version,publishedVersion:current.publishedVersion};
    },
    audit:()=>doAudit('agent'),
    listIssues:(filters)=>viewsForState(stateRef.current).filter((issue)=>(!filters?.severity||filters.severity.includes(issue.severity))&&(!filters?.status||filters.status.includes(issue.status))&&(filters?.requiresHumanReview===undefined||issue.requiresHumanReview===filters.requiresHumanReview)),
    inspectIssue:(issueId)=>{const issue=viewsForState(stateRef.current).find((candidate)=>candidate.id===issueId);if(!issue)throw new Error('Issue not found.');return issue;},
    proposeFix:(issueId,humanContext)=>{const issue=ISSUE_CATALOG.find((candidate)=>candidate.id===issueId);if(!issue)throw new Error('Issue not found.');const context=humanContext||stateRef.current.humanContext[issueId];if(issue.requiresHumanReview&&!context)return {issueId,status:'human-context-required',question:issue.reviewQuestion,options:issue.reviewOptions};return {proposalId:`proposal_${issueId}`,issueId,before:issue.elementHtml,after:context||issue.suggestedFix,explanation:issue.suggestedFix,confidence:issue.confidence,requiresApproval:true};},
    applyFix:(proposalId)=>doApplyIssue(proposalId.replace(/^proposal_/,''),'agent'),
    applySafeFixes:(minimumConfidence)=>doSafeFixes(minimumConfidence,'agent'),
    submitHumanContext:(issueId,context)=>doSubmitContext(issueId,context,'agent'),
    getOutline:()=>({projectId:stateRef.current.projectId,original:getScreenReaderOutline(DEMO_HTML),current:getScreenReaderOutline(htmlForState(stateRef.current)),unresolvedIssues:runAudit(htmlForState(stateRef.current)).length}),
    testKeyboardFlow:()=>{const issues=runAudit(htmlForState(stateRef.current));const blocked=issues.some((issue)=>issue.id==='keyboard-cta');return {status:blocked?'failed':'passed',steps:[{order:1,target:'Open site menu',reachable:!issues.some((issue)=>issue.id==='menu-name')},{order:2,target:'Download report',reachable:!blocked},{order:3,target:'Email address',reachable:true},{order:4,target:'Receive monthly updates',reachable:true}],manualTestingRecommended:true};},
    compareVersions:()=>{const current=stateRef.current;const remaining=runAudit(htmlForState(current));return {projectId:current.projectId,original:{score:originalScore,issues:originalIssues.length},current:{score:calculateScore(remaining),issues:remaining.length},semanticChanges:current.changes.filter((change)=>!change.reverted).map((change)=>change.action),version:current.version};},
    revertFix:(changeId)=>doRevert(changeId,'agent'),
    verify:()=>doVerify('agent'),
    publish:()=>doPublish('agent'),
  };

  const webmcp = useWebMCP(api);

  const setScreen = (screen:Screen) => { commit((value)=>navigate(value,screen));setMobileNav(false); };
  const resetDemo = () => { commit(()=>resetState());announce('Demo reset to the original inaccessible report.'); };
  const selectedIssue = issueViews.find((issue)=>issue.id===state.selectedIssueId);
  const severityCounts = Object.fromEntries(severityOrder.map((severity)=>[severity,currentIssues.filter((issue)=>issue.severity===severity).length])) as Record<Severity,number>;

  return (
    <div className="workspace-shell">
      <a className="skip-link" href="#workspace-main">Skip to workspace content</a>
      <div className="sr-live" role="status" aria-live="polite" aria-atomic="true">{liveMessage}</div>
      <header className="workspace-topbar">
        <button className="mobile-nav-button" type="button" aria-label="Open workspace navigation" aria-expanded={mobileNav} onClick={()=>setMobileNav((open)=>!open)}><SlidersHorizontal size={18}/></button>
        <Link className="brand" href="/" aria-label="A11yRelay home"><span className="brand-mark" aria-hidden="true"><span/></span><span>A11yRelay</span></Link>
        <div className="project-crumb"><span>Project</span><strong>Arbor Creek Energy Report</strong><span className="version-chip">v{state.version}</span></div>
        <div className="topbar-actions">
          <div className={`agent-status ${webmcp.supported?'is-live':''}`} title={webmcp.supported?`${webmcp.registeredCount} tools registered in this browser`:'WebMCP requires an experimental supporting browser'}><Bot size={15}/><span>{webmcp.supported?`${webmcp.registeredCount} tools live`:'Tool layer ready'}</span><i/></div>
          <button className="quiet-button" type="button" onClick={resetDemo}><RefreshCcw size={14}/> Reset demo</button>
        </div>
      </header>

      <div className="workspace-grid">
        <aside className={`workspace-sidebar ${mobileNav?'is-open':''}`}>
          <nav aria-label="Workspace">
            <span className="nav-label">Workspace</span>
            {navItems.map(({screen,label,icon:Icon})=><button key={screen} type="button" className={state.screen===screen?'active':''} aria-current={state.screen===screen?'page':undefined} onClick={()=>setScreen(screen)}><Icon size={16}/><span>{label}</span>{screen==='issues'&&state.audited&&<b>{currentIssues.length}</b>}{screen==='review'&&state.audited&&<b className="amber-count">{currentIssues.filter((issue)=>issue.requiresHumanReview).length}</b>}</button>)}
          </nav>
          <div className="sidebar-project">
            <span className="city-emblem" aria-hidden="true">AC</span>
            <div><strong>City of Arbor Creek</strong><small>Demo project</small></div>
            <CheckCircle2 size={15}/>
          </div>
        </aside>

        <main id="workspace-main" className="workspace-main" tabIndex={-1}>
          {state.screen==='overview'&&<OverviewScreen state={state} score={score} originalScore={originalScore} issues={currentIssues} severityCounts={severityCounts} onAudit={()=>doAudit()} onSafeFix={()=>doSafeFixes()} onNavigate={setScreen} onInspect={(id)=>commit((value)=>({...value,selectedIssueId:id}))} currentHtml={currentHtml}/>} 
          {state.screen==='issues'&&<IssuesScreen audited={state.audited} issues={issueViews} filterOpen={filterOpen} setFilterOpen={setFilterOpen} onAudit={()=>doAudit()} onInspect={(id)=>commit((value)=>({...value,selectedIssueId:id}))} onApply={(id)=>doApplyIssue(id)} onIgnore={(id)=>commit((value)=>ignoreIssueState(value,id))} onNavigate={setScreen}/>} 
          {state.screen==='review'&&<ReviewScreen audited={state.audited} issues={issueViews.filter((issue)=>HUMAN_REVIEW_IDS.includes(issue.id))} contexts={state.humanContext} onSubmit={doSubmitContext} onApply={(id)=>doApplyIssue(id,'human')} onAudit={()=>doAudit()}/>} 
          {state.screen==='compare'&&<CompareScreen originalHtml={DEMO_HTML} currentHtml={currentHtml} originalIssues={originalIssues} currentIssues={currentIssues} changes={state.changes.filter((change)=>!change.reverted)}/>} 
          {state.screen==='reader'&&<ReaderScreen originalHtml={DEMO_HTML} currentHtml={currentHtml} unresolved={currentIssues.length}/>} 
          {state.screen==='history'&&<HistoryScreen changes={[...state.changes].reverse()} onRevert={doRevert}/>} 
          {state.screen==='publish'&&<PublishScreen state={state} score={score} issues={currentIssues} currentHtml={currentHtml} onVerify={()=>doVerify()} onPublish={()=>doPublish()} onSafeFix={()=>doSafeFixes()}/>} 
          {state.screen==='tools'&&<ToolsScreen supported={webmcp.supported} registered={webmcp.registeredCount} audited={state.audited} hasChanges={state.changes.length>0} verified={state.verifiedVersion===state.version}/>} 
        </main>

        <ActivityPanel activity={state.activity} supported={webmcp.supported} registered={webmcp.registeredCount}/>
      </div>

      {selectedIssue&&<IssueDialog issue={selectedIssue} context={state.humanContext[selectedIssue.id]} onClose={()=>commit((value)=>({...value,selectedIssueId:undefined}))} onApply={()=>doApplyIssue(selectedIssue.id)} onReview={()=>setScreen('review')}/>} 
    </div>
  );
}

function ScreenHeader({eyebrow,title,description,actions}:{eyebrow:string;title:string;description:string;actions?:React.ReactNode}) {
  return <header className="screen-header"><div><span className="screen-eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>{actions&&<div className="screen-actions">{actions}</div>}</header>;
}

function OverviewScreen({state,score,originalScore,issues,severityCounts,onAudit,onSafeFix,onNavigate,onInspect,currentHtml}:{state:ProjectState;score:number;originalScore:number;issues:AccessibilityIssue[];severityCounts:Record<Severity,number>;onAudit:()=>unknown;onSafeFix:()=>unknown;onNavigate:(screen:Screen)=>void;onInspect:(id:string)=>void;currentHtml:string}) {
  const fixed=ISSUE_CATALOG.length-issues.length;
  return <>
    <ScreenHeader eyebrow="Accessibility overview" title="City of Arbor Creek" description="2026 Community Energy Report · Built-in deterministic demo" actions={<><button className="button-secondary" type="button" onClick={()=>onNavigate('compare')}><Eye size={15}/> Compare</button><button className="button-primary" type="button" onClick={onAudit}><Zap size={15}/>{state.audited?'Run audit again':'Run accessibility audit'}</button></>}/>
    {!state.audited&&<div className="audit-ready-banner"><div className="banner-icon"><Accessibility size={22}/></div><div><strong>Intentionally inaccessible demo ready</strong><p>Audit the page to detect structure, forms, images, keyboard, ARIA, link, table, color, and language barriers.</p></div><button type="button" onClick={onAudit}>Start audit <ArrowRight size={14}/></button></div>}
    <section className="overview-grid" aria-label="Accessibility summary">
      <article className="score-panel"><div className="score-panel-top"><div><span>A11yRelay Accessibility Score</span><strong>{score}</strong><small>/ 100</small></div>{fixed>0&&<span className="score-delta"><ArrowUpRight size={13}/> +{score-originalScore}</span>}</div><div className="score-track" aria-hidden="true"><span style={{width:`${score}%`}}/></div><p>Internal remediation indicator based on detected issue severity. Not a certification of WCAG or legal compliance.</p></article>
      <article className="progress-panel"><span>Remediation progress</span><strong>{fixed}<small> / {ISSUE_CATALOG.length} resolved</small></strong><div className="progress-segments" aria-label={`${fixed} of ${ISSUE_CATALOG.length} issues resolved`}>{ISSUE_CATALOG.map((_,index)=><i className={index<fixed?'done':''} key={index}/>)}</div><p>{issues.filter((issue)=>issue.requiresHumanReview).length} decisions still need human context.</p></article>
    </section>
    <section className="stat-grid" aria-label="Issue severity">
      {severityOrder.map((severity)=><button type="button" key={severity} onClick={()=>onNavigate('issues')}><i className={`severity-dot ${severity}`}/><span>{severity}</span><strong>{state.audited?severityCounts[severity]:'—'}</strong><ChevronRight size={15}/></button>)}
    </section>
    <section className="dashboard-columns">
      <div className="dashboard-primary">
        <div className="card-heading"><div><span>Priority issues</span><small>{state.audited?`${issues.length} open in current version`:'Audit required'}</small></div><button type="button" onClick={()=>onNavigate('issues')}>View all <ArrowRight size={13}/></button></div>
        <div className="priority-list">{state.audited?issues.slice(0,4).map((issue)=><button type="button" key={issue.id} onClick={()=>onInspect(issue.id)}><span className={`issue-glyph ${issue.severity}`}><AlertTriangle size={14}/></span><div><strong>{issue.title}</strong><small>{issue.category} · WCAG {issue.wcagCriterion??'best practice'}</small></div>{issue.requiresHumanReview?<span className="status-chip review">Human review</span>:<span className="confidence-text">{Math.round(issue.confidence*100)}% confidence</span>}<ChevronRight size={16}/></button>):<div className="empty-card"><Search size={22}/><strong>No audit results yet</strong><p>Run the deterministic audit to populate this queue.</p></div>}</div>
      </div>
      <div className="quick-actions-card"><div className="card-heading"><div><span>Quick actions</span><small>Shared UI and tool commands</small></div></div><button type="button" onClick={onSafeFix} disabled={!state.audited||!issues.some((issue)=>issue.decision==='safe-auto-fix')}><span><WandSparkles size={17}/></span><div><strong>Apply safe fixes</strong><small>Only deterministic · reversible</small></div><ArrowRight size={15}/></button><button type="button" onClick={()=>onNavigate('review')} disabled={!state.audited}><span className="amber"><Sparkles size={17}/></span><div><strong>Review human decisions</strong><small>{issues.filter((issue)=>issue.requiresHumanReview).length} meaning-dependent items</small></div><ArrowRight size={15}/></button><button type="button" onClick={()=>onNavigate('reader')}><span className="blue"><BookOpenText size={17}/></span><div><strong>Screen Reader Outline</strong><small>Compare semantic reading order</small></div><ArrowRight size={15}/></button></div>
    </section>
    <section className="content-preview-card"><div className="card-heading"><div><span>Current content preview</span><small>Sandboxed · scripts disabled</small></div><span className="preview-state"><i/> Version {state.version}</span></div><iframe title="Current City of Arbor Creek report preview" sandbox="" srcDoc={currentHtml}/></section>
  </>;
}

function IssuesScreen({audited,issues,filterOpen,setFilterOpen,onAudit,onInspect,onApply,onIgnore,onNavigate}:{audited:boolean;issues:IssueView[];filterOpen:boolean;setFilterOpen:(open:boolean)=>void;onAudit:()=>unknown;onInspect:(id:string)=>void;onApply:(id:string)=>unknown;onIgnore:(id:string)=>void;onNavigate:(screen:Screen)=>void}) {
  const [query,setQuery]=useState('');const [severity,setSeverity]=useState<string>('all');const [status,setStatus]=useState<string>('unresolved');
  const filtered=issues.filter((issue)=>(issue.title+' '+issue.category+' '+issue.ruleId).toLowerCase().includes(query.toLowerCase())&&(severity==='all'||issue.severity===severity)&&(status==='all'||status==='unresolved'&&!['fixed','ignored'].includes(issue.status)||issue.status===status));
  return <><ScreenHeader eyebrow="Issue workspace" title="Accessibility issues" description="Automated checks, agent proposals, and human decisions—clearly separated." actions={<button className="button-primary" type="button" onClick={onAudit}><Zap size={15}/>{audited?'Re-run audit':'Run audit'}</button>}/>
    {!audited?<EmptyState icon={ListChecks} title="Audit results will appear here" text="Run the accessibility audit to create a structured, actionable issue queue." action="Run accessibility audit" onAction={onAudit}/>:<>
      <div className="issue-toolbar"><label className="search-field"><Search size={15}/><span className="sr-only">Search issues</span><input value={query} onChange={(event)=>setQuery(event.target.value)} placeholder="Search issues, rules, categories…"/></label><button type="button" className={filterOpen?'active':''} onClick={()=>setFilterOpen(!filterOpen)}><Filter size={15}/> Filters</button><span>{filtered.length} results</span></div>
      {filterOpen&&<div className="filter-row"><label>Severity<select value={severity} onChange={(event)=>setSeverity(event.target.value)}><option value="all">All severities</option>{severityOrder.map((value)=><option key={value}>{value}</option>)}</select></label><label>Status<select value={status} onChange={(event)=>setStatus(event.target.value)}><option value="unresolved">Unresolved</option><option value="all">All statuses</option><option value="open">Open</option><option value="needs-review">Needs review</option><option value="proposed">Proposed</option><option value="fixed">Fixed</option><option value="ignored">Ignored</option></select></label></div>}
      <div className="issues-table" role="region" aria-label="Accessibility issue list" tabIndex={0}><div className="issue-row issue-table-head"><span>Issue</span><span>Severity</span><span>Decision</span><span>Status</span><span><span className="sr-only">Actions</span></span></div>{filtered.map((issue)=><article className={`issue-row ${issue.status==='fixed'?'is-fixed':''}`} key={issue.id}><button className="issue-title-cell" type="button" onClick={()=>onInspect(issue.id)}><span className={`issue-glyph ${issue.severity}`}>{issue.status==='fixed'?<Check size={14}/>:<AlertTriangle size={14}/>}</span><div><strong>{issue.title}</strong><small><code>{issue.ruleId}</code> · WCAG {issue.wcagCriterion??'Best practice'}</small></div></button><span className={`severity-label ${issue.severity}`}><i/>{issue.severity}</span><span className="decision-label">{issue.decision==='safe-auto-fix'?<><ShieldCheck size={14}/> Safe fix</>:issue.requiresHumanReview?<><Sparkles size={14}/> Human</>:<><Bot size={14}/> Proposal</>}</span><span className={`status-chip ${issue.status==='needs-review'?'review':issue.status}`}>{issue.status.replace('-',' ')}</span><div className="row-actions"><button type="button" onClick={()=>onInspect(issue.id)}>Inspect</button>{issue.status!=='fixed'&&issue.decision==='safe-auto-fix'&&<button className="accent" type="button" onClick={()=>onApply(issue.id)}>Apply</button>}{issue.requiresHumanReview&&issue.status!=='fixed'&&<button className="accent" type="button" onClick={()=>onNavigate('review')}>Review</button>}{!['fixed','ignored'].includes(issue.status)&&<button type="button" onClick={()=>onIgnore(issue.id)} aria-label={`Ignore ${issue.title}`}><X size={14}/></button>}</div></article>)}</div>
    </>}
  </>;
}

function ReviewScreen({audited,issues,contexts,onSubmit,onApply,onAudit}:{audited:boolean;issues:IssueView[];contexts:Record<string,string>;onSubmit:(id:string,context:string)=>unknown;onApply:(id:string)=>unknown;onAudit:()=>unknown}) {
  const [drafts,setDrafts]=useState<Record<string,string>>({});
  if(!audited)return <><ScreenHeader eyebrow="Human review" title="Meaning needs a human" description="Agents identify ambiguity. You provide the context that makes remediation accurate."/><EmptyState icon={Sparkles} title="Audit before reviewing decisions" text="Human-review items are created only when the audit finds a meaning-dependent barrier." action="Run audit" onAction={onAudit}/></>;
  const unresolved=issues.filter((issue)=>issue.status!=='fixed'&&issue.status!=='ignored');
  return <><ScreenHeader eyebrow="Human review" title={`${unresolved.length} decisions need context`} description="Nothing on this screen is auto-applied. Review, edit, and approve every meaning-dependent change."/>
    <div className="review-stack">{issues.map((issue,index)=>{const saved=contexts[issue.id];const draft=drafts[issue.id]??saved??'';return <article className={`review-card ${issue.status==='fixed'?'is-complete':''}`} key={issue.id}><div className="review-card-index"><span>{String(index+1).padStart(2,'0')}</span>{issue.status==='fixed'?<CheckCircle2 size={18}/>:<Sparkles size={18}/>}</div><div className="review-evidence">{issue.id==='chart-alt'?<MiniChart/>:<div className="element-preview"><code>{issue.elementHtml}</code></div>}<span>Evidence preview</span></div><div className="review-content"><div className="review-meta"><span className={`severity-label ${issue.severity}`}><i/>{issue.severity}</span><span>WCAG {issue.wcagCriterion}</span><span>{Math.round(issue.confidence*100)}% agent confidence</span></div><h2>{issue.title}</h2><p>{issue.explanation}</p>{issue.status==='fixed'?<div className="approved-answer"><CheckCircle2 size={17}/><div><span>Approved description</span><strong>{saved}</strong></div></div>:<><fieldset><legend>{issue.reviewQuestion}</legend>{issue.reviewOptions?.map((option)=><label key={option}><input type="radio" name={`choice-${issue.id}`} checked={draft===option} onChange={()=>setDrafts((value)=>({...value,[issue.id]:option}))}/><span>{option}</span></label>)}</fieldset><label className="context-field"><span>Your context</span><textarea value={draft} onChange={(event)=>setDrafts((value)=>({...value,[issue.id]:event.target.value}))} placeholder="Describe the intended meaning…"/></label>{saved?<div className="proposal-box"><span><Bot size={14}/> Agent proposal</span><p>{saved}</p><div><button type="button" onClick={()=>onApply(issue.id)}><Check size={14}/> Approve & apply</button><button type="button" onClick={()=>setDrafts((value)=>({...value,[issue.id]:saved}))}>Edit</button></div></div>:<button className="button-primary review-submit" type="button" disabled={draft.trim().length<3} onClick={()=>onSubmit(issue.id,draft.trim())}><Send size={14}/> Submit context</button>}</>}</div></article>})}</div>
  </>;
}

function MiniChart(){return <div className="mini-chart" role="img" aria-label="Preview of four bars trending downward overall"><i/><i/><i/><i/><span>2023</span><span>2024</span><span>2025</span><span>2026</span></div>}

function CompareScreen({originalHtml,currentHtml,originalIssues,currentIssues,changes}:{originalHtml:string;currentHtml:string;originalIssues:AccessibilityIssue[];currentIssues:AccessibilityIssue[];changes:ProjectState['changes']}) {
  const [mode,setMode]=useState<'rendered'|'html'|'semantic'>('rendered');const before=calculateScore(originalIssues),after=calculateScore(currentIssues);
  return <><ScreenHeader eyebrow="Version comparison" title="Original vs. remediated" description="Inspect what changed visually, structurally, and semantically—without hiding unresolved work."/>
    <section className="compare-metrics"><div><span>Accessibility score</span><strong>{before} <ArrowRight size={16}/> <b>{after}</b></strong></div>{severityOrder.slice(0,3).map((severity)=><div key={severity}><span>{severity}</span><strong>{originalIssues.filter((i)=>i.severity===severity).length} <ArrowRight size={14}/> <b>{currentIssues.filter((i)=>i.severity===severity).length}</b></strong></div>)}<div><span>Changed elements</span><strong><b>{changes.reduce((n,c)=>n+c.issueIds.length,0)}</b></strong></div></section>
    <div className="segmented-control" role="tablist" aria-label="Comparison mode">{(['rendered','html','semantic'] as const).map((value)=><button role="tab" aria-selected={mode===value} type="button" key={value} onClick={()=>setMode(value)}>{value==='rendered'?<MonitorUp size={14}/>:value==='html'?<Code2 size={14}/>:<Layers3 size={14}/>} {value}</button>)}</div>
    {mode==='rendered'&&<div className="rendered-compare"><PreviewPane label="Original" detail={`${originalIssues.length} issues · score ${before}`} html={originalHtml}/><PreviewPane label="Remediated" detail={`${currentIssues.length} issues · score ${after}`} html={currentHtml} current/></div>}
    {mode==='html'&&<div className="code-compare"><CodePane title="Original source" html={originalHtml}/><CodePane title="Current source" html={currentHtml} current/></div>}
    {mode==='semantic'&&<OutlineCompare originalHtml={originalHtml} currentHtml={currentHtml}/>} 
    <div className="change-summary"><div className="card-heading"><div><span>Semantic changes</span><small>{changes.length} reversible records in this version</small></div></div>{changes.length?changes.map((change)=><div key={change.id}><CheckCircle2 size={15}/><span>{change.action}</span><code>{change.issueIds.join(', ')}</code></div>):<p>No remediation changes have been applied yet.</p>}</div>
  </>;
}

function PreviewPane({label,detail,html,current=false}:{label:string;detail:string;html:string;current?:boolean}){return <section><header><div><span>{label}</span><small>{detail}</small></div>{current&&<span className="verified-chip"><Check size={12}/> Current</span>}</header><iframe title={`${label} report preview`} sandbox="" srcDoc={html}/></section>}
function CodePane({title,html,current=false}:{title:string;html:string;current?:boolean}){const lines=html.split('\n').slice(0,75);return <section><header><span>{title}</span><small>{current?'Inserted and changed lines highlighted':'Baseline source'}</small></header><pre>{lines.map((line,index)=><code className={current&&/(lang=|<main|aria-|<label|<th|<h1|<h2)/.test(line)?'changed':''} key={index}><span>{String(index+1).padStart(2,'0')}</span>{line}{'\n'}</code>)}</pre></section>}

function ReaderScreen({originalHtml,currentHtml,unresolved}:{originalHtml:string;currentHtml:string;unresolved:number}){return <><ScreenHeader eyebrow="Screen Reader Outline" title="See the page without seeing it" description="A simplified accessibility tree reveals the order, hierarchy, names, and landmarks assistive technology encounters."/><div className="reader-callout"><BookOpenText size={19}/><div><strong>Semantic comparison, not a screen reader replacement</strong><p>This outline helps spot structural changes. Test with real assistive technology before publishing.</p></div><span>{unresolved} unresolved</span></div><OutlineCompare originalHtml={originalHtml} currentHtml={currentHtml}/></>}

function OutlineCompare({originalHtml,currentHtml}:{originalHtml:string;currentHtml:string}){return <div className="outline-compare"><OutlinePane title="Before remediation" subtitle="Fragmented structure" items={getScreenReaderOutline(originalHtml)}/><div className="outline-relay" aria-hidden="true"><span><ArrowRight size={18}/></span></div><OutlinePane title="After remediation" subtitle="Current semantic outline" items={getScreenReaderOutline(currentHtml)} current/></div>}
function OutlinePane({title,subtitle,items,current=false}:{title:string;subtitle:string;items:ReturnType<typeof getScreenReaderOutline>;current?:boolean}){return <section className={current?'current':''}><header><div><span>{title}</span><small>{subtitle}</small></div>{current&&<CheckCircle2 size={17}/>}</header><div className="outline-list">{items.slice(0,28).map((item)=><div key={item.id} className={`outline-item ${item.kind}`} style={{paddingLeft:`${14+item.depth*16}px`}}><i/>{item.label}</div>)}</div></section>}

function HistoryScreen({changes,onRevert}:{changes:ProjectState['changes'];onRevert:(id:string)=>unknown}){return <><ScreenHeader eyebrow="Change history" title="Every fix has an undo" description="A transparent, reversible record of changes from humans, agents, and the visual workspace."/>{changes.length?<div className="history-list">{changes.map((change)=><article key={change.id} className={change.reverted?'is-reverted':''}><span className="history-marker">{change.reverted?<RotateCcw size={15}/>:<Check size={15}/>}</span><div className="history-copy"><div><strong>{change.action}</strong><span className={`source-chip ${change.source}`}>{change.source}</span>{change.confidence&&<span>{Math.round(change.confidence*100)}% confidence</span>}</div><p>{change.before} <ArrowRight size={12}/> {change.after}</p><small><Clock3 size={12}/>{new Date(change.timestamp).toLocaleString()} · {change.issueIds.length} issue{change.issueIds.length===1?'':'s'}</small></div><button type="button" onClick={()=>onRevert(change.id)}>{change.reverted?<><RefreshCcw size={14}/> Restore</>:<><RotateCcw size={14}/> Revert</>}</button></article>)}</div>:<EmptyState icon={History} title="No changes yet" text="Safe fixes, approved proposals, and reverts will appear here as real change records."/>}</>}

function PublishScreen({state,score,issues,currentHtml,onVerify,onPublish,onSafeFix}:{state:ProjectState;score:number;issues:AccessibilityIssue[];currentHtml:string;onVerify:()=>unknown;onPublish:()=>unknown;onSafeFix:()=>unknown}){const verified=state.verifiedVersion===state.version;const critical=issues.filter((issue)=>issue.severity==='critical').length;return <><ScreenHeader eyebrow="Accessible Web Twin" title="Publish a better way to read it" description="Create a semantic, web-native companion while preserving the original source."/>
  <div className="twin-pipeline" aria-label="Accessible Web Twin publishing workflow"><div><Globe2 size={19}/><span>Original content</span><small>Imported source</small></div><ArrowRight size={18}/><div><WandSparkles size={19}/><span>Remediation</span><small>{state.changes.filter((c)=>!c.reverted).length} active changes</small></div><ArrowRight size={18}/><div className="active"><Accessibility size={19}/><span>Accessible Web Twin</span><small>{state.publishedVersion?`Published v${state.publishedVersion}`:'Ready after verification'}</small></div></div>
  <section className="publish-layout"><div className="publish-preview"><div className="card-heading"><div><span>Twin preview</span><small>Semantic HTML · current version {state.version}</small></div><span className="score-mini">Score {score}</span></div><iframe title="Accessible Web Twin preview" sandbox="" srcDoc={currentHtml}/></div><aside className="publish-checklist"><span className="screen-eyebrow">Publish readiness</span><h2>{state.publishedVersion?'Accessible Web Twin published':verified?'Verified and ready to publish':'Verify the current version'}</h2><ul><li className={critical===0?'done':''}>{critical===0?<CheckCircle2/>:<CircleAlert/>}<div><strong>No critical issues</strong><small>{critical===0?'Publishing gate passed':`${critical} critical issues remain`}</small></div></li><li className={verified?'done':''}>{verified?<CheckCircle2/>:<CircleAlert/>}<div><strong>Current version verified</strong><small>{verified?`Version ${state.version} checked`:'Re-run checks after every change'}</small></div></li><li><Info/><div><strong>Manual review recommended</strong><small>{issues.filter((issue)=>issue.requiresHumanReview).length} meaning-dependent issues remain visible</small></div></li></ul>{critical>0?<button className="button-primary" type="button" onClick={onSafeFix}><WandSparkles size={15}/> Apply safe fixes</button>:!verified?<button className="button-primary" type="button" onClick={onVerify}><FileCheck2 size={15}/> Verify current version</button>:<button className="button-primary" type="button" onClick={onPublish}><Globe2 size={15}/> {state.publishedVersion?'Publish new version':'Publish Accessible Web Twin'}</button>}{state.publishedVersion&&<a className="button-secondary twin-link" href={`/twin/${state.slug}`} target="_blank">Open published twin <ArrowUpRight size={14}/></a>}<p className="disclaimer">A11yRelay assists with remediation but does not guarantee WCAG conformance, ADA compliance, or legal compliance.</p></aside></section>
  </>}

const toolDefinitions=[
  ['audit_content','Run checks without modifying content','read'],['list_issues','Filter the shared issue queue','read'],['inspect_issue','Inspect DOM context and guidance','read'],['propose_fix','Create a reversible proposal','read'],['apply_fix','Apply one approved proposal','write'],['apply_safe_fixes','Apply deterministic fixes only','write'],['submit_human_context','Add meaning from a human','write'],['get_screen_reader_outline','Read semantic before / after','read'],['test_keyboard_flow','Check deterministic focus flow','read'],['compare_versions','Compare source and semantics','read'],['revert_fix','Restore previous shared state','write'],['verify_content','Re-run checks on current version','read'],['publish_accessible_version','Publish verified twin snapshot','write'],['get_project_status','Read score, counts, and version','read'],
] as const;

function ToolsScreen({supported,registered,audited,hasChanges,verified}:{supported:boolean;registered:number;audited:boolean;hasChanges:boolean;verified:boolean}){return <><ScreenHeader eyebrow="Agent interface" title="Purpose-built WebMCP tools" description="Narrow, state-aware commands give external agents safe access to the same project state humans see."/><div className={`webmcp-status-card ${supported?'supported':''}`}><div><Bot size={24}/></div><div><strong>{supported?`${registered} tools registered in document.modelContext`:'Tool contracts ready · browser API unavailable'}</strong><p>{supported?'This experimental browser supports the current WebMCP draft. Tool registration follows workspace state.':'Use a current WebMCP-capable browser to expose tools. Every workflow remains available through the human UI.'}</p></div><span><i/>{supported?'Live':'Progressive enhancement'}</span></div><div className="tool-stage"><span>State-aware availability</span><div><b className="done"><Check/> Project loaded</b><i/><b className={audited?'done':''}>{audited&&<Check/>} Audited</b><i/><b className={hasChanges?'done':''}>{hasChanges&&<Check/>} Changes applied</b><i/><b className={verified?'done':''}>{verified&&<Check/>} Verified</b></div></div><div className="tools-grid">{toolDefinitions.map(([name,description,kind])=><article key={name}><span className={`tool-kind ${kind}`}>{kind}</span><Code2 size={17}/><code>{name}</code><p>{description}</p><small>{kind==='read'?<><Eye size={12}/> readOnlyHint: true</>:<><ShieldCheck size={12}/> reversible mutation</>}</small></article>)}</div><section className="security-card"><ShieldCheck size={21}/><div><strong>Untrusted content stays content</strong><p>Imported HTML never changes tool instructions. Inputs are validated again at execution, content-bearing responses are marked <code>untrustedContentHint</code>, and mutation gates are enforced in application state.</p></div></section></>}

function ActivityPanel({activity,supported,registered}:{activity:ProjectState['activity'];supported:boolean;registered:number}){return <aside className="activity-sidebar" aria-label="Agent activity"><header><div><Activity size={15}/><span>Agent activity</span></div><span className={supported?'live':''}><i/>{supported?'Live':'Ready'}</span></header><div className="activity-feed">{activity.slice(0,8).map((item,index)=><div className="activity-item" key={item.id}><span className={`activity-icon ${item.kind}`}>{item.kind==='write'?<Zap/>:item.kind==='human'?<Sparkles/>:item.kind==='read'?<Eye/>:<Check/>}</span><div><code>{item.tool}</code><p>{item.summary}</p><time>{index===0?'just now':new Date(item.timestamp).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}</time></div></div>)}</div><footer><Code2 size={14}/><span>{supported?`${registered} tools registered`:'14 tool contracts ready'}</span><ChevronRight size={14}/></footer></aside>}

function IssueDialog({issue,context,onClose,onApply,onReview}:{issue:IssueView;context?:string;onClose:()=>void;onApply:()=>unknown;onReview:()=>void}){useEffect(()=>{const handler=(event:KeyboardEvent)=>{if(event.key==='Escape')onClose()};window.addEventListener('keydown',handler);return()=>window.removeEventListener('keydown',handler)},[onClose]);return <div className="dialog-backdrop" role="presentation" onMouseDown={(event)=>{if(event.target===event.currentTarget)onClose()}}><section className="issue-dialog" role="dialog" aria-modal="true" aria-labelledby="issue-dialog-title"><header><div><span className={`severity-label ${issue.severity}`}><i/>{issue.severity}</span><span className={`status-chip ${issue.status==='needs-review'?'review':issue.status}`}>{issue.status.replace('-',' ')}</span></div><button type="button" onClick={onClose} aria-label="Close issue details"><X size={18}/></button></header><div className="dialog-body"><span className="screen-eyebrow">{issue.ruleId} · WCAG {issue.wcagCriterion??'Best practice'} {issue.wcagLevel}</span><h2 id="issue-dialog-title">{issue.title}</h2><p className="dialog-lede">{issue.description}</p><div className="detail-section"><span>Affected element</span><code>{issue.elementHtml}</code></div><div className="detail-section"><span>Why it matters</span><p>{issue.explanation}</p></div><div className="detail-section recommendation"><span>Recommended remediation</span><p>{issue.suggestedFix}</p></div><div className="confidence-row"><span>Agent confidence</span><div><i><b style={{width:`${issue.confidence*100}%`}}/></i><strong>{Math.round(issue.confidence*100)}%</strong></div></div>{context&&<div className="detail-section human-context"><span>Human context</span><p>{context}</p></div>}</div><footer><button className="button-secondary" type="button" onClick={onClose}>Close</button>{issue.requiresHumanReview&&issue.status!=='fixed'?<button className="button-primary" type="button" onClick={onReview}><Sparkles size={14}/> Open human review</button>:issue.status!=='fixed'&&<button className="button-primary" type="button" onClick={onApply}><WandSparkles size={14}/> Apply reversible fix</button>}</footer></section></div>}

function EmptyState({icon:Icon,title,text,action,onAction}:{icon:LucideIcon;title:string;text:string;action?:string;onAction?:()=>unknown}){return <div className="large-empty"><span><Icon size={24}/></span><strong>{title}</strong><p>{text}</p>{action&&onAction&&<button className="button-primary" type="button" onClick={onAction}>{action} <ArrowRight size={14}/></button>}</div>}
