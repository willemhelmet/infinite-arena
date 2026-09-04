"use client";

import { useEffect, useRef, useState } from "react";

// Plays the arena's own HLS stream (broadcaster/ writes it, hls.js reads it;
// Safari plays HLS natively). Without a stream URL configured it shows the
// off-air card instead of a broken player.
export function StreamPlayer({ src, offline }: { src: string; offline: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;
    let hls: { destroy: () => void } | null = null;
    let cancelled = false;
    (async () => {
      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = src;
        return;
      }
      try {
        const { default: Hls } = await import("hls.js");
        if (cancelled) return;
        if (!Hls.isSupported()) {
          setError("This browser can't play the stream.");
          return;
        }
        const instance = new Hls({ lowLatencyMode: true, liveSyncDurationCount: 3 });
        instance.on(Hls.Events.ERROR, (_e, data) => {
          if (data.fatal) setError("Stream unavailable — the arena may be off air.");
        });
        instance.loadSource(src);
        instance.attachMedia(video);
        hls = instance;
      } catch {
        setError("Could not load the player.");
      }
    })();
    return () => {
      cancelled = true;
      hls?.destroy();
    };
  }, [src]);

  return (
    <div
      className="relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-xl border border-zinc-800 bg-black"
      data-testid="stream-player"
    >
      {src ? (
        <video ref={videoRef} className="h-full w-full" autoPlay muted playsInline controls />
      ) : null}
      {(!src || error || offline) && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/70 text-center">
          <span className="text-[10px] uppercase tracking-[0.4em] text-zinc-500">Infinite Arena</span>
          <span className="text-2xl font-black tracking-widest text-zinc-300">
            {!src ? "NO STREAM CONFIGURED" : offline ? "OFF AIR" : "STREAM UNAVAILABLE"}
          </span>
          <span className="text-xs text-zinc-600">
            {!src
              ? "Set NEXT_PUBLIC_STREAM_URL to the broadcaster's playlist."
              : offline
                ? "The broadcaster isn't publishing. Chat still works."
                : error}
          </span>
        </div>
      )}
    </div>
  );
}
