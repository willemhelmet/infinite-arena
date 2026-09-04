"use client";

import { MockH3Feed } from "./MockH3Feed";

// The arena's broadcast surface. In the graybox this is a placeholder panel;
// when the live phase lands, "live" mode mounts <FastH3Provider> + the real
// video view, feeding each resolved round's scene prompt into the H3 chain
// (continue_from_clip_id threading, per the starter's queueEpisode pattern).
// FightScreen picks the mode from one env flag — flipping it is config, not code.

interface H3FeedProps {
  mode: "mock" | "live";
  roomId: string;
  round: number;
  resolving: boolean;
}

function LiveH3Feed({ roomId, round }: { roomId: string; round: number }) {
  // PARKED: live mode lands alongside the narrative coordinator (it produces
  // the per-round scene prompts this would enqueue). The seam is fixed:
  // <FastH3Provider jwtToken={fetchToken}> wrapping the starter's video view,
  // enqueueing one chained clip per resolved round.
  return (
    <div className="flex aspect-video items-center justify-center rounded-xl border border-zinc-800 bg-black">
      <p className="text-xs text-zinc-600">
        Live feed not wired yet (room {roomId}, round {round})
      </p>
    </div>
  );
}

export function H3Feed({ mode, roomId, round, resolving }: H3FeedProps) {
  if (mode === "live") return <LiveH3Feed roomId={roomId} round={round} />;
  return <MockH3Feed round={round} resolving={resolving} />;
}
