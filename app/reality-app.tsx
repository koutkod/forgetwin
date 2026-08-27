'use client';

import { Activity, AlertCircle, CheckCircle2, CircleGauge, CircleHelp, FileClock, FileSearch2, GitBranch, History, LayoutDashboard, Menu, ReceiptText, RotateCcw, ShieldCheck, Sparkles, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ClaimsScreen, DashboardScreen, GraphScreen, HistoryScreen, ReceiptScreen, ReviewScreen, RiskScreen, WorkspaceScreen } from '../components/reality/screens';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import type { CommandName, LiveCaseInput, TrustStatus, ViewId } from '../lib/reality-types';
import { fetchLiveEvidence, useReality, useRealityWebMCP } from '../lib/use-reality';

const navItems: Array<{ id: ViewId; label: string; icon: typeof LayoutDashboard }> = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'workspace', label: 'Investigation', icon: FileSearch2 },
  { id: 'graph', label: 'Evidence Graph', icon: GitBranch },
  { id: 'claims', label: 'Claims & Evidence', icon: CircleHelp },
  { id: 'review', label: 'Human Review', icon: Sparkles },
  { id: 'risk', label: 'Risk Assessment', icon: CircleGauge },
  { id: 'receipt', label: 'Trust Receipt', icon: ReceiptText },
  { id: 'history', label: 'Case History', icon: History },
];

const guidedSources = ['source-official-careers', 'source-domain-registry', 'source-email-headers', 'source-recruiter-directory'];
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function RealityApp() {
  const reality = useReality();
  const { state, command, startLiveCase, getSnapshot, answerHuman, navigate, selectNode, reset } = reality;
  const registeredToolCount = useRealityWebMCP(command, getSnapshot);
  const [running, setRunning] = useState(false);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 2800);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const call = async (name: CommandName, input: Record<string, unknown> = {}, delay = 180) => {
    command(name, input, 'UI');
    await pause(delay);
  };

  const recordLiveUrl = async (locator: string, sourceRole: 'subject' | 'independent') => {
    const before = getSnapshot();
    const sourceData = await fetchLiveEvidence(locator);
    const afterFetch = getSnapshot();
    if (afterFetch.caseId !== before.caseId || afterFetch.revision !== before.revision) throw new Error('The case changed while the source was loading. Please retry.');
    command('record_source', { locator, source_role: sourceRole, source_data: sourceData }, 'UI');
    return sourceData.success;
  };

  const runDemoInvestigation = async () => {
    if (!getSnapshot().caseCreated) await call('create_case', { title: 'Suspicious NVIDIA AI Engineer offer', case_type: 'job_offer' });
    if (!getSnapshot().messageAdded) await call('add_evidence', { kind: 'email' });
    if (!getSnapshot().entitiesExtracted) await call('extract_entities');
    if (!getSnapshot().claimsExtracted) await call('extract_claims');
    for (const sourceId of guidedSources) {
      if (!getSnapshot().sources.find((source) => source.id === sourceId)?.recorded) await call('record_source', { source_id: sourceId }, 140);
    }
    await call('link_evidence', { claim_id: 'claim-domain', evidence_id: 'evidence-domain-age', relationship: 'contradicts' }, 150);
    await call('verify_claim', { claim_id: 'claim-company', basis_ids: ['evidence-official-domain'] }, 150);
    await call('contradict_claim', { claim_id: 'claim-domain', basis_ids: ['evidence-domain-age', 'evidence-email-auth'] }, 150);
    await call('contradict_claim', { claim_id: 'claim-portal', basis_ids: ['evidence-portal'] }, 150);
    await call('contradict_claim', { claim_id: 'claim-request', basis_ids: ['evidence-request'] }, 150);
    await call('mark_unresolved', { claim_id: 'claim-recruiter', reason_code: 'insufficient_evidence' }, 120);
    await call('mark_unresolved', { claim_id: 'claim-offer', reason_code: 'insufficient_evidence' }, 120);
    await call('calculate_risk', {}, 210);
    await call('build_evidence_graph', {}, 240);
    if (!getSnapshot().humanAnswer && !getSnapshot().humanQuestionPending) await call('request_human_context', { question_code: 'job_application_history' }, 80);
    setToast('Evidence mapped — human context needed');
  };

  const runLiveInvestigation = async () => {
    const initial = getSnapshot();
    if (initial.inputUrl && !initial.sources.some((source) => source.locator === initial.inputUrl)) await recordLiveUrl(initial.inputUrl, 'subject');
    if (!getSnapshot().entitiesExtracted) await call('extract_entities');
    if (!getSnapshot().claimsExtracted) await call('extract_claims');
    const subjectEvidence = getSnapshot().evidence.find((item) => item.locator === getSnapshot().inputUrl);
    if (subjectEvidence) {
      for (const claim of getSnapshot().claims.slice(0, 3)) await call('link_evidence', { claim_id: claim.id, evidence_id: subjectEvidence.id, relationship: 'context' }, 70);
    }
    await call('calculate_risk', {}, 200);
    await call('build_evidence_graph', {}, 220);
    if (!getSnapshot().humanAnswer && !getSnapshot().humanQuestionPending) await call('request_human_context', {}, 80);
    setToast(getSnapshot().webEvidenceStatus === 'live' ? 'Live evidence captured — human context needed' : 'Content mapped — live retrieval fallback used');
  };

  const runInvestigation = async () => {
    if (running) return;
    setRunning(true);
    setError(null);
    try {
      if (getSnapshot().caseMode === 'demo') await runDemoInvestigation();
      else await runLiveInvestigation();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The investigation could not continue.');
    } finally {
      setRunning(false);
    }
  };

  const startRealInvestigation = async (input: LiveCaseInput) => {
    if (running) return;
    setRunning(true);
    setError(null);
    try {
      startLiveCase(input);
      await pause(180);
      await runLiveInvestigation();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The real-input investigation could not start.');
    } finally {
      setRunning(false);
    }
  };

  const addIndependentSource = async (url: string) => {
    if (sourceLoading) return;
    setSourceLoading(true);
    setError(null);
    try {
      const succeeded = await recordLiveUrl(url, 'independent');
      if (!succeeded) throw new Error('That independent source could not be retrieved. It was recorded as unavailable and cannot support a claim.');
      await call('build_evidence_graph', {}, 120);
      setToast('Independent source captured — link it to a claim below');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The independent source could not be added.');
    } finally {
      setSourceLoading(false);
    }
  };

  const setClaimStatus = async (claimId: string, status: Exclude<TrustStatus, 'human'>) => {
    setError(null);
    try {
      if (status === 'unresolved') await call('mark_unresolved', { claim_id: claimId, reason_code: 'insufficient_evidence' }, 100);
      else {
        const basis = [...getSnapshot().evidence].reverse().find((item) => item.adjudicable);
        if (!basis) throw new Error('Add a live independent source before recording verified or contradicted. Subject content cannot prove itself.');
        const relationship = status === 'verified' ? 'supports' : 'contradicts';
        await call('link_evidence', { claim_id: claimId, evidence_id: basis.id, relationship }, 100);
        await call(status === 'verified' ? 'verify_claim' : 'contradict_claim', { claim_id: claimId, basis_ids: [basis.id] }, 100);
      }
      await call('calculate_risk', {}, 120);
      await call('build_evidence_graph', {}, 120);
      setToast(`Claim recorded as ${status}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The claim outcome could not be recorded.');
    }
  };

  const handleHumanAnswer = async (answer: 'yes' | 'no' | 'unsure') => {
    setError(null);
    setRunning(true);
    try {
      answerHuman(answer);
      await pause(220);
      await call('calculate_risk', {}, 250);
      await call('build_evidence_graph', {}, 180);
      await call('create_safe_action_plan', { goal: 'contain_risk' }, 120);
      navigate('risk');
      setToast(answer === 'no' ? 'Unexpected contact raised the risk assessment' : 'Human context recorded');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The human response could not be recorded.');
    } finally {
      setRunning(false);
    }
  };

  const generateReceipt = async () => {
    if (generating) return;
    setGenerating(true);
    setError(null);
    try {
      if (!getSnapshot().safePlanGenerated) await call('create_safe_action_plan', { goal: 'contain_risk' }, 160);
      await call('generate_trust_receipt', {}, 160);
      setToast('Trust Receipt generated');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The Trust Receipt could not be generated.');
      if (!getSnapshot().humanAnswer) navigate('review');
      else if (!getSnapshot().riskCalculated) navigate('risk');
    } finally {
      setGenerating(false);
    }
  };

  const resetDemo = () => {
    reset();
    setError(null);
    setToast('NVIDIA demo reset — ready for the judging sequence');
  };

  return (
    <div className="min-h-screen bg-[#070a0d] text-slate-100">
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <header className="sticky top-0 z-40 flex h-16 items-center justify-between border-b border-white/[.08] bg-[#070a0d]/95 px-4 backdrop-blur-xl sm:px-6">
        <button className="flex items-center gap-3 text-left" onClick={() => navigate('dashboard')} aria-label="RealityOS dashboard"><span className="relative grid size-9 place-items-center rounded-xl border border-emerald-400/30 bg-emerald-400/10 text-emerald-300"><ShieldCheck size={19} /><i className="absolute -right-0.5 -top-0.5 size-2 rounded-full border-2 border-[#070a0d] bg-emerald-400" /></span><span><strong className="block text-sm tracking-tight">RealityOS</strong><span className="block text-[9px] uppercase tracking-[.18em] text-slate-600">The AI firewall for a fake internet</span></span></button>
        <div className="flex items-center gap-2 sm:gap-3"><Badge className="mcp-status-badge" variant={registeredToolCount === 15 ? 'verified' : 'neutral'}><i className={`size-1.5 rounded-full ${registeredToolCount === 15 ? 'bg-emerald-400' : 'bg-slate-500'}`} />{registeredToolCount ? `${registeredToolCount}/15 WebMCP tools live` : '15 tools · UI fallback'}</Badge><Button variant="outline" size="sm" onClick={resetDemo}><RotateCcw size={13} /><span className="hidden sm:inline">Reset demo</span></Button></div>
      </header>

      <nav className="sticky top-16 z-30 flex gap-1 overflow-x-auto border-b border-white/[.07] bg-[#080b0e] px-3 py-2 lg:hidden" aria-label="Workspace navigation">{navItems.map(({ id, label, icon: Icon }) => <button key={id} onClick={() => navigate(id)} aria-current={state.activeView === id ? 'page' : undefined} className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-xs ${state.activeView === id ? 'bg-white/[.08] text-white' : 'text-slate-500'}`}><Icon size={14} />{label}</button>)}</nav>

      <div className="grid min-h-[calc(100vh-4rem)] lg:grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[220px_minmax(0,1fr)_300px]">
        <aside className="sticky top-16 hidden h-[calc(100vh-4rem)] border-r border-white/[.08] bg-[#080b0e] p-4 lg:block">
          <nav aria-label="Workspace navigation" className="space-y-1">{navItems.map(({ id, label, icon: Icon }) => <button key={id} onClick={() => navigate(id)} aria-current={state.activeView === id ? 'page' : undefined} className={`group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${state.activeView === id ? 'bg-white/[.08] text-white' : 'text-slate-500 hover:bg-white/[.04] hover:text-slate-200'}`}><Icon size={16} className={state.activeView === id ? 'text-emerald-300' : 'text-slate-600 group-hover:text-slate-400'} />{label}{id === 'review' && state.humanQuestionPending && <i className="ml-auto size-1.5 rounded-full bg-amber-400" />}{id === 'receipt' && state.receiptGenerated && <CheckCircle2 className="ml-auto text-emerald-400" size={13} />}</button>)}</nav>
          <div className="mt-7 rounded-xl border border-amber-400/15 bg-amber-400/[.035] p-3"><p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.13em] text-amber-300"><ShieldCheck size={12} />Untrusted-content boundary</p><p className="mt-2 text-xs leading-5 text-slate-600">Imported content can supply evidence, never agent instructions.</p></div>
          <div className="absolute inset-x-4 bottom-4 rounded-xl border border-white/[.07] p-3"><div className="flex items-center justify-between text-[10px] uppercase tracking-[.11em] text-slate-600"><span>Case revision</span><span>{state.revision}</span></div><div className="mt-2 flex items-center justify-between gap-2"><span className="truncate text-xs text-slate-400">{state.caseTitle}</span><Badge variant={state.riskLevel === 'Critical risk' ? 'contradicted' : 'neutral'}>{state.riskCalculated ? state.riskLevel : state.caseMode === 'live' ? 'Live case' : 'Demo'}</Badge></div></div>
        </aside>

        <main id="main-content" className="min-w-0 p-4 sm:p-6 lg:p-7">
          {error && <div className="mb-4 flex items-start justify-between gap-3 rounded-xl border border-red-400/20 bg-red-400/[.05] p-4 text-sm text-red-200" role="alert"><span className="flex gap-2"><AlertCircle className="mt-0.5 shrink-0" size={15} />{error}</span><button onClick={() => setError(null)} aria-label="Dismiss error"><X size={14} /></button></div>}
          <details className="mb-4 rounded-xl border border-white/[.08] bg-[#0b0f13] xl:hidden"><summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-medium"><span className="flex items-center gap-2"><Activity size={14} className="text-emerald-300" />Agent activity</span><Badge variant="neutral">{state.activity.length} calls</Badge></summary><div className="border-t border-white/[.07] p-4"><AgentFeed state={state} compact /></div></details>
          {state.activeView === 'dashboard' && <DashboardScreen state={state} onRun={runInvestigation} onStartLive={startRealInvestigation} running={running} onNavigate={navigate} />}
          {state.activeView === 'workspace' && <WorkspaceScreen state={state} onRun={runInvestigation} running={running} onNavigate={navigate} />}
          {state.activeView === 'graph' && <GraphScreen state={state} onRun={runInvestigation} running={running} onSelect={selectNode} />}
          {state.activeView === 'claims' && <ClaimsScreen state={state} onRun={runInvestigation} running={running} onSetClaimStatus={setClaimStatus} onAddSource={addIndependentSource} sourceLoading={sourceLoading} />}
          {state.activeView === 'review' && <ReviewScreen state={state} onAnswer={handleHumanAnswer} />}
          {state.activeView === 'risk' && <RiskScreen state={state} onNavigate={navigate} onGenerate={generateReceipt} generating={generating} />}
          {state.activeView === 'receipt' && <ReceiptScreen state={state} onGenerate={generateReceipt} generating={generating} onToast={setToast} />}
          {state.activeView === 'history' && <HistoryScreen state={state} onReset={resetDemo} />}
        </main>

        <aside className="sticky top-16 hidden h-[calc(100vh-4rem)] overflow-y-auto border-l border-white/[.08] bg-[#080b0e] p-5 xl:block"><AgentFeed state={state} /></aside>
      </div>

      <div className="sr-only" aria-live="polite">{running || sourceLoading ? 'Investigation in progress' : toast ?? ''}</div>
      {toast && <div className="fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full border border-emerald-400/20 bg-[#0d1713] px-4 py-2.5 text-xs font-medium text-emerald-200 shadow-2xl" role="status"><CheckCircle2 size={14} />{toast}</div>}
    </div>
  );
}

function AgentFeed({ state, compact = false }: { state: ReturnType<typeof useReality>['state']; compact?: boolean }) {
  const tools = ['create_case', 'add_evidence', 'extract_entities', 'extract_claims', 'inspect_claim', 'record_source', 'link_evidence', 'verify_claim', 'contradict_claim', 'mark_unresolved', 'request_human_context', 'calculate_risk', 'build_evidence_graph', 'generate_trust_receipt', 'create_safe_action_plan'];
  return <div><div className="flex items-center justify-between"><h2 className="flex items-center gap-2 text-sm font-semibold"><Activity size={15} className="text-emerald-300" />Agent activity</h2><span className="size-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399]" /></div>
    {state.activity.length ? <ol className={`mt-5 space-y-4 ${compact ? 'grid gap-3 sm:grid-cols-2 sm:space-y-0' : ''}`}>{state.activity.slice(0, compact ? 6 : 12).map((event, index) => <li key={event.id} className="relative flex gap-3"><span className={`mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg border ${event.source === 'Human' ? 'border-sky-400/20 bg-sky-400/8 text-sky-300' : event.outcome === 'waiting' ? 'border-amber-400/20 bg-amber-400/8 text-amber-300' : 'border-emerald-400/15 bg-emerald-400/[.06] text-emerald-300'}`}>{event.source === 'Human' ? <Menu size={12} /> : event.outcome === 'waiting' ? <CircleHelp size={12} /> : <Sparkles size={12} />}</span><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><code className="truncate text-[11px] text-slate-300">{event.tool}</code><time className="text-[9px] text-slate-700">{index === 0 ? 'now' : `${index + 1}s`}</time></div><p className="mt-1 text-[11px] leading-5 text-slate-600">{event.detail}</p><span className="mt-1 block text-[9px] uppercase tracking-[.1em] text-slate-700">{event.source}</span></div></li>)}</ol> : <div className="mt-5 rounded-xl border border-dashed border-white/[.09] p-5 text-center"><FileClock className="mx-auto text-slate-800" size={22} /><p className="mt-3 text-xs text-slate-500">No tool calls yet</p><p className="mt-1 text-[11px] leading-5 text-slate-700">Start a real case or run the NVIDIA demo to watch the shared command layer build evidence live.</p></div>}
    {!compact && <div className="mt-7 border-t border-white/[.07] pt-5"><div className="flex items-center justify-between"><span className="text-[10px] font-semibold uppercase tracking-[.13em] text-slate-600">WebMCP tool layer</span><Badge variant="verified">15 ready</Badge></div><div className="mt-3 flex flex-wrap gap-1.5">{tools.map((tool) => <code key={tool} className="rounded-md border border-white/[.06] bg-white/[.025] px-2 py-1 text-[9px] text-slate-600">{tool}</code>)}</div><p className="mt-4 text-[10px] leading-5 text-slate-700">External agents and this interface act on the same versioned case state. Feed entries identify their actual caller.</p></div>}
  </div>;
}
