# Portal — the public window

`index.html` is the showcase page for DharaIntake, positioned per [doc 13](../13-packaging-tiers-and-access.md) as a **Clinical Front AI**, not an intake form or a queue app.

**Published (private) at:** https://claude.ai/code/artifact/e6f739c4-cb55-466b-807e-26619e512936 — share from the page's share menu when you want it public.

## Design system (keep consistent if you extend it)

| | |
|---|---|
| Ground | `#EBEEE9` sage ledger paper (dark: `#0A1310`) |
| Ink | `#10201C` teal-black (dark: `#E4EAE5`) |
| Accent | `#0B5F52` deep *dhara* teal — the name means stream/flow (dark: `#4FB79F`) |
| Signal | `#B46E18` amber, used **only** for live/queue state (dark: `#E0A24C`) |
| Alert | `#B23A34` red-flag semantic, never decorative |
| Display | Iowan Old Style / Charter — clinical-document authority |
| Body | Avenir Next / system humanist sans |
| System voice | Monospace — token numbers, field keys, tool calls, all figures with tabular numerals |
| Motif | The token slip and the ledger form: hairline rules with mono labels set into them, square corners (deliberately no rounded cards), 1px-gap grids |

Devanagari (`Kohinoor Devanagari` / `Nirmala UI`) appears throughout as real product content — the multilingual claim is shown, not asserted.

## Structure

Hero (cycling live panel: **agentic after-hours call with visible tool trace → OPD queue board → nurse review**) · targets strip · patient journey (01–06) · agent layer with the full tool registry · evidence graph with a real provenance card · four interaction modes · tier ladder T1/T2/T3 · agentic keep-vs-refuse verdict · workflow packs · India-first-and-why-it-travels · under the surface · safety boundary · honest build-status table · pilot CTA.

## Content rules (do not break these)

1. **No fabricated traction.** We have no customers yet, so there are no logo walls, no "2M+ calls", no invented outcome stats. Numbers on the page are labelled targets, design constraints, or planning-stage prices. The build-status table replaces the usual social-proof section, and that honesty is itself differentiation for a page investors and pilot sites will read.
2. **Never imply diagnosis.** Copy stays inside the doc 09 boundary: collect, structure, verify, route to a human.
3. **Sample data is clearly illustrative** — token numbers, masked phone, placeholder clinic and staff names.

## Editing

Self-contained single file: no external fonts, scripts, or images (artifact CSP blocks them). Theme tokens are defined on bare `:root`, then re-declared in `@media (prefers-color-scheme: dark)` guarded by `:root:not([data-theme="light"])`, then again under `:root[data-theme="dark"]` — keep all three in sync when adding a color. Motion is disabled wholesale under `prefers-reduced-motion`, where the panel stays on the concierge scene.

To update the published page: edit this file, then re-publish **this path** (from the conversation that created it) or pass the artifact URL as `url` from any other conversation. Publishing without the URL creates a second artifact instead of updating this one.
