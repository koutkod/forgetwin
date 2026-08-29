# ForgeTwin — Don’t generate it. Engineer it.

ForgeTwin is a browser-based, agent-native engineering sandbox. A person describes a physical goal; the in-app engineering agent composes a new mechanical world from reusable primitives, assigns physical properties, connects joints and controls, runs deterministic physics, measures failures, and changes the causal parts until the stated constraints pass.

The runtime is explicit about what is doing the work:

- **Model agent** — when `OPENAI_API_KEY` is configured on the server, or a user connects a temporary key for the current tab, GPT-5.6 Sol interprets the brief, edits the current world from chat, and selects the failure-analysis/redesign tool loop. `OPENAI_MODEL` can override the default.
- **Local deterministic engineer** — when no model key is available, ForgeTwin remains fully functional and runs the compositional planner, guarded tools, Rapier simulation, and bounded evidence-driven optimizer locally. The UI labels this mode honestly; it is never presented as a connected model.
- **External WebMCP agent** — in a browser host that implements `document.modelContext`, all scoped tools are registered against the same live world. A normal browser without that host is reported as “WebMCP host not connected.”

There is no conveyor-first workflow and no catalog of complete machines. The same world model can compose conveyors, cranes, lifts, rovers, robotic mechanisms, gear trains, suspension, solar trackers, structural spans, warehouse systems, agricultural equipment, factory buffers, medical lifting concepts, recycling systems, or a novel mechanism assembled from lower-level bodies.

## The core loop

```text
free-form goal
     ↓
capabilities + measurable constraints
     ↓
assemblies → primitive bodies → physical properties
     ↓
joints + sensors + actuators + control graph
     ↓
60 Hz Rapier world → telemetry + contacts + constraint verdicts
     ↓
evidence-driven redesign → rerun
```

Try prompts such as:

- “Build a crane that lifts an 80 kg beam by 2 meters without tipping.”
- “Design a 4:1 gearbox with 120 rpm input and at least 80 N·m output torque.”
- “Build a rover that carries 5 kg across uneven terrain in under 20 seconds.”
- “Create an 8 meter bridge that supports 3,000 kg with less than 6 mm deflection.”
- “Build an automatic rotating hatch with an obstruction sensor.”

The examples in the UI are editable briefs, not hidden design templates. Prompt dimensions and targets change the generated graph. When a semantic part is unavailable, the planner builds it from beams, plates, shafts, joints, motors, sensors, and other lower-level primitives.

Compound briefs are composed, not classified into one machine bucket. For example, a gearbox-driven crane contains separate transmission and suspension assemblies with a power edge from the output shaft to the hoist drive; a rover-mounted arm combines rolling support and serial-linkage assemblies. Explicit requests such as gears, pistons, cameras, pulleys, or counterweights are preserved and integrated into the generated graph.

## Shared world model

The canonical workspace is a versioned graph:

- **World** — gravity, fixed timestep, duration, bounds, environment, and deterministic seed.
- **Assemblies** — hierarchical groupings with purpose and component membership.
- **Components** — primitive kind, shape, dimensions, transform, material, mass, rigid-body type, and parameters.
- **Topology** — mechanical, signal, and power connections plus fixed, revolute, prismatic, spherical, spring, rope, gear, and belt joints.
- **Devices** — per-instance motors, sensors, and actuators.
- **Control** — declarative PID, threshold, tracking, timed, synchronized, and state-machine rules.
- **Evidence** — telemetry samples, collision events, failures, replay frames, measurements, and optimization actions.
- **Collaboration** — immutable revisions, design hashes, optimistic concurrency, and human-owned field locks.

The 3D editor, in-app agent, and any connected external WebMCP agent operate on this same state. Selecting, moving, rotating, resizing, or changing the material of a body creates a real revision; it is not a cosmetic scene override.

## Why WebMCP is essential

ForgeTwin exposes small, state-aware engineering operations instead of one opaque `build_machine` shortcut. An external agent can inspect and change the same physical world the human sees.

| Tools | Responsibility |
| --- | --- |
| `inspect_workspace`, `inspect_primitive_catalog`, `set_design_goal` | Read shared state and establish the typed goal. |
| `create_assembly`, `create_component` | Construct a hierarchy and add one primitive body at a time. |
| `set_dimensions`, `set_material`, `set_mass` | Define causal physical properties. |
| `move_component`, `rotate_component` | Place bodies while respecting human locks. |
| `connect_components`, `create_joint` | Create topology, anchors, axes, limits, ratios, stiffness, and damping. |
| `add_motor`, `add_sensor`, `add_actuator`, `set_control_logic` | Build the sensing, actuation, and control graph. |
| `run_simulation` | Execute the current immutable design revision. |
| `inspect_telemetry`, `inspect_failure`, `measure_constraint` | Read evidence rather than guessing from appearance. |
| `optimize_design` | Apply a bounded redesign to evidence-linked physical or control fields. |
| `remove_component`, `remove_joint` | Change topology safely with referential cleanup. |
| `compare_designs`, `restore_revision` | Compare and restore versioned worlds. |

Every mutating call is Zod-validated and guarded by the current workspace nonce and revision. A stale agent cannot overwrite newer human work. Resetting the sandbox rotates the nonce, so an old agent context cannot mutate the new world. WebMCP registration waits for local state hydration so persisted state cannot overwrite an early external-agent action.

## Physics and measurement

- Every physical component receives a Rapier rigid body and collider using its transform, shape, material friction/restitution, and mass.
- Supported physical joints are instantiated between bodies; motors and actuators drive dynamic bodies during fixed 60 Hz trials.
- Rapier’s collision event queue supplies contact evidence and replay markers.
- Graph-derived analysis measures quantities such as total mass, center of mass, footprint, payload capacity, lift height, stability, reach, torque margin, ratio, speed, traction, tracking error, throughput, collisions, structural capacity, and deflection.
- The first bounded design is allowed to fail. The optimizer reads the failing measurement and modifies relevant fields—such as control gains, actuator force, motor torque, spring properties, counterweight mass, or structural section depth—before rerunning the same world.
- Optimization pass count is provenance only: it is not an input to physics or any verdict. Unsupported measurement names are rejected instead of receiving a fabricated score.
- Seed `424242` and a deterministic fallback make the judging sequence repeatable without an external API.

Gear/belt power transmission and structural stress use disclosed reduced-order engineering proxies around the real rigid-body world. ForgeTwin is a concept-level digital-twin lab, not production CAD, FEA, CFD, medical approval, or safety certification.

## Human-agent collaboration

After a design passes, drag or edit a component. ForgeTwin marks the changed physical field as human-owned and invalidates the prior calibration. The agent detects the new design hash, simulates the modified world, and redesigns surrounding unlocked fields without moving the human component back. Compare and version-history views make the preservation visible.

The **Edit with chat** panel changes the existing world rather than silently starting over. Requests such as “lengthen the boom,” “widen the outriggers,” “move the sensor up 0.5 m,” “use aluminum for the gripper,” or “add another support” compile into small guarded component/joint operations. ForgeTwin commits the revision, runs physics, and—if the edit breaks a constraint—uses the same evidence-driven redesign loop. A bounded deterministic chat interpreter covers common geometry, transform, mass, material, add, and remove requests when no model key is connected.

The renderer uses the same primitive graph to produce industrial frames, rounded structural members, geared shafts, grooved pulleys, rigging, wheels with hubs and tread, drive housings, crates, solar panels, conveyors, supports, and control devices. Camera framing is derived from the current world bounds, so a compact gearbox and a tall crane both fill the workspace without machine-specific camera presets.

## Security model

- The design brief is treated as untrusted data, never executable instructions. The model route wraps it as design data and rejects model output that does not match the strict planning or redesign schema.
- Control expressions are declarative text and numeric parameters; arbitrary JavaScript is never evaluated.
- IDs, transforms, dimensions, materials, masses, joints, limits, ratios, forces, speeds, and control values are schema-validated and bounded.
- The simulator rejects incomplete motion systems and broken references rather than substituting a hidden template.
- Optimistic concurrency prevents stale writes; human locks survive agent actions and revision restoration.
- The local planner and simulator require no secret, network request, or third-party API.
- A server-side OpenAI key is never sent to the browser. A temporary user key is kept only in React memory for the current tab, sent only to the same-origin agent endpoint, and never persisted in `localStorage`.

## Architecture

- **Next.js + TypeScript** — application shell and strongly typed world state.
- **React Three Fiber / Three.js** — arbitrary primitive rendering, orbit camera, selection, replay, and X-Ray overlays.
- **Rapier** — deterministic multi-body rigid-body simulation and collision events.
- **Zod** — strict schemas for all WebMCP inputs.
- **Tailwind CSS + custom CSS** — responsive, keyboard-accessible engineering workspace.
- **localStorage** — hackathon-friendly persistence without auth or backend infrastructure.

Key modules:

- `lib/forge-types.ts` — generic world, physics, telemetry, tool, and revision types.
- `lib/forge-data.ts` — material library, primitive catalog, world defaults, and editable prompt examples.
- `lib/forge-prompt.ts` — free-form goal parsing and compositional world synthesis.
- `lib/forge-engine.ts` — guarded state transitions, ownership, hashing, optimization, compare, and restore.
- `lib/forge-simulation.ts` — Rapier execution, graph-derived measurements, failures, and replay.
- `lib/forge-agent.ts` — strict model-plan/redesign/chat-edit schemas, client boundary, status, and temporary-key transport.
- `lib/use-forge.ts` — Zod tool schemas, WebMCP registration, persistence, and optimistic concurrency.
- `components/forge/forge-scene.tsx` — generic 3D primitive renderer and X-Ray world view.
- `app/forgetwin-app.tsx` — agent loop, editor, activity feed, telemetry, compare, and demo UX.
- `app/api/agent/route.ts` — same-origin server/edge model endpoint using structured Responses API output.

## Judge-ready walkthrough

1. Enter a crane, rover, gearbox, robotic mechanism, bridge, or entirely new mechanical goal.
2. Select **Connect AI** to use a temporary model key, or leave the disclosed local deterministic engineer active.
3. Select **Engineer with AI** or **Engineer locally** and watch the agent console explain its plan, observations, and guarded world-tool calls.
4. Observe the baseline physics failure, then open **Replay 0.25×** or **Telemetry** for causal evidence.
5. Let the agent inspect, measure, redesign, and rerun until all constraints pass.
6. Toggle **X-Ray** to expose joints, axes, signal lines, actuator paths, velocity vectors, and contacts.
7. Select any body and move, rotate, resize, or change its material.
8. Open **Edit with chat**, enter “Make the base wider,” and watch the agent revise and resimulate the same world.
9. Select **Redesign around my change** and verify that the human-owned field remains fixed.
10. Use **Compare runs**, **Version history**, **Undo**, and **Reset** to repeat the judging flow.

## Run locally

Requirements: Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

Open `http://localhost:3000/`.

Optional model-backed mode:

```bash
cp .env.example .env.local
# Set OPENAI_API_KEY in .env.local; OPENAI_MODEL defaults to gpt-5.6-sol.
```

Without that key, the complete local engineering flow still works and is labeled as deterministic.

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

The test suite covers strict model-agent boundaries, explicit no-key fallback, distinct generated world graphs, prompt-sensitive geometry, novel lower-level composition, guarded shared state, exact human Undo, agent-preserved human locks, generic Rapier execution, failure-to-redesign loops across multiple machine families, and automated accessibility checks.

> The AI didn’t generate a picture of a machine. It engineered one, watched it fail, learned from the physics, and fixed it.
