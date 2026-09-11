import { aggregateToBlocks } from "@/lib/aggregate-to-blocks";
import { currentYear, generateAggregate } from "@/lib/mock-aggregate";
import BlockScene from "@/components/BlockScene";

export const dynamic = "force-dynamic";

export default function Home() {
  const now = new Date();
  const year = currentYear(now);
  const aggregate = generateAggregate({ year, now });
  const scene = aggregateToBlocks(aggregate, { maxHeight: 20 });

  return (
    <main style={{ position: "fixed", inset: 0, zIndex: 1 }}>
      <BlockScene scene={scene} />
    </main>
  );
}
