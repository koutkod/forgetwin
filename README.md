# A11yRelay

**Make the web accessible, together.**

A11yRelay is an agent-native accessibility remediation workspace. It helps humans and AI agents find accessibility barriers, fix what is deterministic, pause when meaning requires judgment, verify the result, undo any change, and publish an Accessible Web Twin.

> A scanner produces a list. A11yRelay creates a remediation workflow.

## Problem

Automated scanners are valuable, but their output usually stops where the difficult work begins. Teams still need to understand each finding, decide whether a fix is safe, gather missing context, apply changes, verify the new version, and preserve an audit trail. Meaning-dependent issues such as chart descriptions cannot be solved responsibly by confidence alone.

## Solution

A11yRelay gives the same project two first-class interfaces:

- **Human UI:** a polished workspace for issues, review, comparisons, semantic outlines, history, verification, and publishing.
- **Agent tools:** narrow WebMCP operations that read and modify the same versioned, reversible state.

The built-in **City of Arbor Creek · 2026 Community Energy Report** is intentionally inaccessible and deterministic. It produces 18 findings: 2 critical, 5 serious, 7 moderate, and 4 minor. Eleven deterministic findings can be remediated safely. Four meaning-dependent findings remain under human control.

## Why WebMCP

WebMCP is fundamental to A11yRelay's external-agent experience. Instead of asking an agent to infer UI controls or manipulate arbitrary DOM, the application exposes explicit domain operations such as `inspect_issue`, `apply_safe_fixes`, `submit_human_context`, and `revert_fix`.

```text
External AI agent
        ↓
  document.modelContext
        ↓
 A11yRelay tool layer
        ↓
 accessibility engine
        ↓
 shared, versioned project state
       ↙                 ↘
 Human workspace     Accessible Web Twin
```

The implementation follows the current WebMCP draft contract: tools register through `document.modelContext.registerTool(...)`; aborting the registration signal removes them. WebMCP is progressive enhancement, so the complete human workflow remains usable in browsers without experimental WebMCP support. See the [canonical WebMCP repository](https://github.com/webmachinelearning/webmcp), [current draft](https://webmachinelearning.github.io/webmcp/), and [implementation status](https://github.com/webmachinelearning/webmcp/blob/main/implementation-status.md).

## Human + agent workflow

1. Load the reliable built-in demo.
2. Run `audit_content` without modifying content.
3. Inspect or filter the structured issue queue.
4. Run `apply_safe_fixes` to apply only deterministic fixes at 90% confidence or higher.
5. Provide human context for the energy chart.
6. Generate and apply the approved chart proposal.
7. Compare rendered content, HTML, and the Screen Reader Outline.
8. Verify the current version.
9. Publish the Accessible Web Twin.
10. Revert any change and repeat the flow.

## Architecture

- **Framework:** React 19, TypeScript, Vinext/Next-compatible App Router, Tailwind build pipeline
- **Hosting runtime:** OpenAI Sites with Cloudflare-compatible ESM output
- **State:** versioned client state with local persistence for deterministic hackathon reliability
- **Audit engine:** semantic DOM analysis with transparent rule logic
- **Validation:** Zod runtime checks inside every WebMCP execution callback
- **WebMCP types:** `webmcp-types`
- **Accessibility QA:** automated rule tests plus manual-workflow guidance

All UI actions and WebMCP calls use the same command functions. A tool never mutates presentation-only state behind the UI's back.

## WebMCP tools

| Tool | Kind | Purpose |
| --- | --- | --- |
| `audit_content` | Read | Run accessibility checks without changing content |
| `list_issues` | Read | Filter structured findings |
| `inspect_issue` | Read | Return DOM context, WCAG reference, confidence, and guidance |
| `propose_fix` | Read | Produce a reversible proposal or request human context |
| `apply_fix` | Write | Apply one approved proposal |
| `apply_safe_fixes` | Write | Apply deterministic fixes only |
| `submit_human_context` | Write | Add the meaning needed for an ambiguous issue |
| `get_screen_reader_outline` | Read | Compare original and current semantic outlines |
| `test_keyboard_flow` | Read | Check deterministic keyboard reachability |
| `compare_versions` | Read | Compare scores, issue counts, semantics, and changes |
| `revert_fix` | Write | Restore state before a recorded change |
| `verify_content` | Read | Re-run checks and stamp the current version |
| `publish_accessible_version` | Write | Publish a verified Accessible Web Twin snapshot |
| `get_project_status` | Read | Return project phase, score, counts, and version |

Tool availability follows state. The registration uses only the annotations in the current draft: `readOnlyHint` and `untrustedContentHint`.

## Safety model

- Imported and user-authored content is always treated as **untrusted data**, never as instructions.
- Content-bearing tool responses set `untrustedContentHint: true`.
- The browser currently does not guarantee invocation validation against `inputSchema`, so every tool validates again with strict Zod schemas.
- Agent-provided project IDs, issue IDs, proposal IDs, change IDs, confidence thresholds, and context length are bounded and checked.
- Safe fixes require deterministic classification and at least 90% confidence.
- Meaning-dependent fixes cannot be applied until human context exists.
- Every mutation creates a reversible change record.
- Publishing refuses unverified versions and versions with critical issues.
- The regular UI remains the fallback when WebMCP is unsupported.

## Accessibility methodology

The demo audit scans real parsed HTML. Rules detect document language, title, landmarks, keyboard-hostile custom controls, form names, image/chart alternatives, table headers and captions, heading order, link purpose, ARIA references, duplicate IDs, region names, frame titles, and the demo's explicit contrast token.

The **A11yRelay Accessibility Score** is an internal remediation indicator:

```text
risk = critical × 8 + serious × 4 + moderate × 2 + minor × 1
score = round(100 × (1 - min(risk / 128, 1)))
```

It is not a WCAG certification or a legal-compliance score. Human-review items remain visible even when the score is high.

The A11yRelay UI itself uses semantic landmarks, a skip link, visible focus styles, logical headings, labeled controls, keyboard-operable actions, live status announcements, accessible dialogs, reduced-motion support, and high-contrast color tokens.

## Running locally

Requirements: Node.js 22.13 or later.

```bash
npm install
npm run dev
```

Open the local URL printed by the development server.

## Testing

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

The test suite covers:

- the exact 18-issue demo inventory and initial score;
- language, image-alternative, form-label, and heading detection;
- safe remediation without applying human decisions;
- human context unlocking the chart proposal;
- score progression from 58 to 89 to 92;
- true revert restoring a detected issue;
- read-only audit behavior;
- separation between safe and human-review issue sets.

## Limitations

- The hackathon build prioritizes a reliable built-in demo and device-local persistence. It does not provide multi-user accounts or cloud project storage.
- WebMCP is an experimental W3C Community Group draft with limited browser support.
- The audit engine demonstrates a transparent, extensible remediation model; production use should combine it with broader engine coverage, assistive-technology testing, and expert manual review.
- URL and document ingestion are roadmap items because CORS, authentication, bot protection, JavaScript rendering, and document semantics require infrastructure beyond the reliable core demo.
- Publishing creates a persistent application route backed by the current device's demo state, not a separate physical deployment.

## Future roadmap

- axe-core result reconciliation for arbitrary imported pages
- secure server-side URL import and document conversion
- shared project persistence and reviewer roles
- browser-assisted focus-order recording
- per-change approvals and organization policy controls
- CI/CD publication hooks for remediated source patches

## Disclaimer

**A11yRelay assists with accessibility remediation but does not guarantee WCAG conformance, ADA compliance, or legal compliance. Automated testing cannot identify every accessibility barrier, and manual review remains necessary.**
