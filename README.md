# yuzu-block (working title)

An open-source public site and auth-free MCP server that render anonymous,
aggregate-only data from a voice journal built on ElevenLabs Scribe
transcription as a 3D block sculpture, maintained by STUDIO CON. This repo
is independent from the voice journal's own codebase; it consumes aggregate
numbers only.

## What it shows / what it never shows

Shows weekly aggregate rings:

- record count → block height
- silence-day ratio → gaps in the ring
- words-per-record → where a week sits on the ink ramp

The sculpture itself carries no text, numbers, or labels. Page chrome
around it is limited to the YUZU logo (linking to
[yuzu.style](https://yuzu.style)), a lead, and a footer; every string on
the page is defined in `lib/copy.ts`. No metrics — record counts,
per-user data, consecutive-day counts — are displayed anywhere. No
counters, no congratulatory effect, no light or sound cue. The sculpture never exceeds the server snapshot it started
from — see "Rendering" for what it does show while a visitor watches.
Weeks whose cohort is below the anonymity threshold render as empty
rings.

## Concept

Open the material, never the interpretation.

Annual rings: layers are cut by time passing, not by effort. Numbers are
counted, not praised.

## Setup

```
npm install
npm run dev
```

Open `/`. The MCP endpoint is at `/api/mcp`.

```
npm run check
npm run build
```

Requires Node 20+.

## MCP server

No authentication. Streamable HTTP at `/api/mcp`. One tool: `get_ring_data`.

Input:

```json
{ "year": 2026 }
```

Trimmed example output (`RingAggregate`, buckets truncated):

```json
{
  "year": 2026,
  "unit": "week",
  "minCohort": 50,
  "generatedAt": "2026-09-12T00:00:00.000Z",
  "buckets": [
    {
      "index": 0,
      "start": "2025-12-29",
      "sufficient": true,
      "recordCount": 214,
      "wordCount": 18904,
      "silenceDayRatio": 0.412
    },
    {
      "index": 1,
      "start": "2026-01-05",
      "sufficient": false,
      "recordCount": null,
      "wordCount": null,
      "silenceDayRatio": null
    },
    {
      "index": 2,
      "start": "2026-01-12",
      "sufficient": true,
      "recordCount": 233,
      "wordCount": 21172,
      "silenceDayRatio": 0.388
    }
  ]
}
```

### Custom connector

Add as a custom connector using the URL only:

```
https://<your-deployment>/api/mcp
```

### curl example

Initialize:

```
curl -s http://localhost:3000/api/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
      "protocolVersion": "2024-11-05",
      "capabilities": {},
      "clientInfo": { "name": "curl", "version": "0.0.1" }
    }
  }'
```

Call the tool:

```
curl -s http://localhost:3000/api/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/call",
    "params": { "name": "get_ring_data", "arguments": { "year": 2026 } }
  }'
```

## Data contract

```ts
export interface WeekBucket {
  index: number;
  /** ISO date, YYYY-MM-DD, Monday of the bucket's week. */
  start: string;
  /** False when the cohort for this bucket is below the anonymity threshold. */
  sufficient: boolean;
  recordCount: number | null;
  wordCount: number | null;
  /** 0..1 — days with zero records / days in the bucket. */
  silenceDayRatio: number | null;
}

export interface RingAggregate {
  year: number;
  unit: "week";
  minCohort: number;
  generatedAt: string;
  buckets: WeekBucket[];
}
```

Buckets are ISO weeks: Monday-start, week 1 is the week containing
January 4, and a year has 52 or 53 of them. The reference upstream
computes these boundaries in Asia/Tokyo.

Anonymization policy: week-level granularity only. Buckets whose cohort
falls below `minCohort` are returned with every numeric field set to `null`
and `sufficient: false`. No per-user field exists anywhere in this shape, by
construction.

The data source is selected by the `DATA_SOURCE_URL` environment variable
(`lib/data-source.ts`):

- Unset: a deterministic mock (`lib/mock-aggregate.ts`), seeded by year and
  date.
- Set (e.g. `DATA_SOURCE_URL=https://app.yuzu.style/api/public/weekly`):
  `GET {DATA_SOURCE_URL}?year=YYYY`, expected to return JSON matching
  `RingAggregate` exactly (52 or 53 `WeekBucket`s, `unit: "week"`, nulls
  agreeing with `sufficient`). The response is validated against that shape;
  any failure — network error, non-2xx, timeout, or invalid shape — falls
  back to the mock and logs one line server-side. The upstream is expected
  to set long CDN cache headers; no auth is sent or required.

When a validated upstream payload has no week above the anonymity
threshold at all, the site and MCP tool fall back to the mock as well and
report `source: "mock"`.

The MCP tool's JSON output carries a top-level `source` field
(`"upstream"` or `"mock"`) alongside the aggregate, so a caller can see
which one produced a given response. The page never renders this field.

`wordCount`'s unit is defined by whichever source produced it. For the
reference upstream (the voice journal above), it is transcribed
characters, not words.

## Rendering

The scene is a snapshot: `SceneSpec` is generated server-side on every
request and handed to the client once. On top of it the client holds
back about 10% of the blocks at first paint and reveals them one at a
time on a bounded schedule, and independently slides whole cell columns
along the ink ramp while holding the mean tone close to the snapshot's.
The sculpture reads as continuously carved, but it converges to the
snapshot and never adds anything beyond it.

`prefers-reduced-motion` renders the finished snapshot with no camera
motion and no carving, and draws on demand rather than running a render
loop over a still image.

### Camera

Orthographic, axonometric. It turns continuously and also eases its
elevation between 31 and 53 degrees over about a minute — yaw alone
reads flat, because the face angles never change.

The frame **covers** the viewport rather than fitting inside it: the
solid runs off all four edges and under the page chrome, which the lead
copy sits on top of by design. Nothing is reserved for the chrome.

A square footprint is sqrt(2) narrower face-on than corner-on, so the
frustum is re-fitted to the live orbit angles every frame and then
pulled partway back toward the widest case (`dampedExtents`). Fitting
the live silhouette alone swings the framing by the full sqrt(2), which
crops past the point where the solid still reads as a solid.

### Surface

Unlit. There is no lighting in the scene, so the six per-face constants
are not brightness — they are ink coverage. Two independent reads of one
ordered (Bayer) screen decide every pixel:

- how much ink, from the face's coverage, against the stock beneath it
- which ink, from the block's position on the ramp, between the two
  stops it falls between

Both are hard thresholds, never a blend, so every pixel lands exactly on
a palette token and no in-between colour is produced. Anti-aliased
silhouette edges are the one exception. The screen is anchored to the
solid rather than to the viewport: anchored to the viewport the faces
slide across a fixed grid of dots as the solid turns, and the whole
surface scintillates.

The ramp is in `lib/palette.ts` as `INK_RAMP`, light to muted:

`YUZU_PALE` `#FCEE8A` · `YUZU_LEMON` `#F8E262` · `YUZU_YELLOW` `#F5D84A` ·
`YUZU_GOLD` `#EBCB4A` · `YUZU_STRAW` `#E2C652` · `YUZU_LINEN` `#CCBB6B` ·
`YUZU_STONE` `#BEB47D` · `YUZU_ASH` `#B3AC8E`

`SURFACE_BORDER` `#E8E0C8` is the stock the ink sits on, and
`YUZU_WHITE` `#FAFAF5` is the page — so the only true white inside the
solid is a real void, which is a cell with no block, which is silent
days.

A block's place on the ramp comes from a smooth field across the
footprint, per-column noise and per-block noise, plus the week's own
measure when there is real data. Blocks are ranked against each other
and the ramp's uneven stop positions divide the surface between the
inks; see `lib/tone.ts`.

### Ground

One plane under the solid carries the nominal 52-week ring grid as
concentric squares — most of that grid emits no blocks, so this is the
stock the sculpture was cut from — plus a slowly drifting paper screen,
and a misregistration slip every 7 to 19 seconds. It is transparent
everywhere it has no mark, so the page's own background shows through.

## Working on this

`npm run check` (typecheck, lint, test, brand words) must pass before
anything is considered done.

`.claude/lessons/` holds findings from earlier sessions that are not
recoverable from the code or the log — rendering traps, shader traps,
how to read a deploy's state, test hygiene. Read it before starting.

`npm run deploy:status` reports what Vercel is actually doing with a
commit. GitHub returns `pending` for a commit with no checks at all, so
`state` alone cannot tell a dropped push from a running build; the
script separates them and exits 2 when the push was never received.
`npm run deploy:wait` polls until it settles.

`scripts/colour-audit.browser.js` counts the rendered ink shares by
family and their spread across the frame. It has to run in the browser:
what a viewer sees is weighted by which faces are turned toward the
camera, not by how many blocks carry a tone.

## ElevenLabs

The words that become blocks are transcribed by ElevenLabs Scribe in the
upstream journal. This repo is intended for submission to the ElevenLabs
Grant / Showcase as a standalone, free, open-source demo.

## Deploy

Vercel, zero configuration (`next build`). To use a real upstream instead
of the mock, set `DATA_SOURCE_URL` in the Vercel project's environment
variables (see `.env.local.example`).

## License

MIT © 2026 STUDIO CON.
