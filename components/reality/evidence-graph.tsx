'use client';

import { AlertCircle, CheckCircle2, List, Network, UserRound, XCircle } from 'lucide-react';
import { useState } from 'react';
import type { GraphEdge, GraphNode, TrustStatus } from '../../lib/reality-types';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card } from '../ui/card';

const nodeStyle: Record<TrustStatus, string> = {
  verified: 'border-emerald-400/45 bg-[#0a1a14] text-emerald-100 shadow-[0_0_28px_rgba(52,211,153,.08)]',
  unresolved: 'border-amber-400/45 bg-[#1a150a] text-amber-100 shadow-[0_0_28px_rgba(251,191,36,.06)]',
  contradicted: 'border-red-400/45 bg-[#1a0b0d] text-red-100 shadow-[0_0_28px_rgba(248,113,113,.07)]',
  human: 'border-sky-400/45 bg-[#09161d] text-sky-100 shadow-[0_0_28px_rgba(56,189,248,.07)]',
};

const lineStyle: Record<TrustStatus, string> = {
  verified: '#34d399', unresolved: '#fbbf24', contradicted: '#f87171', human: '#38bdf8',
};

export function StatusIcon({ status, size = 14 }: { status: TrustStatus; size?: number }) {
  if (status === 'verified') return <CheckCircle2 size={size} aria-hidden="true" />;
  if (status === 'contradicted') return <XCircle size={size} aria-hidden="true" />;
  if (status === 'human') return <UserRound size={size} aria-hidden="true" />;
  return <AlertCircle size={size} aria-hidden="true" />;
}

export function EvidenceGraph({ nodes, edges, selectedId, onSelect }: { nodes: GraphNode[]; edges: GraphEdge[]; selectedId: string | null; onSelect: (id: string) => void }) {
  const [mode, setMode] = useState<'graph' | 'list'>('graph');
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[.08] px-4 py-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500" aria-label="Graph legend">
          <Badge variant="verified"><i className="size-1.5 rounded-full bg-emerald-400" />Verified</Badge>
          <Badge variant="unresolved"><i className="size-1.5 rounded-full bg-amber-400" />Unresolved</Badge>
          <Badge variant="contradicted"><i className="size-1.5 rounded-full bg-red-400" />Contradicted</Badge>
          <Badge variant="human"><i className="size-1.5 rounded-full bg-sky-400" />Human context</Badge>
        </div>
        <div className="flex rounded-lg border border-white/10 p-1">
          <Button aria-pressed={mode === 'graph'} variant={mode === 'graph' ? 'secondary' : 'ghost'} size="sm" onClick={() => setMode('graph')}><Network size={13} />Graph</Button>
          <Button aria-pressed={mode === 'list'} variant={mode === 'list' ? 'secondary' : 'ghost'} size="sm" onClick={() => setMode('list')}><List size={13} />List</Button>
        </div>
      </div>

      {mode === 'graph' ? (
        <div className="evidence-canvas relative min-h-[480px] overflow-hidden bg-[radial-gradient(circle_at_50%_45%,rgba(52,211,153,.065),transparent_40%),linear-gradient(rgba(255,255,255,.018)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.018)_1px,transparent_1px)] bg-[size:auto,32px_32px,32px_32px]" role="group" aria-label="Interactive evidence graph">
          <svg className="pointer-events-none absolute inset-0 size-full" aria-hidden="true">
            {edges.map((edge) => {
              const source = nodeMap.get(edge.source);
              const target = nodeMap.get(edge.target);
              if (!source || !target) return null;
              return <line key={edge.id} x1={`${source.x}%`} y1={`${source.y}%`} x2={`${target.x}%`} y2={`${target.y}%`} stroke={lineStyle[edge.status]} strokeOpacity=".42" strokeWidth="1.4" strokeDasharray={edge.status === 'unresolved' ? '5 5' : undefined} />;
            })}
          </svg>
          {nodes.map((node) => (
            <button
              key={node.id}
              onClick={() => onSelect(node.id)}
              aria-pressed={selectedId === node.id}
              aria-label={`${node.label}, ${node.sublabel}, ${node.status}`}
              className={`absolute z-10 w-[132px] -translate-x-1/2 -translate-y-1/2 rounded-xl border px-3 py-2.5 text-left transition-transform hover:scale-[1.03] sm:w-[150px] ${nodeStyle[node.status]} ${selectedId === node.id ? 'ring-2 ring-white/30' : ''}`}
              style={{ left: `${node.x}%`, top: `${node.y}%` }}
            >
              <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-[.1em] opacity-70"><StatusIcon status={node.status} size={11} />{node.type}</span>
              <strong className="mt-1 block truncate text-xs font-semibold">{node.label}</strong>
              <span className="mt-0.5 block truncate text-[10px] opacity-60">{node.sublabel}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] border-collapse text-left text-sm">
            <caption className="sr-only">Accessible list of evidence graph nodes and relationships</caption>
            <thead><tr className="border-b border-white/[.08] text-xs text-slate-500"><th className="px-5 py-3 font-medium" scope="col">Node</th><th className="px-5 py-3 font-medium" scope="col">Type</th><th className="px-5 py-3 font-medium" scope="col">Status</th><th className="px-5 py-3 font-medium" scope="col">Connections</th></tr></thead>
            <tbody>{nodes.map((node) => <tr key={node.id} className="border-b border-white/[.06] last:border-0"><td className="px-5 py-4"><button className="font-medium text-slate-200 hover:text-emerald-300" onClick={() => onSelect(node.id)}>{node.label}</button><span className="mt-1 block text-xs text-slate-600">{node.sublabel}</span></td><td className="px-5 py-4 capitalize text-slate-500">{node.type}</td><td className="px-5 py-4"><Badge variant={node.status}><StatusIcon status={node.status} size={11} />{node.status}</Badge></td><td className="px-5 py-4 text-slate-500">{edges.filter((edge) => edge.source === node.id || edge.target === node.id).length}</td></tr>)}</tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
