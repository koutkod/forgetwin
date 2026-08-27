# ForgeTwin — Don’t generate it. Engineer it.

ForgeTwin is a browser-based AI engineering lab where a human and an external agent build, test, and improve a working machine through WebMCP. The hackathon demo tackles one concrete brief:

> Build a machine that sorts red and blue boxes into separate bins at 20+ boxes per minute using no more than 7 components.

This is not a rendered concept or a scripted success animation. ForgeTwin runs a deterministic Rapier rigid-body simulation. The first machine fails because the diverter fires too late; telemetry exposes the measured travel time and collision events; the agent retunes the actuator; and the second run passes. The human can then move the sensor and the agent must adapt to that shared change without undoing it.

## Why ForgeTwin

Generative tools are good at producing plausible pictures of machines. Engineering requires a harder loop: manipulate a shared design, execute it against physical constraints, observe measurable failure, preserve human intent, and revise until the requirements are met.

ForgeTwin makes that loop legible. Every edit is versioned, every simulation produces telemetry, every agent action appears in the activity feed, and every pass or failure is derived from the same canonical workspace the human sees.

## Judge-ready demo

1. Select **Watch the AI engineer** on the opening screen.
2. ForgeTwin creates the sorter, adds exactly seven components, connects the sensor and servo, installs a control rule, and runs the first simulation.
3. The first revision fails deterministically: packages collide at the diverter because its 1,040 ms timing is later than the measured 1,033 ms sensor-to-gate travel window.
4. Select **Replay failure** for a 0.25× slow-motion replay with collision telemetry, or toggle **X-Ray** to reveal sensor beams, collider volumes, velocity vectors, joints, and the diverter path.
5. Select **Diagnose & fix**. The agent reads telemetry, retunes the diverter to 828 ms, and reruns the physical simulation.
6. The revised machine passes at 41.4 boxes/minute, 100% sorting accuracy, zero collisions, zero jams, and seven components.
7. For the human-agent challenge, select the color sensor and drag it left in the 3D scene (or use the accessible position control). ForgeTwin records a human-owned transform.
8. Select **Retune around my edit**. The old timing now fails, the agent detects the new shared state, calculates a new 1,445 ms command, and passes again without moving the sensor back.
9. Open **Compare** to inspect the before/after design, metric deltas, timing change, and preserved human constraint.
10. Use **Reset demo** to return to the exact judging start state.

The scenario uses a fixed seed, fixed 60 Hz timestep, and an 18-second simulation window, so it remains reliable without external services.

## Architecture

```text
Human controls ─────┐
                    ├──► canonical versioned workspace ──► React Three Fiber scene
External WebMCP ────┘                  │
                                       ├──► guarded command engine
                                       ├──► Rapier rigid-body simulation
                                       └──► telemetry + events + revisions
                                                      │
                                activity feed ◄───────┴──────► compare / restore
```

- **Next.js + TypeScript** provide the application shell and typed client architecture.
- **Tailwind CSS** and custom component styles deliver the responsive futuristic lab UI.
- **React Three Fiber + Three.js** render the live digital twin and replay timeline.
- **Rapier** is the authoritative simulation layer. Boxes are rigid bodies, the conveyor advances them at the configured motor speed, and collisions/jams are derived from physical positions and actuator timing.
- **Zod** validates every public tool input before a state transition.
- **WebMCP** exposes small engineering primitives over the same state as the human UI.
- **localStorage** preserves the current workspace across refreshes; no account, backend, or network API is required for the demo.

Key modules:

- `components/forge/forge-scene.tsx` — interactive 3D workspace, playback, selection, human sensor movement, and X-Ray overlays.
- `lib/forge-simulation.ts` — deterministic Rapier simulation and failure telemetry.
- `lib/forge-engine.ts` — versioned command engine, revision guards, ownership constraints, undo/restore, and comparisons.
- `lib/use-forge.ts` — shared React state, persistence, WebMCP registration, and activity events.
- `app/forgetwin-app.tsx` — landing screen, lab controls, metrics, telemetry, failure replay, history, and guided demo orchestration.

## WebMCP is the product boundary

ForgeTwin deliberately does not expose a single `build_machine` or `solve_design` shortcut. An agent must work through the same inspect → edit → simulate → diagnose → revise loop as a human. The page registers these tools through `document.modelContext`:

| Tool | Responsibility |
| --- | --- |
| `inspect_workspace` | Read the canonical design, revision, ownership locks, goal, and latest run. |
| `inspect_component_catalog` | Discover available components and constraints. |
| `set_design_goal` | Define the measurable throughput, accuracy, and component budget. |
| `add_component` | Add one catalog component to the active design. |
| `move_component` | Move a component while respecting human-owned transforms. |
| `rotate_component` | Rotate a component while respecting ownership constraints. |
| `connect_components` | Create a typed machine connection. |
| `attach_sensor` | Bind a sensor to a control target. |
| `attach_actuator` | Bind an actuator to its machine role. |
| `create_control_rule` | Create the color-routing rule. |
| `set_motor_speed` | Tune conveyor velocity. |
| `set_actuator_timing` | Tune the servo command delay. |
| `run_simulation` | Execute the deterministic Rapier trial and store its result. |
| `inspect_telemetry` | Read measured timing, throughput, accuracy, and recommendations. |
| `get_failure_events` | Read jams, wrong-bin events, and timing failures. |
| `inspect_collisions` | Read collision pairs, timestamps, positions, and impulses. |
| `compare_designs` | Compare two immutable revisions and their simulation metrics. |
| `restore_revision` | Restore a design while preserving later human-owned transforms. |

All mutating tools require `expectedRevision` and `workspaceNonce`. Stale agents receive a structured `STALE_REVISION` or `WORKSPACE_REPLACED` error instead of silently overwriting newer human work. Read tools report current ownership metadata, and agent mutations cannot move a component whose transform was claimed by a human.

## Shared-state human challenge

When a human moves the sensor, ForgeTwin records the transform with `owner: human`, creates a revision, invalidates the prior simulation, and surfaces the change to `inspect_workspace`. The agent must recompute the sensor-to-diverter travel time and retune the actuator. Moving the sensor back is rejected by the command engine, including after revision restore.

This is the important WebMCP idea: the browser is not merely a display for an agent. It is a shared, stateful engineering environment with explicit concurrency and ownership semantics.

## Safety and determinism

- Tool inputs are schema-validated and bounded.
- Every mutation uses optimistic concurrency guards.
- Runs are deterministic from a fixed seed and fixed timestep.
- Pass/fail is calculated from telemetry, not supplied by a caller.
- Component count, throughput, accuracy, collisions, and jams all contribute to the goal verdict.
- Human-owned transforms survive agent edits and revision restores.
- The demo has no network dependency and no hidden external action.
- Reset replaces the workspace nonce, preventing an old agent context from mutating a new demo.

## Accessibility

- Semantic landmarks, labels, and native buttons.
- Visible keyboard focus and reduced-motion support.
- Keyboard-selectable components and accessible sensor position controls.
- Status text accompanies every color-coded state.
- Live regions announce simulation and agent progress.
- Responsive desktop, tablet, and mobile layouts.
- Canvas content has a text alternative, with all essential data duplicated in accessible controls and telemetry.

## Run locally

Requirements: Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

Open `http://localhost:3000/`.

Quality checks:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

No API key is required. `NEXT_PUBLIC_SITE_ORIGIN` is optional and only controls the canonical base URL used by social metadata.

> The AI didn’t generate a picture of a machine. It engineered one, watched it fail, learned from the physics, and fixed it.
