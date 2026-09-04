import { ArenaShell } from "@/components/ArenaShell";
import { EntryMenu } from "@/features/entry/EntryMenu";

export default function Page() {
  return (
    <ArenaShell>
      <div className="flex min-h-[80vh] flex-col items-center justify-center">
        <EntryMenu />
      </div>
    </ArenaShell>
  );
}
