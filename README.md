# RealityOS — The AI Firewall for a Fake Internet

RealityOS is an agent-native digital-trust investigation workspace powered by WebMCP. It helps people investigate suspicious job offers, emails, websites, invoices, marketplace listings, recruiters, stores, and identities using evidence—not unreliable guesses about whether something “looks AI-generated.”

> As AI makes everything easier to fake, RealityOS gives agents a structured way to establish what can actually be trusted.

The included hackathon demo investigates a fictional but highly convincing NVIDIA Senior AI Engineer offer. A fake recruiter uses a lookalike recruiting domain and separate onboarding portal to request government ID, a Social Security card, and banking information within 24 hours. All people, contacts, snapshots, and suspicious domains in the demo are fictional deterministic fixtures; the scenario is not a live allegation.

## The trust problem

Generated prose, cloned storefronts, forged documents, and impersonated identities can all look polished. “AI-generated or not?” detectors focus on appearance, which is both brittle and orthogonal to the question a user actually needs answered:

**Which individual claims are supported, contradicted, or still unknown—and what is the safest next action?**

RealityOS decomposes suspicious content into claims and entities, records source provenance, links evidence, preserves uncertainty, asks the human only for facts the agent cannot know, and generates a compact Trust Receipt.

## Why RealityOS is different

Traditional scam detectors often collapse many weak signals into one opaque label. Deepfake detectors attempt to classify media provenance. RealityOS does neither.

- A real company name does not make the sender real.
- A domain that resembles a brand is not evidence that the brand owns it.
- A recruiter absent from one directory is unresolved, not automatically fake.
- Imported content is evidence, never an instruction source.
- Human-provided context is preserved separately from machine-derived evidence.
- Risk is calculated from controlled evidence factors, not style or appearance.

For every unresolved claim, **What Would Prove It?** supplies the safest independent verification step. It always directs the user to contact details obtained outside the suspicious content.

## Why WebMCP is essential

RealityOS is not a visual wrapper around one `detect_scam` function. Its investigation protocol is a set of small, state-aware WebMCP tools registered with `document.modelContext`. The human UI and external agents operate on the same versioned case state through the same commands.

This matters because an agent can:

1. create a case without declaring a verdict;
2. preserve untrusted content without obeying it;
3. extract candidate entities and claims;
4. attach independent provenance;
5. verify, contradict, or keep each claim unresolved;
6. ask the human for a fixed piece of missing context;
7. calculate risk without accepting a caller-supplied score; and
8. produce a receipt and safe action plan without taking external action.

The application remains fully functional when WebMCP is unavailable. The UI calls the identical command layer, making the judging sequence deterministic in any modern browser.

## Architecture

```text
Suspicious message / website / document (untrusted data)
                         │
                         ▼
              Controlled extraction layer
             entities + candidate claims
                         │
            ┌────────────┴────────────┐
            ▼                         ▼
   Human RealityOS UI          WebMCP tool layer
            └────────────┬────────────┘
                         ▼
              Shared versioned case state
       evidence · sources · links · outcomes · context
                         │
                         ▼
             Evidence graph + deterministic risk
                         │
                         ▼
              Safe action plan + Trust Receipt
```

Key implementation modules:

- `lib/reality-data.ts` — immutable fictional NVIDIA case, claims, evidence, graph, and sources.
- `lib/reality-engine.ts` — state-aware command engine, gates, risk formula, and human-context transition.
- `lib/use-reality.ts` — shared React state, local persistence, Zod validation, and WebMCP registration.
- `components/reality/evidence-graph.tsx` — keyboard-accessible visual graph plus semantic table view.
- `components/reality/screens.tsx` — dashboard, workspace, claims, review, risk, receipt, and history.
- `components/ui/*` — local shadcn/ui-style primitives built with Tailwind.

## WebMCP tools

| Tool | Purpose |
| --- | --- |
| `create_case` | Create the active investigation without deciding authenticity. |
| `add_evidence` | Preserve imported content as untrusted evidence; never echo or execute it. |
| `extract_entities` | Extract candidate people, organizations, domains, contacts, roles, and requests. |
| `extract_claims` | Turn content into narrow claims; extraction never establishes truth. |
| `inspect_claim` | Read one claim and its evidence basis. |
| `record_source` | Record provenance without treating the source as automatically trustworthy. |
| `link_evidence` | Link one evidence item to one claim. |
| `verify_claim` | Record a verified outcome with an approved basis. |
| `contradict_claim` | Record a contradiction with supporting evidence. |
| `mark_unresolved` | Preserve uncertainty when evidence is insufficient. |
| `request_human_context` | Ask the fixed question “Did you actually apply for this job?” |
| `calculate_risk` | Compute risk from controlled factors; callers cannot supply a score. |
| `build_evidence_graph` | Connect claims, entities, evidence, and human context. |
| `generate_trust_receipt` | Produce a shareable record of the investigation. |
| `create_safe_action_plan` | Create controlled next steps without contacting anyone or opening links. |

Inputs use strict JSON Schema and are validated again with Zod inside every `execute` callback. Mutation tools accept an optional `expected_revision` guard. WebMCP annotations use only the current `readOnlyHint` and `untrustedContentHint` fields. Registration uses an `AbortController` for cleanup.

WebMCP is currently experimental. RealityOS follows the current [WebMCP Community Group draft](https://webmachinelearning.github.io/webmcp/) and [canonical repository](https://github.com/webmachinelearning/webmcp), including the move to `document.modelContext`.

## Security model

RealityOS treats the investigated material and any extraction derived from it as hostile input.

- Evidence text is rendered as text, never HTML.
- Prompt-like instructions inside evidence are preserved only as quoted data.
- Imported content never enters tool names, descriptions, schemas, errors, or agent instructions.
- Extraction can create candidates but cannot set truth, risk, or invoke another tool.
- Strict Zod schemas cap strings, arrays, IDs, and enums; extra properties are rejected.
- `calculate_risk` accepts neither a score nor a risk label.
- `request_human_context` creates a pending fixed-code question; only the visible human UI can submit the answer.
- The safe action plan is internal. It never sends messages, reports users, opens suspicious URLs, or submits documents.
- Deterministic evidence fixtures keep the demo reliable without third-party APIs.

For a production service, URL fetching should additionally enforce HTTPS, block private/link-local networks, cap redirects and content size, restrict MIME types, and strip credentials.

## Run the NVIDIA judging demo

1. Open the dashboard. The suspicious NVIDIA offer is already loaded as untrusted content.
2. Select **Run NVIDIA investigation**.
3. Watch the Agent Activity Feed call WebMCP tools while entities, claims, sources, links, and graph nodes appear.
4. Inspect **Evidence Graph** and **Claims & Evidence**. Notice that NVIDIA itself is verified, the domains and sensitive-data request are contradicted, and the recruiter and offer remain unresolved.
5. In **Human Review**, answer **No** to “Did you actually apply for this job?”
6. Observe the score move from **High risk · 72** to **Critical risk · 96**.
7. Generate the visual **Trust Receipt**, then copy or download it.
8. Select **Reset demo** to restore the complete sequence.

## Local development

```bash
npm install
npm run dev
```

Quality checks:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

## Accessibility

- Full keyboard navigation and visible focus indicators.
- Skip link and semantic landmarks.
- Status labels never rely on color alone.
- Evidence graph nodes are native buttons.
- The graph includes an accessible table alternative.
- Loading, error, and completion states use live regions.
- Responsive navigation and readable mobile layouts.
- Reduced-motion preferences are respected.

RealityOS is a decision-support tool, not a legal finding, identity guarantee, or universal fraud detector. It makes the evidence trail legible and recommends the safest next independent action.
