import { ArenaShell } from "@/components/ArenaShell";
import { ResultsScreen } from "@/features/results/ResultsScreen";

export default async function Page({
  params,
}: {
  params: Promise<{ roomId: string }>;
}) {
  const { roomId } = await params;
  return (
    <ArenaShell title="THE VERDICT">
      <ResultsScreen roomId={roomId} />
    </ArenaShell>
  );
}
