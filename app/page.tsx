import { aggregateToBlocks } from "@/lib/aggregate-to-blocks";
import { currentYear } from "@/lib/mock-aggregate";
import { loadAggregate } from "@/lib/data-source";
import BlockScene from "@/components/BlockScene";

export const dynamic = "force-dynamic";

export default async function Home() {
  const now = new Date();
  const year = currentYear(now);
  const { aggregate } = await loadAggregate(year, { now });
  const scene = aggregateToBlocks(aggregate, { maxHeight: 20 });

  return (
    <main style={{ position: "fixed", inset: 0, zIndex: 1 }}>
      <BlockScene scene={scene} />
    </main>
  );
}
