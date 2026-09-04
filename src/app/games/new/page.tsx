import { ArenaShell } from "@/components/ArenaShell";
import { BackButton } from "@/components/BackButton";
import { CreateServerForm } from "@/features/games/CreateServerForm";

export default function Page() {
  return (
    <ArenaShell title="HOST AN ARENA">
      <BackButton />
      <CreateServerForm />
    </ArenaShell>
  );
}
