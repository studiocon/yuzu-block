import { aggregateToBlocks } from "@/lib/aggregate-to-blocks";
import { currentYear } from "@/lib/data-year";
import { loadAggregate } from "@/lib/data-source";
import BlockScene from "@/components/BlockScene";

export const dynamic = "force-dynamic";

export default async function Home() {
  const now = new Date();
  const year = currentYear(now);
  const { aggregate, source } = await loadAggregate(year, { now });
  // With mock data there is no measurement to be faithful to, so the
  // colour is free to be chosen for how it reads.
  const scene = aggregateToBlocks(aggregate, {
    maxHeight: 20,
    expressive: source === "mock",
  });

  return (
    <main style={{ position: "fixed", inset: 0, zIndex: 1 }}>
      <BlockScene scene={scene} />
    </main>
  );
}
