import { ArenaShell } from "@/components/ArenaShell";
import { CreateServerForm } from "@/features/games/CreateServerForm";

export default function Page() {
  return (
    <ArenaShell title="HOST AN ARENA">
      <CreateServerForm />
    </ArenaShell>
  );
}
