import { Suspense } from "react";
import { ArenaShell } from "@/components/ArenaShell";
import { CreateFighterForm } from "@/features/fighter/CreateFighterForm";

export default function Page() {
  return (
    <ArenaShell title="FORGE A FIGHTER">
      <Suspense>
        <CreateFighterForm />
      </Suspense>
    </ArenaShell>
  );
}
