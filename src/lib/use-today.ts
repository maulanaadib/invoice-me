"use client";

// src/lib/use-today.ts
// Today's date as an external store: null during SSR/hydration, then the
// client value (memoized so the snapshot stays stable). React re-renders once
// after hydration when the values differ — no setState-in-effect, no hydration
// mismatch when a preview renders dates into HTML.

import * as React from "react";

let cachedToday: Date | null = null;

function subscribe(): () => void {
  return () => {};
}

function getClientSnapshot(): Date {
  if (!cachedToday) cachedToday = new Date();
  return cachedToday;
}

function getServerSnapshot(): Date | null {
  return null;
}

/** Date shown by client-only previews; null until the client takes over. */
export function useToday(): Date | null {
  return React.useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);
}
