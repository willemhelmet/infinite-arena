import { ArenaShell } from "@/components/ArenaShell";
import { FighterGallery } from "@/features/roster/FighterGallery";

export default function Page() {
  return (
    <ArenaShell title="THE ROSTER">
      <FighterGallery />
    </ArenaShell>
  );
}
