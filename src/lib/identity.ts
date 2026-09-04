"use client";

import { useEffect, useState } from "react";

// A stable per-browser player id. Generated once, persisted in localStorage,
// and used to tag created fighters and to identify "self" inside a room.
// In the real system this is what a real account/session would identify;
// keeping it in one module means that swap touches nothing but this file.

const STORAGE_KEY = "infinite-arena:player-id";

export function getSelfPlayerId(): string {
  if (typeof window === "undefined") return "";
  let id = window.localStorage.getItem(STORAGE_KEY);
  if (!id) {
    id = crypto.randomUUID();
    window.localStorage.setItem(STORAGE_KEY, id);
  }
  return id;
}

// React hook form for components: resolves on mount, always "" during SSR.
export function useSelfPlayerId(): string {
  const [id, setId] = useState("");
  useEffect(() => {
    setId(getSelfPlayerId());
  }, []);
  return id;
}
