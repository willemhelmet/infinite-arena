import { Suspense } from "react";
import { ArenaShell } from "@/components/ArenaShell";
import { BackButton } from "@/components/BackButton";
import { CreateFighterForm } from "@/features/fighter/CreateFighterForm";

export default function Page() {
  return (
    <ArenaShell title="FORGE A FIGHTER">
      <BackButton />
      <Suspense>
        <CreateFighterForm />
      </Suspense>
    </ArenaShell>
  );
}
