'use client';

import { Activity, AlertTriangle, ArrowLeft, ArrowRight, BadgeCheck, Box, Check, ChevronDown, CircleDot, Clock3, Code2, Cpu, Gauge, GitCompareArrows, History, Layers3, MoveHorizontal, Pause, Play, Radio, Redo2, RotateCcw, Save, Settings2, Sparkles, TimerReset, Undo2, Waypoints, X, Zap } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ForgeScene } from '../components/forge/forge-scene';
import { componentCatalog } from '../lib/forge-data';
import { compileDesignBrief, DEFAULT_DESIGN_PROMPT } from '../lib/forge-prompt';
import { sensorX, useForge, useForgeWebMCP } from '../lib/use-forge';
import type { ForgeState, ForgeToolName, Metrics, SimulationRun, ToolResult, Vec3 } from '../lib/forge-types';

const pause = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
const formatTime = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
export function ForgeTwinApp() {
  const forge = useForge();
  const { state, command, runMachine, moveSensorAsHuman, patchUi, checkpoint, reset, getSnapshot } = forge;
  const registeredTools = useForgeWebMCP(command, runMachine, getSnapshot);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sideTab, setSideTab] = useState<'activity' | 'history'>('activity');
  const [drawer, setDrawer] = useState<'telemetry' | 'compare' | 'catalog' | 'history' | null>(null);
  const [goalOpen, setGoalOpen] = useState(false);
  const [goalPrompt, setGoalPrompt] = useState(DEFAULT_DESIGN_PROMPT);
  const [promptError, setPromptError] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const must = (result: ToolResult) => {
    if (!result.ok) throw new Error(result.error.message);
    return result;
  };
  const call = async (name: ForgeToolName, input: Record<string, unknown> = {}, delay = 105) => {
    const result = must(command(name, input, 'System'));
    await pause(delay);
    return result;
  };

  const updateGoalPrompt = (prompt: string) => {
    setGoalPrompt(prompt);
    setPromptError(null);
  };

  const generateFromPrompt = async (prompt: string) => {
    if (busy) return;
    setGoalPrompt(prompt);
    let plan;
    try {
      plan = compileDesignBrief(prompt);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message.replace(/^[A-Z_]+:\s*/, '') : 'The design brief could not be compiled.';
      setPromptError(message);
      return;
    }
    setBusy(true);
    setError(null);
    setPromptError(null);
    try {
      reset('lab');
      await pause(100);
      await call('inspect_component_catalog', {}, 180);
      await call('set_design_goal', { throughput_bpm: plan.goal.throughputBpm, min_accuracy_pct: plan.goal.minAccuracyPct, max_components: plan.goal.maxComponents, brief: plan.brief }, 160);
      for (const catalogId of plan.componentIds) await call('add_component', { catalog_id: catalogId }, 125);
      await call('connect_components', { source_id: 'sensor-color', source_port: 'signal', target_id: 'diverter-servo', target_port: 'command' }, 130);
      await call('attach_sensor', { sensor_id: 'sensor-color', channel: 'color', target_zone: 'conveyor-main', range: 1.4 }, 110);
      await call('attach_actuator', { actuator_id: 'diverter-servo', target_id: 'diverter-servo', axis: 'y', travel_degrees: 32 }, 110);
      await call('create_control_rule', { sensor_id: 'sensor-color', condition: 'red', actuator_id: 'diverter-servo', priority: 1 }, 90);
      await call('create_control_rule', { sensor_id: 'sensor-color', condition: 'blue', actuator_id: 'diverter-servo', priority: 1 }, 90);
      await call('set_motor_speed', { component_id: 'conveyor-main', speed_mps: plan.motorSpeed }, 90);
      await call('set_actuator_timing', { actuator_id: 'diverter-servo', delay_ms: plan.initialDelayMs, hold_ms: plan.actuatorHoldMs }, 120);
      must(await runMachine('System'));
      const firstRun = getSnapshot().runs.at(-1);
      if (!firstRun) throw new Error('Physics did not return a trial result.');
      if (firstRun.status === 'failed') {
        setToast('Physics rejected revision 1 — the agent is reading the failure');
        await pause(700);
        await call('inspect_telemetry', { run_id: firstRun.id }, 180);
        await call('get_failure_events', { run_id: firstRun.id }, 150);
        await call('inspect_collisions', { run_id: firstRun.id }, 150);
        await call('set_actuator_timing', { actuator_id: 'diverter-servo', delay_ms: firstRun.recommendedDelayMs, hold_ms: plan.actuatorHoldMs }, 200);
        must(await runMachine('System'));
      }
      const finalRun = getSnapshot().runs.at(-1);
      if (finalRun?.status !== 'passed') throw new Error('The compiled design still misses its target. Inspect telemetry before revising the brief.');
      setToast(`Machine generated and verified at ${finalRun.metrics.throughput} boxes/min`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The machine could not be built.');
    } finally {
      setBusy(false);
    }
  };

  const diagnoseAndFix = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const failedRun = getSnapshot().runs.at(-1);
      if (!failedRun) throw new Error('Run the first physics trial before diagnosing it.');
      await call('inspect_telemetry', { run_id: failedRun.id }, 180);
      await call('get_failure_events', { run_id: failedRun.id }, 150);
      await call('inspect_collisions', { run_id: failedRun.id }, 150);
      await call('set_actuator_timing', { actuator_id: 'diverter-servo', delay_ms: failedRun.recommendedDelayMs, hold_ms: getSnapshot().actuatorHoldMs }, 200);
      must(await runMachine('System'));
      const repairedRun = getSnapshot().runs.at(-1);
      if (repairedRun?.status !== 'passed') throw new Error('The timing revision still misses the goal. Review the latest telemetry before making another change.');
      setToast(`Design passes at ${repairedRun.metrics.throughput} boxes/min — now move the sensor to challenge the agent`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The redesign could not finish.');
    } finally {
      setBusy(false);
    }
  };

  const retuneHumanEdit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const before = getSnapshot();
      const sensor = before.components.find((item) => item.id === 'sensor-color');
      if (!sensor?.humanLocked) throw new Error('Drag the color sensor along its cyan rail first.');
      const preservedX = sensor.position[0];
      await call('inspect_workspace', { since_revision: Math.max(0, before.revision - 2) }, 180);
      must(await runMachine('System'));
      const failedRun = getSnapshot().runs.at(-1)!;
      await call('inspect_telemetry', { run_id: failedRun.id }, 150);
      await call('get_failure_events', { run_id: failedRun.id }, 130);
      await call('set_actuator_timing', { actuator_id: 'diverter-servo', delay_ms: failedRun.recommendedDelayMs, hold_ms: getSnapshot().actuatorHoldMs }, 200);
      must(await runMachine('System'));
      const finalState = getSnapshot();
      const finalRun = finalState.runs.at(-1);
      if (finalRun?.status !== 'passed') throw new Error('The retuned machine still misses the goal. Your sensor position remains preserved for another revision.');
      const finalSensorX = sensorX(finalState);
      if (finalSensorX !== preservedX) throw new Error('The shared sensor constraint was not preserved.');
      setToast(`Agent retuned around your sensor at x ${finalSensorX.toFixed(2)} m — final design passed`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The human-edit retune could not finish.');
    } finally {
      setBusy(false);
    }
  };

  const runHeaderSimulation = async () => {
    if (!state.components.length) return generateFromPrompt(goalPrompt);
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await runMachine('System');
    if (!result.ok) setError(result.error.message);
    else setToast(`Physics run ${getSnapshot().phase}`);
    setBusy(false);
  };

  const handleSensorMove = (x: number) => {
    if (busy) return setToast('Wait for the active engineering run to finish');
    const result = moveSensorAsHuman(x);
    if (!result.ok) setError(result.error.message);
    else {
      patchUi({ selectedComponentId: 'sensor-color', replayRunId: null });
      setToast(`Human change saved at x ${x.toFixed(2)} m — previous metrics are now stale`);
    }
  };

  const addOrSelect = useCallback((catalogId: string) => {
    if (busy) return setToast('Wait for the active engineering run to finish');
    const item = componentCatalog.find((candidate) => candidate.catalogId === catalogId)!;
    const existing = state.components.find((component) => component.catalogId === catalogId);
    if (existing) return patchUi({ selectedComponentId: existing.id });
    if (!state.goal) return setToast('Set the design goal or run the guided agent build first');
    const result = command('add_component', { catalog_id: catalogId }, 'UI');
    if (!result.ok) setError(result.error.message);
    else setToast(`${item.name} added`);
  }, [busy, command, patchUi, state.components, state.goal]);

  const undo = () => {
    const target = state.revisions.at(-2);
    if (!target) return setToast('No earlier design revision to restore');
    const result = command('restore_revision', { revision: target.revision }, 'UI');
    if (!result.ok) setError(result.error.message);
    else setToast(`Restored revision ${target.revision} as a new head`);
  };

  useEffect(() => {
    if (state.screen !== 'lab' || busy || drawer) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(target.tagName))) return;
      const index = Number(event.key) - 1;
      const item = componentCatalog[index];
      if (!Number.isInteger(index) || !item || index > 6) return;
      event.preventDefault();
      addOrSelect(item.catalogId);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [addOrSelect, busy, drawer, state.screen]);

  if (state.screen === 'landing') return <Landing state={state} toolCount={registeredTools} prompt={goalPrompt} promptError={promptError} busy={busy} onPromptChange={updateGoalPrompt} onEnter={() => patchUi({ screen: 'lab' })} onGenerate={generateFromPrompt} />;

  const latestRun = state.runs.at(-1) ?? null;
  const firstFailedRun = state.runs.find((run) => run.status === 'failed') ?? null;
  const selected = state.components.find((item) => item.id === state.selectedComponentId) ?? null;
  const humanChallenge = state.phase === 'passed' && !state.humanConstraints.length;
  const humanEdited = state.humanConstraints.length > 0 && (!latestRun || latestRun.designHash !== state.designHash);
  const finalHumanPass = state.phase === 'passed' && state.humanConstraints.length > 0 && latestRun?.designHash === state.designHash;

  return (
    <div className="forge-shell">
      <a className="skip-link" href="#forge-main">Skip to engineering workspace</a>
      <header className="forge-header">
        <button className="brand-lockup" aria-label="ForgeTwin home" onClick={() => patchUi({ screen: 'landing' })} disabled={busy}>
          <span className="brand-mark"><span>F</span></span>
          <span><strong>ForgeTwin</strong><small>AI engineering lab</small></span>
        </button>
        <div className="header-center"><span className="live-dot" />Shared state live <span className="header-divider" /> REV {state.revision.toString().padStart(2, '0')} <span className="header-divider" /> {registeredTools ? `${registeredTools}/18 WebMCP` : '18-tool fallback'}</div>
        <div className="header-actions">
          <button className="ghost-button" disabled={busy} onClick={() => { checkpoint('Manual design checkpoint'); setToast('Revision checkpoint saved'); }}><Save size={14} />Save</button>
          <button className="ghost-button" disabled={busy} onClick={undo}><Undo2 size={14} />Undo</button>
          <button className="ghost-button" disabled={busy} onClick={() => setDrawer('compare')}><GitCompareArrows size={14} />Compare</button>
          <button className="ghost-button" disabled={busy} onClick={() => { reset('landing'); setGoalPrompt(DEFAULT_DESIGN_PROMPT); setPromptError(null); setToast('Demo reset — ready for a new design goal'); }}><RotateCcw size={14} />Reset demo</button>
          <button className="run-button" onClick={runHeaderSimulation} disabled={busy}>{busy ? <Pause size={14} /> : <Play size={14} fill="currentColor" />}{busy ? 'Engineering…' : 'Run simulation'}</button>
        </div>
      </header>

      <main id="forge-main" className="forge-main">
        <aside className="catalog-panel" aria-label="Component catalog">
          <div className="panel-heading"><div><span className="eyebrow">Build inventory</span><h2>Components</h2></div><button aria-label="Open full catalog" onClick={() => setDrawer('catalog')}><Settings2 size={16} /></button></div>
          <div className="capacity"><span>{state.components.length} / {state.goal?.maxComponents ?? 7} placed</span><span>{Math.max(0, (state.goal?.maxComponents ?? 7) - state.components.length)} slots left</span><i><b style={{ width: `${Math.min(100, state.components.length / (state.goal?.maxComponents ?? 7) * 100)}%` }} /></i></div>
          <div className="catalog-list">
            {componentCatalog.slice(0, 7).map((item, index) => {
              const placed = state.components.some((component) => component.catalogId === item.catalogId);
              const Icon = item.kind === 'color_sensor' ? CircleDot : item.kind === 'servo_diverter' ? Zap : item.kind === 'bin' ? Box : item.kind === 'conveyor' ? Layers3 : Waypoints;
              return <button className={`catalog-card ${placed ? 'placed' : ''}`} key={item.catalogId} onClick={() => addOrSelect(item.catalogId)} aria-pressed={placed} disabled={busy}>
                <span className="catalog-icon"><Icon size={17} /></span><span><strong>{item.name}</strong><small>{placed ? 'Placed · select' : item.description}</small></span>{placed ? <Check size={12} /> : <kbd>{index + 1}</kbd>}
              </button>;
            })}
          </div>
          <div className="constraint-card">
            <span className="eyebrow">Design goal</span>
            <p>Sort red and blue boxes at <strong>{state.goal?.throughputBpm ?? 20}+ boxes/min</strong>, <strong>{state.goal?.minAccuracyPct ?? 95}% accuracy</strong>, using no more than <strong>{state.goal?.maxComponents ?? 7} components.</strong></p>
            {state.goal?.brief && <blockquote>“{state.goal.brief}”</blockquote>}
            <button onClick={() => setGoalOpen((value) => !value)} aria-expanded={goalOpen}>Inspect constraints <ChevronDown size={14} className={goalOpen ? 'rotate-180' : ''} /></button>
            {goalOpen && <ul className="constraint-list"><li><Check size={11} />Deterministic seed 424242</li><li><Check size={11} />60 Hz fixed physics step</li><li><Check size={11} />Zero jams and harmful collisions</li></ul>}
          </div>
          {selected?.id === 'sensor-color' && <SensorInspector state={state} onMove={handleSensorMove} busy={busy} />}
        </aside>

        <section className="viewport-panel" aria-label="3D machine workspace">
          <ForgeScene state={state} onSensorMove={handleSensorMove} onSelect={(id) => patchUi({ selectedComponentId: id || null })} />
          <div className="viewport-topbar">
            <div className="scene-path"><span>Machine 01</span><i>/</i><strong>Chromatic sorter</strong>{selected && <><i>/</i><b>{selected.name}</b></>}</div>
            <div className="view-controls">
              <button onClick={() => patchUi({ xray: !state.xray })} aria-pressed={state.xray} className={state.xray ? 'active' : ''}><Layers3 size={14} />X-Ray</button>
              <button onClick={() => setDrawer('telemetry')}><Gauge size={14} />Telemetry</button>
              <button onClick={() => { setSideTab('history'); setDrawer('history'); }}><History size={14} />Revisions</button>
            </div>
          </div>
          <div className="viewport-status"><span className="live-dot cyan" />RAPIER PHYSICS <i />60 HZ <i />SEED 424242</div>

          {!state.components.length && <div className="empty-machine-card"><span className="goal-avatar"><Sparkles size={18} /></span><span className="eyebrow">Agent-ready workspace</span><h1>Give the AI a goal.<br />Watch it engineer.</h1><p>Describe a red-and-blue package sorter. ForgeTwin will compile the brief, choose every part, wire its controls, run physics, and retune failures.</p><GoalComposer id="lab-design-goal" prompt={goalPrompt} error={promptError} busy={busy} compact onPromptChange={updateGoalPrompt} onGenerate={generateFromPrompt} /></div>}

          {state.phase === 'failed' && latestRun && <FailureBanner run={latestRun} onReplay={() => patchUi({ replayRunId: latestRun.id, replayMode: 'failure' })} onFix={diagnoseAndFix} busy={busy} />}
          {humanChallenge && <div className="challenge-banner"><span className="challenge-icon"><MoveHorizontal size={18} /></span><div><span className="eyebrow">Generated + physics verified</span><strong>Now challenge the agent with a human edit.</strong><p>Replay its first failure, or drag the cyan sensor and make it retune without moving your work back.</p></div><div className="challenge-actions">{firstFailedRun && <button className="secondary" onClick={() => patchUi({ replayRunId: firstFailedRun.id, replayMode: 'failure' })}><TimerReset size={13} />Replay failure</button>}<button onClick={() => { patchUi({ selectedComponentId: 'sensor-color', xray: true }); setToast('Drag the cyan bridge in 3D, or use its keyboard controls'); }}>Select sensor</button></div></div>}
          {humanEdited && <div className="challenge-banner human"><span className="challenge-icon"><Radio size={18} /></span><div><span className="eyebrow">Human edit detected</span><strong>Sensor locked at x {sensorX(state).toFixed(2)} m.</strong><p>Old timing is stale. The agent will preserve this position, measure the miss, and retune.</p></div><button onClick={retuneHumanEdit} disabled={busy}>{busy ? 'Retuning…' : 'Retune around my change'}</button></div>}
          {finalHumanPass && <div className="pass-banner"><span><BadgeCheck size={20} /></span><div><strong>Goal passed with the human edit preserved.</strong><p>{latestRun!.metrics.throughput} boxes/min · {latestRun!.metrics.accuracy}% accuracy · sensor x {sensorX(state).toFixed(2)} m</p></div><button onClick={() => setDrawer('compare')}>Compare designs</button></div>}
        </section>

        <aside className="agent-panel" aria-label="Agent activity">
          <div className="side-tabs"><button className={sideTab === 'activity' ? 'active' : ''} onClick={() => setSideTab('activity')}><Activity size={13} />Activity</button><button className={sideTab === 'history' ? 'active' : ''} onClick={() => setSideTab('history')}><History size={13} />History</button></div>
          {sideTab === 'activity' ? <AgentFeed state={state} toolCount={registeredTools} /> : <RevisionHistory state={state} onRestore={(revision) => { const result = command('restore_revision', { revision }, 'UI'); if (result.ok) setToast(`Revision ${revision} restored`); else setError(result.error.message); }} />}
          <MetricStack metrics={latestRun?.metrics ?? null} phase={state.phase} maxComponents={state.goal?.maxComponents ?? 7} />
        </aside>
      </main>

      {error && <div className="error-toast" role="alert"><AlertTriangle size={15} /><span>{error}</span><button onClick={() => setError(null)} aria-label="Dismiss error"><X size={14} /></button></div>}
      {toast && <div className="success-toast" role="status"><Check size={14} />{toast}</div>}
      {drawer && <Drawer type={drawer} state={state} onClose={() => setDrawer(null)} onRestore={(revision) => { const result = command('restore_revision', { revision }, 'UI'); if (result.ok) setToast(`Revision ${revision} restored`); else setError(result.error.message); }} />}
      <div className="sr-only" aria-live="polite">{busy ? 'Agent is operating the shared engineering workspace' : toast ?? error ?? ''}</div>
    </div>
  );
}

function Landing({ state, toolCount, prompt, promptError, busy, onPromptChange, onEnter, onGenerate }: { state: ForgeState; toolCount: number; prompt: string; promptError: string | null; busy: boolean; onPromptChange: (prompt: string) => void; onEnter: () => void; onGenerate: (prompt: string) => void }) {
  return <div className="landing-shell">
    <header className="landing-nav"><button className="brand-lockup" aria-label="ForgeTwin home" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}><span className="brand-mark"><span>F</span></span><span><strong>ForgeTwin</strong><small>AI engineering lab</small></span></button><div><span className="landing-status"><i />Rapier + WebMCP ready</span><button className="ghost-button" onClick={onEnter}>Open workspace</button></div></header>
    <main className="landing-hero">
      <div className="hero-copy"><span className="hero-kicker"><Sparkles size={13} />Agent-native digital twin engineering</span><h1>Don’t generate it.<br /><em>Engineer it.</em></h1><p>Describe a red-and-blue package-sorting goal. ForgeTwin compiles the brief into measurable constraints, selects every component, wires controls, then runs and repairs the machine in real physics.</p><GoalComposer id="design-goal" prompt={prompt} error={promptError} busy={busy} onPromptChange={onPromptChange} onGenerate={onGenerate} /><div className="hero-actions"><button className="ghost-button hero-secondary" onClick={onEnter} type="button"><Code2 size={15} />Explore empty lab</button></div><div className="hero-proof"><span><strong>18</strong> scoped WebMCP tools</span><span><strong>60 Hz</strong> fixed physics</span><span><strong>7</strong> generated parts</span></div></div>
      <div className="hero-machine"><ForgeScene state={state} preview onSensorMove={() => undefined} onSelect={() => undefined} /><div className="hero-hud top"><span>LIVE DIGITAL TWIN</span><strong>PROMPT → PARTS → PHYSICS</strong></div><div className="hero-hud bottom"><span>VALIDATED ENVELOPE</span><strong>5–40 BOXES / MIN</strong></div><div className="hero-orbit-label one"><i />Sensor beam</div><div className="hero-orbit-label two"><i />Servo path</div></div>
    </main>
    <section className="landing-strip" aria-label="How ForgeTwin works"><article><Cpu size={17} /><div><strong>Agent builds</strong><span>Small WebMCP actions assemble a real design.</span></div></article><article><AlertTriangle size={17} /><div><strong>Physics rejects</strong><span>Collisions and jams become evidence, not vibes.</span></div></article><article><Redo2 size={17} /><div><strong>Telemetry teaches</strong><span>The agent measures, retunes, and proves the fix.</span></div></article><small>{toolCount ? `${toolCount}/18 tools registered in this browser` : 'Deterministic UI orchestrator available without an external agent'}</small></section>
  </div>;
}

function GoalComposer({ id, prompt, error, busy, compact = false, onPromptChange, onGenerate }: { id: string; prompt: string; error: string | null; busy: boolean; compact?: boolean; onPromptChange: (prompt: string) => void; onGenerate: (prompt: string) => void }) {
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  return <form className={`goal-composer ${compact ? 'compact' : ''}`} aria-busy={busy} onSubmit={(event) => { event.preventDefault(); onGenerate(prompt); }}>
    <label htmlFor={id}>What should ForgeTwin engineer?</label>
    <textarea id={id} value={prompt} onChange={(event) => onPromptChange(event.target.value)} maxLength={500} rows={compact ? 4 : 3} aria-describedby={`${hintId}${error ? ` ${errorId}` : ''}`} aria-invalid={Boolean(error)} disabled={busy} />
    <div className="goal-composer-meta"><span id={hintId}>{prompt.length}/500 · red/blue sorting cell · 5–40 boxes/min</span><button className="run-button hero" type="submit" disabled={busy || prompt.trim().length < 12}><Sparkles size={15} />{busy ? 'Engineering…' : 'Generate everything'}</button></div>
    {error && <p className="goal-error" id={errorId} role="alert"><AlertTriangle size={13} />{error}</p>}
  </form>;
}

function FailureBanner({ run, onReplay, onFix, busy }: { run: ForgeState['runs'][number]; onReplay: () => void; onFix: () => void; busy: boolean }) {
  const collision = run.collisions[0];
  return <div className="failure-banner"><span className="failure-icon"><AlertTriangle size={19} /></span><div><span className="eyebrow">Trial {run.id} · failed</span><strong>{collision ? 'Diverter impact at the decision point.' : 'Machine missed the goal.'}</strong><p>{run.metrics.collisions} collisions · {run.metrics.jams} jams · measured travel {run.sensorToDiverterMs} ms</p></div><button onClick={onReplay}><TimerReset size={13} />Replay 0.25×</button><button className="fix" onClick={onFix} disabled={busy}><Sparkles size={13} />{busy ? 'Diagnosing…' : 'Diagnose & fix'}</button></div>;
}

function SensorInspector({ state, onMove, busy }: { state: ForgeState; onMove: (x: number) => void; busy: boolean }) {
  const x = sensorX(state);
  return <div className="sensor-inspector"><span className="eyebrow">Selected · RGB sensor</span><div><strong>Rail position</strong><code>x {x.toFixed(2)} m</code></div><input aria-label="Color sensor rail position" type="range" min="-3.1" max="0.2" step="0.05" value={x} onChange={(event) => onMove(Number(event.target.value))} onKeyDown={(event) => { if (event.key === 'Escape') event.currentTarget.blur(); }} disabled={busy || state.phase === 'simulating'} /><div className="nudge-row"><button disabled={busy} onClick={() => onMove(x - .1)} aria-label="Move sensor left 0.1 meters"><ArrowLeft size={12} />0.1 m</button><button disabled={busy} onClick={() => onMove(x + .1)} aria-label="Move sensor right 0.1 meters">0.1 m<ArrowRight size={12} /></button></div>{state.components.find((item) => item.id === 'sensor-color')?.humanLocked && <p><Radio size={11} />Human-position lock active</p>}</div>;
}

function AgentFeed({ state, toolCount }: { state: ForgeState; toolCount: number }) {
  return <div className="feed-wrap"><div className="panel-heading"><div><span className="eyebrow">WebMCP session</span><h2>Agent activity</h2></div><span className="agent-live"><i />{toolCount ? 'LIVE' : 'FALLBACK'}</span></div>{state.activity.length ? <ol className="activity-list">{state.activity.slice(0, 12).map((event) => <li key={event.id} className={event.outcome}><span>{event.tool === 'run_simulation' ? <Activity size={14} /> : event.actor === 'Human' ? <MoveHorizontal size={14} /> : <Cpu size={14} />}</span><div><code>{event.tool}</code><p>{event.detail}</p><small>{event.actor === 'WebMCP' ? 'External agent' : event.actor === 'Human' ? 'Human' : event.actor === 'System' ? 'ForgeTwin agent' : 'Guided UI'}</small></div><time>{formatTime(event.at)}</time></li>)}</ol> : <div className="empty-feed"><Cpu size={23} /><strong>No tool calls yet</strong><p>Enter a design goal or connect an external agent through WebMCP.</p></div>}<div className="tool-footer"><span>{toolCount || 18}/18 tools ready</span><code>shared revision {state.revision}</code></div></div>;
}

function MetricStack({ metrics, phase, maxComponents }: { metrics: Metrics | null; phase: ForgeState['phase']; maxComponents: number }) {
  const values = metrics ?? { throughput: 0, accuracy: 0, collisions: 0, jams: 0, componentCount: 0, cycleTime: 0, delivered: 0, spawned: 0 };
  return <div className="metric-stack"><div className="metric-title"><span className="eyebrow">Measured output</span><span className={`phase-chip ${phase}`}>{phase}</span></div><div className="metric-grid"><div><small>Throughput</small><strong>{metrics ? values.throughput : '—'}<em>/min</em></strong></div><div><small>Accuracy</small><strong>{metrics ? values.accuracy : '—'}<em>%</em></strong></div><div className={values.collisions ? 'danger' : ''}><small>Collisions</small><strong>{values.collisions}</strong></div><div className={values.jams ? 'danger' : ''}><small>Jams</small><strong>{values.jams}</strong></div><div><small>Components</small><strong>{values.componentCount}<em>/{maxComponents}</em></strong></div><div><small>Cycle time</small><strong>{metrics ? values.cycleTime : '—'}<em>s</em></strong></div></div></div>;
}

function RevisionHistory({ state, onRestore }: { state: ForgeState; onRestore: (revision: number) => void }) {
  return <div className="history-wrap"><div className="panel-heading"><div><span className="eyebrow">Immutable snapshots</span><h2>Version history</h2></div><Clock3 size={15} /></div>{state.revisions.length ? <ol className="revision-list">{[...state.revisions].reverse().slice(0, 12).map((item, index) => <li key={item.id}><i className={index === 0 ? 'current' : ''} /><div><strong>REV {item.revision.toString().padStart(2, '0')}</strong><span>{item.label}</span><small>{item.actor} · {formatTime(item.at)}</small></div>{index > 0 && <button onClick={() => onRestore(item.revision)}>Restore</button>}</li>)}</ol> : <div className="empty-feed"><History size={23} /><strong>No revisions yet</strong><p>Design changes will appear here automatically.</p></div>}</div>;
}

function configurationForRun(state: ForgeState, run: SimulationRun): SimulationRun['configuration'] {
  const stored = (run as SimulationRun & { configuration?: SimulationRun['configuration'] }).configuration;
  if (stored) return stored;
  const revision = [...state.revisions].reverse().find((item) => item.designHash === run.designHash);
  return {
    sensorPosition: [...(revision?.components.find((component) => component.id === 'sensor-color')?.position ?? [-0.8, 1.05, 0])] as Vec3,
    motorSpeed: revision?.motorSpeed ?? state.motorSpeed,
    actuatorDelayMs: revision?.actuatorDelayMs ?? state.actuatorDelayMs,
    actuatorHoldMs: revision?.actuatorHoldMs ?? state.actuatorHoldMs,
    componentCount: revision?.components.length ?? run.metrics.componentCount,
  };
}

function Drawer({ type, state, onClose, onRestore }: { type: 'telemetry' | 'compare' | 'catalog' | 'history'; state: ForgeState; onClose: () => void; onRestore: (revision: number) => void }) {
  const latest = state.runs.at(-1);
  const baseline = [...state.runs].reverse().find((run) => run.status === 'failed' && run.id !== latest?.id);
  const latestConfiguration = latest ? configurationForRun(state, latest) : null;
  const baselineConfiguration = baseline ? configurationForRun(state, baseline) : null;
  const humanTransformPreserved = Boolean(
    latest?.status === 'passed'
    && latest.designHash === state.designHash
    && baselineConfiguration
    && latestConfiguration
    && state.components.some((component) => component.id === 'sensor-color' && component.humanLocked)
    && Math.abs(baselineConfiguration.sensorPosition[0] - latestConfiguration.sensorPosition[0]) < 0.001
    && Math.abs(latestConfiguration.sensorPosition[0] - sensorX(state)) < 0.001
    && baselineConfiguration.actuatorDelayMs !== latestConfiguration.actuatorDelayMs,
  );
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = document.querySelector<HTMLElement>('.drawer');
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog?.querySelector<HTMLElement>('button[aria-label="Close panel"]')?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !dialog) return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, []);
  return <div className="drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="drawer" role="dialog" aria-modal="true" aria-label={`${type} panel`}><header><div><span className="eyebrow">ForgeTwin analysis</span><h2>{type === 'telemetry' ? 'Physics telemetry' : type === 'compare' ? 'Compare designs' : type === 'history' ? 'Version history' : 'Component catalog'}</h2></div><button onClick={onClose} aria-label="Close panel"><X size={17} /></button></header>{type === 'telemetry' && <div className="drawer-content">{latest ? <><div className="telemetry-hero"><Gauge size={21} /><div><strong>{latest.status === 'passed' ? 'Goal envelope satisfied' : 'Failure window captured'}</strong><span>{latest.physics.engine} · {latest.physics.timestepHz} Hz · {latest.physics.simulatedSeconds}s simulated</span></div></div><div className="telemetry-cards"><div><small>Sensor → diverter</small><strong>{latest.sensorToDiverterMs} ms</strong></div><div><small>Recommended delay</small><strong>{latest.recommendedDelayMs} ms</strong></div><div><small>Commanded delay</small><strong>{latestConfiguration?.actuatorDelayMs ?? state.actuatorDelayMs} ms</strong></div></div><h3>Failure events</h3>{latest.failures.length ? latest.failures.slice(0, 8).map((event) => <article className="event-row" key={event.id}><span>{event.time.toFixed(2)}s</span><div><strong>{event.title}</strong><p>{event.detail}</p></div></article>) : <div className="clean-run"><BadgeCheck size={18} />No failure events in this run.</div>}</> : <div className="empty-feed"><Gauge size={23} /><strong>No telemetry yet</strong><p>Run a simulation to populate measured channels.</p></div>}</div>}{type === 'compare' && <div className="drawer-content">{baseline && latest ? <><div className="compare-head"><span>Failed design</span><GitCompareArrows size={18} /><span>Current design</span></div><CompareMetric label="Throughput" before={`${baseline.metrics.throughput}/min`} after={`${latest.metrics.throughput}/min`} good={latest.metrics.throughput > baseline.metrics.throughput} /><CompareMetric label="Accuracy" before={`${baseline.metrics.accuracy}%`} after={`${latest.metrics.accuracy}%`} good={latest.metrics.accuracy > baseline.metrics.accuracy} /><CompareMetric label="Collisions" before={String(baseline.metrics.collisions)} after={String(latest.metrics.collisions)} good={latest.metrics.collisions < baseline.metrics.collisions} /><CompareMetric label="Jams" before={String(baseline.metrics.jams)} after={String(latest.metrics.jams)} good={latest.metrics.jams < baseline.metrics.jams} /><CompareMetric label="Sensor position" before={baselineConfiguration ? `${baselineConfiguration.sensorPosition[0].toFixed(2)} m` : '—'} after={latestConfiguration ? `${latestConfiguration.sensorPosition[0].toFixed(2)} m` : '—'} good /><CompareMetric label="Actuator delay" before={baselineConfiguration ? `${baselineConfiguration.actuatorDelayMs.toLocaleString()} ms` : '—'} after={latestConfiguration ? `${latestConfiguration.actuatorDelayMs.toLocaleString()} ms` : '—'} good />{humanTransformPreserved && <div className="preserved-note"><MoveHorizontal size={16} /><span><strong>Human transform preserved.</strong>The agent changed timing, not the sensor position.</span></div>}</> : <div className="empty-feed"><GitCompareArrows size={23} /><strong>Two runs are needed</strong><p>Run the failing design and its redesign to compare results.</p></div>}</div>}{type === 'catalog' && <div className="drawer-content catalog-drawer">{componentCatalog.map((item) => <article key={item.catalogId}><span style={{ background: item.color }} /><div><strong>{item.name}</strong><p>{item.description}</p><small>{item.capabilities.join(' · ')}</small></div><code>MAX {item.quantityLimit}</code></article>)}</div>}{type === 'history' && <div className="drawer-content"><RevisionHistory state={state} onRestore={onRestore} /></div>}<footer><span>{state.revisions.length} revisions · {state.runs.length} physics runs</span>{state.revisions.length > 1 && <button onClick={() => onRestore(state.revisions.at(-2)!.revision)}>Restore previous</button>}</footer></section></div>;
}

function CompareMetric({ label, before, after, good }: { label: string; before: string; after: string; good: boolean }) {
  return <div className="compare-row"><span>{label}</span><strong>{before}</strong><ArrowRight size={13} /><strong className={good ? 'good' : ''}>{after}</strong></div>;
}
