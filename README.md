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
- words-per-record → a second block color

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
request and handed to the client once. A slow, continuous camera orbit
runs throughout. On top of the snapshot, the client holds back about 10%
of its blocks at first paint and reveals them one at a time on a bounded
schedule, and independently re-colors whole cell columns between the two
tokens while holding the overall color balance close to the snapshot's —
the sculpture reads as continuously carved, but it converges to the
snapshot and never adds anything beyond it. `prefers-reduced-motion`
renders the finished snapshot with no camera motion and no carving, and
draws on demand rather than running a render loop over a still image.

The camera frames the blocks that actually exist, not the nominal ring
grid: weeks below the anonymity threshold and weeks still ahead in the
year emit nothing, so early in a year most of the grid is empty. The fit
is a bounding sphere around the occupied footprint, sized against the
full render width and against the chrome-free vertical band, so the
sculpture stays clear of the header and footer at every orbit angle
without the empty grid pushing the camera back.

Blocks are unlit, per-face tints of the two block tokens defined in
`lib/palette.ts` — side faces are fixed, darker multiples of the same
top-face color, not a separate token or a lighting effect. Colors
actually rendered:

- `YUZU_YELLOW` `#F5D84A`
- `YUZU_ZEST` `#E8A020`
- `YUZU_WHITE` `#FAFAF5` (background)

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
