# ForgeTwin — Don’t generate it. Engineer it.

ForgeTwin is a browser-based, agent-native engineering sandbox. A person describes a physical goal; the in-app engineering agent composes a new mechanical world from reusable primitives, assigns physical properties, connects joints and controls, runs deterministic physics, measures failures, and changes the causal parts until the stated constraints pass.

The runtime is explicit about what is doing the work:

- **Model agent** — a user can connect their own OpenAI API key for the current tab. GPT-5.6 Sol then authors the complete design graph—assemblies, bodies, transforms, joints, devices, controls, and measurable requirements—edits the live world from chat, and selects the failure-analysis/redesign loop. Model graphs pass strict schema, identity, quantity, reference, grounding, connectivity, drive, bounds, and component-budget checks before any world mutation. The key is held only in React memory, sent only to the same-origin agent route, and never stored in browser storage or the project. `OPENAI_MODEL` can override the default model.
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
- “Build a solar-powered electric bicycle.”
- “Create an 8 meter bridge that supports 3,000 kg with less than 6 mm deflection.”
- “Build an automatic rotating hatch with an obstruction sensor.”

The examples in the UI are editable briefs, not hidden design templates. Prompt dimensions and targets change the generated graph. When a semantic part is unavailable, the planner builds it from beams, plates, shafts, joints, motors, sensors, and other lower-level primitives.

Compound briefs are composed, not classified into one machine bucket. For example, a gearbox-driven crane contains separate transmission and suspension assemblies with a power edge from the output shaft to the hoist drive; a rover-mounted arm combines rolling support and serial-linkage assemblies. Explicit requests such as gears, pistons, cameras, pulleys, or counterweights are preserved and integrated into the generated graph.

Object identity is authoritative. Obvious spelling variants such as “bycicle” are canonicalized only for topology selection, while modifiers remain attached to the requested object. For example, “solar-powered electric bicycle” produces one connected bicycle assembly with a spoked two-wheel chassis, welded tube frame, fork, cockpit, crank/chain drive, battery, motor, controller, sensor, rack, and fixed charging panel; it does not place a generic rover beside an unrelated solar tracker. Active tracking is created only when the brief explicitly asks to follow, aim at, or orient toward the sun or a light source.

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
| `set_motor_speed`, `set_sensor_range`, `set_actuator_timing`, `update_control_logic` | Retune existing behavior in place without duplicating devices. |
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

The **Edit with chat** panel changes the existing world rather than silently starting over. The connected model receives the bounded current graph, selected body, device/control state, latest failed metrics, human locks, and recent chat context. Requests such as “lengthen the boom,” “widen the outriggers,” “move the sensor up 0.5 m,” “reverse the drive motor,” “retune the PID,” or “add another support” compile into the smallest guarded action sequence. Multi-action revisions execute against a shadow world and commit atomically only if every action, stale-state guard, and preservation invariant passes. If a request is materially ambiguous, the agent asks one clarification before mutating anything. ForgeTwin then runs physics and uses the same evidence-driven redesign loop if a constraint fails. Without a model key, the bounded local interpreter handles recognized geometry, transform, mass, material, add, and remove requests and refuses unknown edits instead of changing an arbitrary part.

The renderer uses the same primitive graph to produce industrial frames, rounded structural members, geared shafts, grooved pulleys, rigging, wheels with hubs and tread, drive housings, crates, solar panels, conveyors, supports, and control devices. Camera framing is derived from the current world bounds, so a compact gearbox and a tall crane both fill the workspace without machine-specific camera presets.

## Export and CAD handoff

The workspace **Export** center turns the current revision into useful downstream artifacts:

- **PNG and JPG** — a polished 1800 × 1200 (3:2) capture of the live 3D camera with the machine name, revision, physics state, body/joint count, mass, and constraint score.
- **PDF engineering report** — a branded multi-page summary containing the live render, design evidence, goal, status, and a paginated bill of materials with dimensions, material, mass, and rigid-body mode.
- **STL CAD exchange geometry** — one compact binary triangulated assembly mesh with component transforms applied and SI meters converted to CAD-standard millimeters. It imports into ShareCAD, SolidWorks, Creo, Fusion 360, FreeCAD, and other mainstream CAD tools.
- **ForgeTwin JSON** — the complete machine goal, world, assemblies, bodies, transforms, materials, joints, connections, sensors, actuators, controls, and latest physics evidence.

STL is intentionally described as exchange geometry, not a native SolidWorks `.SLDASM` or Creo `.ASM` feature tree. Imported meshes can be measured, referenced, converted, or rebuilt parametrically in the destination CAD system, but a browser-generated mesh cannot preserve proprietary feature history.

## Security model

- The design brief is treated as untrusted data, never executable instructions. The model route wraps it as `USER_DATA`, uses strict Structured Outputs, and performs one feedback-guided repair if a structurally valid answer violates mechanical or prompt-fidelity invariants.
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
- `lib/forge-agent.ts` — strict model-plan/redesign/chat-edit schemas, semantic validation, client boundary, status, and temporary-key transport.
- `lib/forge-model-plan.ts` — conversion from a validated model-authored design graph into the executable world plan and renderer semantics.
- `lib/forge-export.ts` — 3:2 viewport capture, PDF engineering report, STL CAD assembly, and full-world data export.
- `lib/use-forge.ts` — Zod tool schemas, atomic edit batches, WebMCP registration, persistence, and optimistic concurrency.
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
10. Select **Export** to download a PNG/JPG presentation view, a multi-page PDF engineering report, an STL for SolidWorks/Creo, or the full engineering graph as JSON.
11. Use **Compare runs**, **Version history**, **Undo**, and **Reset** to repeat the judging flow.

## Run locally

Requirements: Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

Open `http://localhost:3000/`.

Select **Connect AI** in the app and enter your own OpenAI API key to enable model-backed planning and chat edits for that browser tab. ForgeTwin validates the key and GPT-5.6 Sol access before showing the model as connected, never stores the key, and surfaces authentication, access, quota, and temporary-provider errors without exposing key material. A transient model failure falls back locally only for that operation while keeping the validated session available for retry. ForgeTwin does not use a shared owner key. Without a visitor key, the complete local engineering flow still works and is labeled as deterministic.

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

The test suite covers strict model-agent boundaries and schema compatibility, semantic repair, prompt-identity and count preservation, false-positive prompt families, model-authored graph compilation, atomic edit rollback, device/control retuning, explicit no-key fallback, distinct generated worlds, guarded shared state, exact human Undo, human locks, Rapier execution, failure-to-redesign loops, and automated accessibility checks.

> The AI didn’t generate a picture of a machine. It engineered one, watched it fail, learned from the physics, and fixed it.
