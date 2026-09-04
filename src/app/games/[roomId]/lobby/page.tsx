import { ArenaShell } from "@/components/ArenaShell";
import { LobbyScreen } from "@/features/lobby/LobbyScreen";

export default async function Page({
  params,
}: {
  params: Promise<{ roomId: string }>;
}) {
  const { roomId } = await params;
  return (
    <ArenaShell title="THE LOBBY">
      <LobbyScreen roomId={roomId} />
    </ArenaShell>
  );
}
