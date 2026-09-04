import { ArenaShell } from "@/components/ArenaShell";
import { FightScreen } from "@/features/fight/FightScreen";

export default async function Page({
  params,
}: {
  params: Promise<{ roomId: string }>;
}) {
  const { roomId } = await params;
  return (
    <ArenaShell title="FIGHT">
      <FightScreen roomId={roomId} />
    </ArenaShell>
  );
}
