# RealityOS — The AI Firewall for a Fake Internet

RealityOS is an agent-native digital-trust investigation workspace powered by WebMCP. It investigates suspicious job offers, emails, websites, invoices, marketplace listings, recruiters, stores, and online identities by decomposing them into testable claims and attaching evidence—not by guessing whether something “looks AI-generated.”

> As AI makes everything easier to fake, RealityOS gives agents a structured way to establish what can actually be trusted.

The app opens directly into the investigation dashboard. It includes both a real-input workflow and a deterministic NVIDIA job-offer demo for reliable judging.

## The trust problem

Generated prose, cloned storefronts, forged invoices, and impersonated identities can all look polished. Appearance detectors answer the wrong question. A user needs to know:

**Which individual claims are verified, contradicted, or still unresolved—and what is the safest next action?**

RealityOS preserves the difference between:

- verified claims supported by explicitly linked independent evidence;
- contradicted claims opposed by explicitly linked independent evidence;
- unresolved claims that still lack a sufficient basis; and
- context supplied directly by the human.

For every unresolved claim, **What Would Prove It?** generates a safe verification step that starts outside the suspicious material.

## What works for real

Users can submit pasted content, a public URL, or both. The live workflow:

1. creates a versioned case;
2. quarantines the submitted material as untrusted content;
3. retrieves public webpages through the server-only Firecrawl evidence route;
4. stores URL, final URL, retrieval time, target status, and SHA-256 content digest;
5. extracts candidate emails, domains, phone numbers, roles, requests, and factual claims;
6. starts every extracted claim as unresolved;
7. builds a dynamic evidence graph from persisted relationships;
8. calculates transparent risk from controlled content signals, claim outcomes, and human context;
9. lets an investigator add an independently obtained evidence URL and explicitly link it as supporting or contradicting a claim; and
10. generates a downloadable Trust Receipt.

The suspicious page cannot prove itself. A subject URL is context-only. To record verified or contradicted, RealityOS requires a separately retrieved source marked as independent, an explicit `supports` or `contradicts` link, and the matching evidence ID as the claim outcome basis.

If Firecrawl is unavailable, RealityOS continues with a clearly labeled content-only fallback. Candidate extraction, the graph, human review, risk calculation, and receipts still work without external APIs.

## Why WebMCP is essential

RealityOS is not a wrapper around one `detect_scam` call. It registers 15 small tools with `document.modelContext`. External agents and the human UI operate on the same versioned case state and the activity feed identifies the actual caller.

| Tool | Purpose |
| --- | --- |
| `create_case` | Create a case without deciding authenticity. |
| `add_evidence` | Preserve imported text as untrusted evidence. |
| `extract_entities` | Extract candidate identities, contacts, domains, roles, and requests. |
| `extract_claims` | Create narrow candidate claims; extraction never establishes truth. |
| `inspect_claim` | Read one claim and bounded evidence metadata without mutation. |
| `record_source` | Retrieve a public source through the protected server route. |
| `link_evidence` | Persist a supports, contradicts, or context relationship. |
| `verify_claim` | Record verified only with a compatible independent basis. |
| `contradict_claim` | Record contradicted only with a compatible independent basis. |
| `mark_unresolved` | Preserve uncertainty when evidence is insufficient. |
| `request_human_context` | Ask one controlled question appropriate to the case. |
| `calculate_risk` | Compute risk from controlled factors; callers cannot provide a score. |
| `build_evidence_graph` | Build the active claim/entity/evidence graph. |
| `generate_trust_receipt` | Produce a shareable evidence and risk record. |
| `create_safe_action_plan` | Generate internal next steps without taking external action. |

Every WebMCP mutation requires the prior state revision. The asynchronous `record_source` tool also requires the active case ID, performs the server fetch itself, and rechecks both values before committing. Agents cannot supply webpage contents or forge retrieval provenance through the public tool schema.

## Architecture

```text
Submitted text / subject URL (always untrusted)
                         │
          ┌──────────────┴──────────────┐
          ▼                             ▼
  Controlled local extraction     POST /api/evidence
  candidates + risk signals       URL guard → Firecrawl
          │                        sanitized provenance
          └──────────────┬──────────────┘
                         ▼
             Shared versioned case state
        claims · sources · evidence links · context
                         │
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
   Human workspace   WebMCP tools   Evidence graph
        └────────────────┬────────────────┘
                         ▼
              Risk + safe action plan
                         ▼
                   Trust Receipt
```

Key modules:

- `app/api/evidence/route.ts` — server-only Firecrawl proxy, URL safety policy, response caps, provenance digest.
- `lib/live-analysis.ts` — deterministic real-input entity, claim, risk, graph, question, and safe-action logic.
- `lib/reality-engine.ts` — shared state-aware command layer and evidence-enforced claim outcomes.
- `lib/use-reality.ts` — local persistence, Zod schemas, asynchronous source retrieval, and WebMCP registration.
- `components/reality/evidence-graph.tsx` — interactive visual graph with an accessible table alternative.
- `components/reality/screens.tsx` — dashboard, intake, workspace, claims, review, risk, receipt, and history.

## Security model

RealityOS treats all investigated content and scraped webpage text as hostile input.

- Evidence is rendered as text, never HTML.
- Imported instructions are quoted data and never enter agent instructions.
- URL intake allows only HTTP/HTTPS on standard ports and rejects credentials, localhost, private/link-local ranges, IPv4-mapped IPv6, common wildcard-to-local services, and suspicious final redirect targets.
- Firecrawl credentials remain server-side.
- Live responses are no-store, capped to 12,000 markdown characters and 25 validated public links, stripped of control/bidirectional formatting characters, and hashed with SHA-256.
- Firecrawl caching is disabled for investigation requests.
- Source recording does not infer trust.
- Subject content is `adjudicable: false` and cannot independently set a claim outcome.
- Claim outcomes require a persisted compatible evidence relationship.
- Human questions can be requested by an agent, but only the visible UI can answer them.
- Any material evidence, link, claim, or human change invalidates prior risk, action-plan, and receipt state.
- Safe action plans never contact people, open suspicious links, submit data, or file reports.

The hosted hackathon deployment is owner-only by default, so the evidence endpoint inherits the site access boundary. Add durable per-user quotas before making the service public at scale.

## Run locally

Requirements: Node.js 22.13 or newer.

```bash
npm install
cp .env.example .env.local
# Add FIRECRAWL_API_KEY to .env.local
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

## Run a real investigation

1. On the dashboard, enter a case title and type.
2. Paste the suspicious content, add a public URL, or use both.
3. Select **Start real investigation**.
4. Watch the live source status and activity feed.
5. Review the graph and unresolved claim ledger.
6. Answer the controlled human-context question.
7. If you have an independently obtained official source, add its URL in **Claims & Evidence**.
8. After reviewing that source, explicitly record a claim as verified, contradicted, or unresolved.
9. Review the transparent risk contributions and generate the Trust Receipt.

## Run the NVIDIA judging demo

1. Select **Reset demo**.
2. Select **Run NVIDIA demo**.
3. Watch the command feed create the case, extract nine entities and six claims, record deterministic independent evidence, and build the graph.
4. Confirm that NVIDIA itself is verified, the recruiting domain/portal/sensitive request are contradicted, and the recruiter/offer remain unresolved.
5. Answer **No** to **“Did you actually apply for this job?”**
6. Verify the risk changes from **High risk · 72** to **Critical risk · 96**.
7. Generate, copy, or download the Trust Receipt.

All people, contacts, snapshots, and suspicious domains in the NVIDIA scenario are fictional deterministic fixtures. The scenario is not a live allegation.

## Accessibility

- Full keyboard navigation and visible focus indicators.
- Skip link and semantic landmarks.
- Native buttons and form labels.
- Status labels never rely on color alone.
- Accessible graph table alternative.
- Live loading, error, and completion announcements.
- Responsive layouts and reduced-motion support.

RealityOS is a decision-support tool, not a legal finding, identity guarantee, or universal fraud detector. It makes the evidence trail legible and recommends the safest independent next action.
