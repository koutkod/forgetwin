'use client';

import { ArrowRight, Check, ChevronRight, CircleDot, Clipboard, Copy, Download, FileText, Fingerprint, Globe2, KeyRound, LockKeyhole, Mail, Network, Radar, ReceiptText, Search, ShieldAlert, ShieldCheck, Sparkles, UserCheck, UserRound, WalletCards, X, XCircle } from 'lucide-react';
import { useState } from 'react';
import { DEMO_MESSAGE } from '../../lib/reality-data';
import type { Claim, RealityState, TrustStatus, ViewId } from '../../lib/reality-types';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader } from '../ui/card';
import { Progress } from '../ui/progress';
import { EvidenceGraph, StatusIcon } from './evidence-graph';

const statusLabel: Record<TrustStatus, string> = { verified: 'Verified', unresolved: 'Unresolved', contradicted: 'Contradicted', human: 'Human context' };

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] font-semibold uppercase tracking-[.16em] text-emerald-400">{children}</p>;
}

function Heading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) {
  return <div className="mb-6 flex flex-wrap items-end justify-between gap-4"><div><Eyebrow>{eyebrow}</Eyebrow><h1 className="mt-2 text-2xl font-semibold tracking-[-.035em] text-white sm:text-3xl">{title}</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">{description}</p></div>{action}</div>;
}

function EmptyInvestigation({ onRun, running }: { onRun: () => void; running: boolean }) {
  return <Card className="border-dashed"><CardContent className="grid min-h-64 place-items-center text-center"><div><span className="mx-auto grid size-12 place-items-center rounded-xl border border-emerald-400/20 bg-emerald-400/8 text-emerald-300"><Radar size={22} /></span><h2 className="mt-4 font-semibold">The evidence map has not been built yet</h2><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">Run the guided investigation to extract narrow claims and connect independent evidence.</p><Button className="mt-5" onClick={onRun} disabled={running}><Sparkles size={15} />{running ? 'Agent investigating…' : 'Run guided investigation'}</Button></div></CardContent></Card>;
}

export function DashboardScreen({ state, onRun, running, onNavigate }: { state: RealityState; onRun: () => void; running: boolean; onNavigate: (view: ViewId) => void }) {
  const done = state.receiptGenerated;
  return <>
    <Heading eyebrow="Investigation dashboard" title="Establish what can actually be trusted." description="RealityOS verifies individual claims with evidence. It never guesses whether something merely looks AI-generated." action={<Button onClick={done ? () => onNavigate('receipt') : onRun} disabled={running}><Sparkles size={15} />{running ? 'Agent investigating…' : done ? 'Open Trust Receipt' : state.caseCreated ? 'Continue investigation' : 'Run NVIDIA investigation'}</Button>} />
    <section className="grid gap-3 sm:grid-cols-3" aria-label="Case summary">
      <Metric label="Active investigations" value="01" detail="NVIDIA offer" />
      <Metric label="Claims mapped" value={String(state.claims.length).padStart(2, '0')} detail={state.claimsExtracted ? 'Evidence scoped' : 'Awaiting agent'} />
      <Metric label="Current risk" value={state.riskCalculated ? String(state.riskScore) : '—'} detail={state.riskCalculated ? state.riskLevel : 'Not assessed'} tone={state.riskLevel === 'Critical risk' ? 'red' : undefined} />
    </section>

    <Card className="mt-4 overflow-hidden">
      <CardHeader className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-[10px] font-semibold tracking-[.14em] text-slate-500">BUILT-IN HACKATHON CASE</p><h2 className="mt-1 font-semibold">NVIDIA Senior AI Engineer job offer</h2></div><Badge variant={state.riskLevel === 'Critical risk' ? 'contradicted' : state.caseCreated ? 'unresolved' : 'neutral'}><i className={`size-1.5 rounded-full ${state.riskLevel === 'Critical risk' ? 'bg-red-400' : 'bg-amber-400'}`} />{state.riskLevel === 'Critical risk' ? 'Critical risk' : state.caseCreated ? 'Investigation active' : 'Ready to investigate'}</Badge></CardHeader>
      <div className="grid gap-0 lg:grid-cols-[1.1fr_.9fr]">
        <div className="border-b border-white/[.08] p-5 lg:border-b-0 lg:border-r"><UntrustedMessage compact /></div>
        <div className="p-5">
          <div className="flex items-center justify-between"><span className="text-xs font-medium text-slate-300">Investigation progress</span><span className="text-xs text-slate-500">{investigationProgress(state)}%</span></div>
          <Progress className="mt-3" value={investigationProgress(state)} label="Investigation progress" />
          <div className="mt-5 space-y-3">
            <Stage done={state.caseCreated} label="Case created and message isolated" />
            <Stage done={state.entitiesExtracted && state.claimsExtracted} label="Entities and claims extracted" />
            <Stage done={state.graphBuilt} label="Evidence graph constructed" />
            <Stage done={Boolean(state.humanAnswer)} pending={state.humanQuestionPending} label="Human context collected" />
            <Stage done={state.receiptGenerated} label="Trust Receipt generated" />
          </div>
          <div className="mt-5 flex flex-wrap gap-2"><Button onClick={done ? () => onNavigate('receipt') : onRun} disabled={running}>{done ? <ReceiptText size={15} /> : <Search size={15} />}{done ? 'View receipt' : running ? 'Investigating…' : 'Start agent investigation'}</Button><Button variant="outline" onClick={() => onNavigate('workspace')}>Inspect message <ArrowRight size={14} /></Button></div>
        </div>
      </div>
    </Card>

    <section className="mt-4 grid gap-4 lg:grid-cols-2">
      <Card><CardContent><div className="flex items-start gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-amber-400/10 text-amber-300"><ShieldAlert size={19} /></span><div><h2 className="font-semibold">Prompt-injection quarantine</h2><p className="mt-2 text-sm leading-6 text-slate-500">Imported emails, websites, and documents remain untrusted data. Content can create candidate claims, but it cannot issue tool instructions, set risk, or mark itself verified.</p></div></div></CardContent></Card>
      <Card><CardContent><div className="flex items-start gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-emerald-400/10 text-emerald-300"><Fingerprint size={19} /></span><div><h2 className="font-semibold">Evidence, not vibes</h2><p className="mt-2 text-sm leading-6 text-slate-500">RealityOS separates what is verified, contradicted, unresolved, and supplied by a human—then preserves that trail in a shareable receipt.</p></div></div></CardContent></Card>
    </section>
  </>;
}

function Metric({ label, value, detail, tone }: { label: string; value: string; detail: string; tone?: 'red' }) {
  return <Card><CardContent className="p-4"><span className="text-xs text-slate-500">{label}</span><strong className={`mt-3 block text-2xl font-semibold ${tone === 'red' ? 'text-red-300' : 'text-white'}`}>{value}</strong><span className="mt-1 block text-xs text-slate-600">{detail}</span></CardContent></Card>;
}

function Stage({ done, pending, label }: { done: boolean; pending?: boolean; label: string }) {
  return <div className="flex items-center gap-3 text-sm"><span className={`grid size-5 place-items-center rounded-full border ${done ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300' : pending ? 'border-amber-400/30 bg-amber-400/10 text-amber-300' : 'border-white/10 text-slate-700'}`}>{done ? <Check size={11} /> : pending ? <CircleDot size={10} /> : <span className="size-1 rounded-full bg-current" />}</span><span className={done ? 'text-slate-300' : pending ? 'text-amber-200' : 'text-slate-600'}>{label}</span></div>;
}

function investigationProgress(state: RealityState) {
  return [state.caseCreated, state.entitiesExtracted, state.claimsExtracted, state.graphBuilt, Boolean(state.humanAnswer), state.receiptGenerated].filter(Boolean).length / 6 * 100;
}

function UntrustedMessage({ compact = false }: { compact?: boolean }) {
  const [expanded, setExpanded] = useState(!compact);
  return <div className="overflow-hidden rounded-xl border border-white/[.08] bg-[#080b0e]">
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[.07] px-4 py-3"><div className="flex items-center gap-2 text-xs text-slate-500"><Mail size={13} />Imported email</div><Badge variant="unresolved"><LockKeyhole size={10} />Untrusted content</Badge></div>
    <div className="p-4">
      <dl className="grid gap-2 text-xs"><div className="grid grid-cols-[48px_1fr] gap-2"><dt className="text-slate-600">From</dt><dd className="truncate text-slate-400">{DEMO_MESSAGE.from}</dd></div><div className="grid grid-cols-[48px_1fr] gap-2"><dt className="text-slate-600">Reply</dt><dd className="truncate text-red-300/80">{DEMO_MESSAGE.replyTo}</dd></div><div className="grid grid-cols-[48px_1fr] gap-2"><dt className="text-slate-600">Subject</dt><dd className="text-slate-300">{DEMO_MESSAGE.subject}</dd></div></dl>
      <div className={`mt-4 whitespace-pre-line text-sm leading-6 text-slate-400 ${!expanded ? 'line-clamp-4' : ''}`}>{DEMO_MESSAGE.body}</div>
      {expanded && <div className="mt-4 rounded-lg border border-red-400/15 bg-red-400/[.04] p-3"><span className="text-[10px] font-semibold uppercase tracking-[.12em] text-red-300">Blocked instruction found inside evidence</span><code className="mt-1 block text-xs text-slate-500">{DEMO_MESSAGE.injectionExcerpt}</code><p className="mt-2 text-xs text-slate-600">Stored as quoted evidence. Never executed.</p></div>}
      {compact && <Button className="mt-3" variant="ghost" size="sm" onClick={() => setExpanded(!expanded)}>{expanded ? 'Show less' : 'Read complete message'} <ChevronRight className={expanded ? 'rotate-90' : ''} size={13} /></Button>}
    </div>
  </div>;
}

export function WorkspaceScreen({ state, onRun, running, onNavigate }: { state: RealityState; onRun: () => void; running: boolean; onNavigate: (view: ViewId) => void }) {
  return <>
    <Heading eyebrow="Investigation workspace" title="Suspicious NVIDIA job offer" description="The agent turns untrusted content into narrow claims, then checks each claim against independently recorded evidence." action={<Badge variant={state.phase === 'awaiting-human' ? 'unresolved' : state.riskLevel === 'Critical risk' ? 'contradicted' : 'neutral'}>{state.phase.replace('-', ' ')}</Badge>} />
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(300px,.85fr)]">
      <UntrustedMessage />
      <div className="space-y-4">
        <Card><CardHeader><h2 className="text-sm font-semibold">Agent investigation</h2></CardHeader><CardContent>
          <div className="flex items-center justify-between text-xs"><span className="text-slate-500">Overall progress</span><span className="text-slate-300">{Math.round(investigationProgress(state))}%</span></div><Progress className="mt-3" value={investigationProgress(state)} />
          <div className="mt-5 space-y-3"><Stage done={state.caseCreated} label="Create investigation case" /><Stage done={state.messageAdded} label="Preserve untrusted message" /><Stage done={state.entitiesExtracted} label="Extract 9 entities" /><Stage done={state.claimsExtracted} label="Extract 6 claims" /><Stage done={state.graphBuilt} label="Build evidence graph" /><Stage done={Boolean(state.humanAnswer)} pending={state.humanQuestionPending} label="Ask for human context" /></div>
          {!state.humanQuestionPending && !state.humanAnswer && <Button className="mt-5 w-full" onClick={onRun} disabled={running}><Sparkles size={15} />{running ? 'Agent is investigating…' : 'Run complete agent sequence'}</Button>}
          {state.humanQuestionPending && <Button className="mt-5 w-full" onClick={() => onNavigate('review')}><UserCheck size={15} />Answer human review question</Button>}
        </CardContent></Card>
        <Card><CardHeader><h2 className="text-sm font-semibold">Extracted entities</h2></CardHeader><CardContent className="p-0">{state.entities.length ? <div className="divide-y divide-white/[.06]">{state.entities.slice(0, 7).map((entity) => <div key={entity.id} className="flex items-center justify-between gap-3 px-4 py-3"><div className="min-w-0"><span className="block text-[10px] uppercase tracking-[.1em] text-slate-600">{entity.label}</span><span className="block truncate text-xs text-slate-300">{entity.value}</span></div><Badge variant={entity.status}><StatusIcon status={entity.status} size={10} />{statusLabel[entity.status]}</Badge></div>)}</div> : <p className="p-5 text-sm text-slate-600">Entities will appear as the agent calls <code>extract_entities</code>.</p>}</CardContent></Card>
      </div>
    </div>
  </>;
}

export function GraphScreen({ state, onRun, running, onSelect }: { state: RealityState; onRun: () => void; running: boolean; onSelect: (id: string) => void }) {
  const selected = state.graphNodes.find((node) => node.id === state.selectedNodeId);
  return <>
    <Heading eyebrow="Evidence graph" title="See how every conclusion is connected." description="Organizations, identities, domains, claims, and evidence remain distinct nodes so a persuasive message can never become its own proof." action={state.graphBuilt ? <Badge variant="neutral"><Network size={11} />{state.graphNodes.length} nodes · {state.graphEdges.length} links</Badge> : undefined} />
    {!state.graphBuilt ? <EmptyInvestigation onRun={onRun} running={running} /> : <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px]"><EvidenceGraph nodes={state.graphNodes} edges={state.graphEdges} selectedId={state.selectedNodeId} onSelect={onSelect} /><Card><CardHeader><h2 className="text-sm font-semibold">Node inspector</h2></CardHeader><CardContent>{selected ? <><Badge variant={selected.status}><StatusIcon status={selected.status} size={11} />{statusLabel[selected.status]}</Badge><h3 className="mt-4 font-semibold">{selected.label}</h3><p className="mt-2 text-sm leading-6 text-slate-500">{selected.sublabel}</p><dl className="mt-5 space-y-3 text-xs"><div className="flex justify-between gap-4"><dt className="text-slate-600">Node type</dt><dd className="capitalize text-slate-300">{selected.type}</dd></div><div className="flex justify-between gap-4"><dt className="text-slate-600">Connections</dt><dd className="text-slate-300">{state.graphEdges.filter((edge) => edge.source === selected.id || edge.target === selected.id).length}</dd></div><div className="flex justify-between gap-4"><dt className="text-slate-600">Status</dt><dd className="capitalize text-slate-300">{selected.status}</dd></div></dl></> : <p className="text-sm leading-6 text-slate-600">Select any graph node to inspect its status and connections. Every node is keyboard accessible.</p>}</CardContent></Card></div>}
  </>;
}

export function ClaimsScreen({ state, onRun, running }: { state: RealityState; onRun: () => void; running: boolean }) {
  const [filter, setFilter] = useState<'all' | TrustStatus>('all');
  const claims = state.claims.filter((claim) => filter === 'all' || claim.status === filter);
  return <>
    <Heading eyebrow="Claims & evidence" title="A claim ledger, not a vibe check." description="Every claim keeps its own outcome, evidence basis, confidence, and safest path to independent verification." />
    {!state.claimsExtracted ? <EmptyInvestigation onRun={onRun} running={running} /> : <>
      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Filter claims">{(['all', 'verified', 'unresolved', 'contradicted'] as const).map((item) => <Button key={item} size="sm" variant={filter === item ? 'secondary' : 'outline'} aria-pressed={filter === item} onClick={() => setFilter(item)}>{item === 'all' ? 'All claims' : statusLabel[item]}</Button>)}</div>
      <div className="space-y-3">{claims.map((claim) => <ClaimCard key={claim.id} claim={claim} evidence={state.evidence.filter((item) => claim.evidenceIds.includes(item.id))} />)}</div>
    </>}
  </>;
}

function ClaimCard({ claim, evidence }: { claim: Claim; evidence: RealityState['evidence'] }) {
  const [open, setOpen] = useState(claim.status === 'unresolved');
  return <Card className={claim.status === 'contradicted' ? 'border-red-400/15' : claim.status === 'unresolved' ? 'border-amber-400/15' : ''}><button className="flex w-full items-start justify-between gap-4 p-5 text-left" aria-expanded={open} onClick={() => setOpen(!open)}><div className="flex min-w-0 gap-3"><span className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg ${claim.status === 'verified' ? 'bg-emerald-400/10 text-emerald-300' : claim.status === 'contradicted' ? 'bg-red-400/10 text-red-300' : 'bg-amber-400/10 text-amber-300'}`}><StatusIcon status={claim.status} /></span><div><h2 className="text-sm font-semibold text-slate-200">{claim.title}</h2><p className="mt-1 text-xs leading-5 text-slate-600">{claim.detail}</p></div></div><div className="flex shrink-0 items-center gap-2"><Badge variant={claim.status}>{statusLabel[claim.status]}</Badge><ChevronRight className={`text-slate-600 transition-transform ${open ? 'rotate-90' : ''}`} size={14} /></div></button>{open && <div className="grid gap-4 border-t border-white/[.07] p-5 md:grid-cols-2"><div><span className="text-[10px] font-semibold uppercase tracking-[.12em] text-slate-600">Current basis</span><p className="mt-2 text-sm leading-6 text-slate-400">{claim.reason}</p><div className="mt-3 space-y-2">{evidence.length ? evidence.map((item) => <div key={item.id} className="rounded-lg border border-white/[.07] bg-black/10 p-3"><span className="text-xs font-medium text-slate-300">{item.title}</span><span className="mt-1 block text-[11px] text-slate-600">{item.source}</span></div>) : <span className="text-xs text-slate-600">No independent evidence linked yet.</span>}</div></div><div className="rounded-xl border border-amber-400/15 bg-amber-400/[.035] p-4"><span className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.14em] text-amber-300"><KeyRound size={12} />What Would Prove It?</span><p className="mt-3 text-sm leading-6 text-slate-400">{claim.whatWouldProve}</p><p className="mt-3 text-[11px] leading-5 text-slate-600">Use contact details obtained independently—not links or phone numbers inside the suspicious message.</p></div></div>}</Card>;
}

export function ReviewScreen({ state, onAnswer }: { state: RealityState; onAnswer: (answer: 'yes' | 'no' | 'unsure') => void }) {
  return <>
    <Heading eyebrow="Human review" title="One fact only you can provide." description="The agent can inspect evidence, but it cannot infer your personal history. Your answer is recorded separately as human-provided context." />
    <div className="mx-auto max-w-3xl">
      <Card className="overflow-hidden border-sky-400/15">
        <div className="border-b border-white/[.08] bg-sky-400/[.035] px-6 py-5"><div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl bg-sky-400/10 text-sky-300"><UserRound size={19} /></span><div><Badge variant="human">Human context required</Badge><p className="mt-2 text-xs text-slate-500">Requested by <code>request_human_context</code></p></div></div></div>
        <CardContent className="p-6 sm:p-8"><p className="text-sm text-slate-500">Before this offer arrived:</p><h2 className="mt-3 text-2xl font-semibold tracking-[-.02em] text-white">Did you actually apply for this job?</h2><p className="mt-3 text-sm leading-6 text-slate-500">Your answer changes the risk assessment, but it does not automatically decide every other claim.</p>
          {state.humanAnswer ? <div className="mt-6 rounded-xl border border-sky-400/20 bg-sky-400/[.05] p-5"><Badge variant="human"><UserCheck size={11} />Recorded from human UI</Badge><p className="mt-3 font-semibold">{state.humanAnswer === 'no' ? 'No — I did not apply for this role.' : state.humanAnswer === 'yes' ? 'Yes — I applied for a similar role.' : 'I’m not sure.'}</p></div> : <div className="mt-7 grid gap-3 sm:grid-cols-3"><button className="rounded-xl border border-white/10 bg-white/[.025] p-4 text-left hover:border-emerald-400/30 hover:bg-emerald-400/[.04]" onClick={() => onAnswer('yes')}><span className="grid size-7 place-items-center rounded-lg bg-emerald-400/10 text-emerald-300"><Check size={14} /></span><strong className="mt-3 block text-sm">Yes</strong><span className="mt-1 block text-xs text-slate-600">I applied for this role</span></button><button className="rounded-xl border border-red-400/20 bg-red-400/[.035] p-4 text-left hover:border-red-400/40 hover:bg-red-400/[.07]" onClick={() => onAnswer('no')}><span className="grid size-7 place-items-center rounded-lg bg-red-400/10 text-red-300"><X size={14} /></span><strong className="mt-3 block text-sm">No</strong><span className="mt-1 block text-xs text-slate-600">I never applied</span></button><button className="rounded-xl border border-white/10 bg-white/[.025] p-4 text-left hover:border-amber-400/30 hover:bg-amber-400/[.04]" onClick={() => onAnswer('unsure')}><span className="grid size-7 place-items-center rounded-lg bg-amber-400/10 text-amber-300"><CircleDot size={14} /></span><strong className="mt-3 block text-sm">Not sure</strong><span className="mt-1 block text-xs text-slate-600">I need to check</span></button></div>}
        </CardContent>
      </Card>
      <div className="mt-4 rounded-xl border border-white/[.07] bg-white/[.02] p-4 text-xs leading-5 text-slate-600"><LockKeyhole className="mr-2 inline text-slate-500" size={13} />Only the visible human interface can submit this answer. The agent can request context, but it cannot answer on your behalf.</div>
    </div>
  </>;
}

export function RiskScreen({ state, onNavigate, onGenerate, generating }: { state: RealityState; onNavigate: (view: ViewId) => void; onGenerate: () => void; generating: boolean }) {
  const factors = [
    { title: 'Lookalike recruiting domain', points: 20, icon: Globe2, detail: 'New domain does not match nvidia.com.' },
    { title: 'Unverified onboarding portal', points: 20, icon: LockKeyhole, detail: 'Sensitive data requested on an unrelated domain.' },
    { title: 'Sensitive identity + banking request', points: 20, icon: WalletCards, detail: 'Government ID, SSN card, and banking details requested.' },
    { title: 'Email authentication failure', points: 12, icon: Mail, detail: 'SPF failed and DKIM was absent.' },
    ...(state.humanAnswer === 'no' ? [{ title: 'Recipient did not apply', points: 24, icon: UserRound, detail: 'Decisive human-provided context.' }] : []),
  ];
  return <>
    <Heading eyebrow="Risk assessment" title="Risk is calculated from evidence—not appearance." description="Scores are deterministic and factor-based. Unresolved claims remain visible instead of being forced into a binary verdict." />
    {!state.riskCalculated ? <Card><CardContent className="grid min-h-64 place-items-center text-center"><div><Radar className="mx-auto text-slate-700" size={28} /><h2 className="mt-4 font-semibold">Risk has not been calculated</h2><p className="mt-2 text-sm text-slate-600">Complete the evidence and human-review steps first.</p><Button className="mt-5" variant="outline" onClick={() => onNavigate('workspace')}>Return to investigation</Button></div></CardContent></Card> : <div className="grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
      <Card className={state.riskLevel === 'Critical risk' ? 'border-red-400/20 bg-[radial-gradient(circle_at_top,rgba(248,113,113,.08),transparent_48%),#0b0f13]' : ''}><CardContent className="p-6 text-center"><div className="risk-ring mx-auto grid size-44 place-items-center rounded-full p-3" style={{ background: `conic-gradient(${state.riskScore >= 80 ? '#f87171' : '#fbbf24'} ${state.riskScore * 3.6}deg, rgba(255,255,255,.06) 0deg)` }} role="img" aria-label={`${state.riskScore} out of 100, ${state.riskLevel}`}><div className="grid size-full place-items-center rounded-full bg-[#0b0f13]"><div><strong className={`text-5xl font-semibold ${state.riskScore >= 80 ? 'text-red-300' : 'text-amber-300'}`}>{state.riskScore}</strong><span className="block text-xs text-slate-600">out of 100</span></div></div></div><Badge className="mt-5" variant={state.riskScore >= 80 ? 'contradicted' : 'unresolved'}><ShieldAlert size={11} />{state.riskLevel}</Badge><h2 className="mt-4 text-lg font-semibold">Likely impersonation attempt</h2><p className="mt-2 text-sm leading-6 text-slate-500">Do not upload documents, reply, or use any contact details supplied in the message.</p><Button className="mt-5 w-full" onClick={onGenerate} disabled={generating}><ReceiptText size={15} />{generating ? 'Generating receipt…' : 'Generate Trust Receipt'}</Button></CardContent></Card>
      <div className="space-y-4"><Card><CardHeader><div className="flex items-center justify-between"><h2 className="text-sm font-semibold">Risk contributions</h2><span className="text-xs text-slate-600">Controlled factors</span></div></CardHeader><CardContent className="p-0"><div className="divide-y divide-white/[.06]">{factors.map(({ title, points, icon: Icon, detail }) => <div key={title} className="flex items-start gap-3 px-5 py-4"><span className="grid size-8 shrink-0 place-items-center rounded-lg bg-red-400/8 text-red-300"><Icon size={15} /></span><div className="min-w-0 flex-1"><strong className="block text-sm font-medium text-slate-300">{title}</strong><span className="mt-1 block text-xs leading-5 text-slate-600">{detail}</span></div><span className="text-sm font-semibold text-red-300">+{points}</span></div>)}</div></CardContent></Card>
        <Card className="border-emerald-400/15"><CardContent><div className="flex items-start gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-xl bg-emerald-400/10 text-emerald-300"><ShieldCheck size={17} /></span><div><span className="text-[10px] font-semibold uppercase tracking-[.14em] text-emerald-300">Safest next action</span><h2 className="mt-2 font-semibold">Stop and verify independently.</h2><p className="mt-2 text-sm leading-6 text-slate-500">Use a contact method found directly on NVIDIA’s official website. Do not use links, emails, or phone numbers from this offer.</p></div></div></CardContent></Card>
      </div>
    </div>}
  </>;
}

function receiptText(state: RealityState) {
  return `RealityOS Trust Receipt\nCase: Suspicious NVIDIA Senior AI Engineer offer\nRisk: ${state.riskLevel} — ${state.riskScore}/100\nVerified: ${state.claims.filter((claim) => claim.status === 'verified').length}\nContradicted: ${state.claims.filter((claim) => claim.status === 'contradicted').length}\nUnresolved: ${state.claims.filter((claim) => claim.status === 'unresolved').length}\nHuman context: Recipient did not apply\nSafest action: Do not reply or upload documents. Verify independently through nvidia.com.\nCase fingerprint: 7A9F-1C42-ROS-NVDA`;
}

export function ReceiptScreen({ state, onGenerate, generating, onToast }: { state: RealityState; onGenerate: () => void; generating: boolean; onToast: (message: string) => void }) {
  const copy = async () => { await navigator.clipboard.writeText(receiptText(state)); onToast('Trust Receipt copied'); };
  const download = () => { const url = URL.createObjectURL(new Blob([receiptText(state)], { type: 'text/plain' })); const link = document.createElement('a'); link.href = url; link.download = 'RealityOS-Trust-Receipt-NVIDIA.txt'; link.click(); URL.revokeObjectURL(url); onToast('Trust Receipt downloaded'); };
  return <>
    <Heading eyebrow="Trust Receipt" title="A shareable record of what the evidence supports." description="The receipt preserves contradictions, unresolved claims, human context, and the safest next action—without pretending uncertainty disappeared." action={state.receiptGenerated ? <div className="flex gap-2"><Button size="sm" variant="outline" onClick={copy}><Copy size={13} />Copy</Button><Button size="sm" variant="outline" onClick={download}><Download size={13} />Download</Button></div> : undefined} />
    {!state.receiptGenerated ? <Card><CardContent className="grid min-h-72 place-items-center text-center"><div><ReceiptText className="mx-auto text-slate-700" size={32} /><h2 className="mt-4 font-semibold">No receipt generated yet</h2><p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-slate-600">Complete human review and risk assessment to create a defensible receipt.</p><Button className="mt-5" onClick={onGenerate} disabled={generating}>{generating ? 'Generating…' : 'Generate Trust Receipt'}</Button></div></CardContent></Card> : <div className="receipt-shell relative mx-auto max-w-4xl overflow-hidden rounded-2xl border border-white/10 bg-[#0b0f13] shadow-[0_28px_90px_rgba(0,0,0,.38)]">
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-emerald-400 via-amber-400 to-red-400" />
      <div className="grid gap-8 p-6 sm:p-8 lg:grid-cols-[1fr_250px]">
        <div><div className="flex items-center gap-3"><span className="grid size-11 place-items-center rounded-xl border border-emerald-400/25 bg-emerald-400/10 text-emerald-300"><ShieldCheck size={21} /></span><div><strong className="block text-lg tracking-tight">RealityOS</strong><span className="text-[10px] uppercase tracking-[.16em] text-slate-600">Trust Receipt · TR-ROS-NVDA-0826</span></div></div><h2 className="mt-8 text-3xl font-semibold tracking-[-.04em]">Critical impersonation risk</h2><p className="mt-3 max-w-xl text-sm leading-6 text-slate-400">The evidence contradicts the claimed recruiting domains and onboarding portal. The recipient confirmed they never applied, materially increasing risk.</p><div className="mt-7 grid grid-cols-2 gap-3 sm:grid-cols-4"><ReceiptStat label="Verified" value={state.claims.filter((claim) => claim.status === 'verified').length} tone="green" /><ReceiptStat label="Contradicted" value={state.claims.filter((claim) => claim.status === 'contradicted').length} tone="red" /><ReceiptStat label="Unresolved" value={state.claims.filter((claim) => claim.status === 'unresolved').length} tone="amber" /><ReceiptStat label="Human context" value={state.humanAnswer ? 1 : 0} tone="blue" /></div></div>
        <div className="rounded-2xl border border-red-400/20 bg-red-400/[.045] p-5 text-center"><span className="text-[10px] font-semibold uppercase tracking-[.15em] text-red-300">Risk assessment</span><strong className="mt-3 block text-6xl font-semibold text-red-300">{state.riskScore}</strong><span className="text-xs text-slate-600">out of 100</span><Badge className="mt-4" variant="contradicted"><ShieldAlert size={11} />Critical risk</Badge><div className="mt-5 border-t border-red-400/15 pt-4 text-left"><span className="text-[10px] uppercase tracking-[.12em] text-slate-600">Case fingerprint</span><code className="mt-1 block text-xs text-slate-400">7A9F-1C42-ROS-NVDA</code></div></div>
      </div>
      <div className="grid gap-5 border-t border-white/[.08] bg-black/10 p-6 sm:p-8 lg:grid-cols-2"><div><span className="text-[10px] font-semibold uppercase tracking-[.14em] text-slate-600">Key contradictions</span><ul className="mt-3 space-y-3 text-sm text-slate-400"><li className="flex gap-2"><XCircle className="mt-0.5 shrink-0 text-red-300" size={15} />Recruiting domain is not an official NVIDIA domain.</li><li className="flex gap-2"><XCircle className="mt-0.5 shrink-0 text-red-300" size={15} />Onboarding portal has no verified NVIDIA relationship.</li><li className="flex gap-2"><XCircle className="mt-0.5 shrink-0 text-red-300" size={15} />Sensitive identity and banking data requested urgently.</li></ul></div><div className="rounded-xl border border-emerald-400/15 bg-emerald-400/[.035] p-4"><span className="text-[10px] font-semibold uppercase tracking-[.14em] text-emerald-300">Safest next action</span><p className="mt-3 text-sm font-medium text-slate-200">Do not reply, click, or upload documents.</p><p className="mt-2 text-xs leading-5 text-slate-500">Verify independently through contact details found on NVIDIA’s official website, preserve the message, and report the impersonation.</p></div></div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[.08] px-6 py-4 text-[10px] uppercase tracking-[.12em] text-slate-700"><span>Generated from case revision {state.revision}</span><span>Evidence ledger preserved · Deterministic demo</span></div>
    </div>}
  </>;
}

function ReceiptStat({ label, value, tone }: { label: string; value: number; tone: 'green' | 'red' | 'amber' | 'blue' }) {
  const colors = { green: 'text-emerald-300', red: 'text-red-300', amber: 'text-amber-300', blue: 'text-sky-300' };
  return <div className="rounded-xl border border-white/[.07] bg-white/[.02] p-3"><strong className={`text-xl ${colors[tone]}`}>{value}</strong><span className="mt-1 block text-[10px] text-slate-600">{label}</span></div>;
}

export function HistoryScreen({ state, onReset }: { state: RealityState; onReset: () => void }) {
  return <>
    <Heading eyebrow="Case history" title="A complete, replayable investigation trail." description="Every WebMCP call and human decision is attached to the same case state. Reset restores the deterministic judging sequence." action={<Button variant="danger" onClick={onReset}><Clipboard size={14} />Reset demo</Button>} />
    <Card><CardHeader className="flex items-center justify-between"><h2 className="text-sm font-semibold">Case ledger</h2><Badge variant="neutral">Revision {state.revision}</Badge></CardHeader><CardContent className="p-0"><ol className="divide-y divide-white/[.06]">{[...state.history].reverse().map((event, index) => <li key={event.id} className="flex gap-4 px-5 py-4"><span className={`mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg ${event.kind === 'human' ? 'bg-sky-400/10 text-sky-300' : event.kind === 'agent' ? 'bg-emerald-400/10 text-emerald-300' : 'bg-white/[.05] text-slate-500'}`}>{event.kind === 'human' ? <UserRound size={13} /> : event.kind === 'agent' ? <Sparkles size={13} /> : <FileText size={13} />}</span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-sm font-medium capitalize text-slate-300">{event.title}</strong><time className="text-[10px] text-slate-700">{index === 0 ? 'Latest' : event.at}</time></div><p className="mt-1 text-xs leading-5 text-slate-600">{event.detail}</p></div></li>)}</ol></CardContent></Card>
  </>;
}

export function ToolsScreenCard() {
  return null;
}
