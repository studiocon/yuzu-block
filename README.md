# yuzu-block (working title)

An open-source public site and auth-free MCP server that render anonymous,
aggregate-only data from a voice journal as a 3D block sculpture. This repo
is independent from the voice journal's own codebase; it consumes aggregate
numbers only. The journal is a voice journal built on ElevenLabs Scribe
transcription, maintained by STUDIO CON.

## What it shows / what it never shows

Shows weekly aggregate rings:

- record count → block height
- silence-day ratio → gaps in the ring
- words-per-record → a second block color

Never shows text, numbers, labels, per-user data, consecutive-day counts,
build-up animation, or any congratulatory effect. Weeks whose cohort is
below the anonymity threshold render as empty rings.

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

Anonymization policy: week-level granularity only. Buckets whose cohort
falls below `minCohort` are returned with every numeric field set to `null`
and `sufficient: false`. No per-user field exists anywhere in this shape, by
construction.

The current data source is a deterministic mock (`lib/mock-aggregate.ts`),
seeded by year and date. A real data source must return the same
`RingAggregate` shape.

## Rendering

The scene is a snapshot: `SceneSpec` is generated server-side on every
request and handed to the client once. Nothing animates except a slow,
continuous camera orbit. Colors are the four brand tokens defined in
`lib/palette.ts`:

- `YUZU_YELLOW` `#F5D84A`
- `YUZU_ZEST` `#E8A020`
- `YUZU_WHITE` `#FAFAF5`
- `INK` `#1A1A2E`

## ElevenLabs

The words that become blocks are transcribed by ElevenLabs Scribe in the
upstream journal. This repo is intended for submission to the ElevenLabs
Grant / Showcase as a standalone, free, open-source demo.

## Deploy

Vercel, zero configuration (`next build`).

## License

MIT © 2026 STUDIO CON.
