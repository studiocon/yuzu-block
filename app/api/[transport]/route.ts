import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { generateAggregate } from "@/lib/mock-aggregate";
import { MIN_RING_YEAR, validateRingYear } from "@/lib/ring-year";

// mcp-handler resolves endpoints from the dynamic [transport] segment
// combined with basePath below: basePath "/api" + this file living at
// app/api/[transport]/route.ts gives the Streamable HTTP endpoint at
// /api/mcp (transport === "mcp").

const handler = createMcpHandler(
  (server) => {
    server.registerTool(
      "get_ring_data",
      {
        title: "Get anonymous weekly aggregate for a year",
        description:
          "Returns anonymous, aggregate-only weekly buckets (record count, word count, " +
          "silence-day ratio) for the given year. Buckets below the anonymity threshold " +
          "are null. No per-user data exists. Currently backed by a deterministic mock " +
          "generator.",
        inputSchema: {
          year: z.number().int().describe(`Year to fetch, ${MIN_RING_YEAR} or later.`),
        },
        annotations: {
          readOnlyHint: true,
          openWorldHint: false,
        },
      },
      async ({ year }) => {
        const validation = validateRingYear(year);
        if (!validation.ok) {
          return {
            isError: true,
            content: [{ type: "text", text: validation.message }],
          };
        }

        const aggregate = generateAggregate({ year });
        return {
          content: [{ type: "text", text: JSON.stringify(aggregate) }],
        };
      },
    );
  },
  {
    serverInfo: { name: "yuzu-block (working title)", version: "0.1.0" },
  },
  {
    basePath: "/api",
  },
);

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export { handler as GET, handler as POST, handler as DELETE };
