"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { MoonIcon, SunIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

// next-themes resolves the theme only on the client. useSyncExternalStore's
// server snapshot keeps hydration consistent without a set-state effect.
const subscribeNoop = () => () => {};
const snapshotClient = () => true;
const snapshotServer = () => false;

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = React.useSyncExternalStore(subscribeNoop, snapshotClient, snapshotServer);

  const isDark = mounted && resolvedTheme === "dark";

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={isDark ? "Ganti ke tema terang" : "Ganti ke tema gelap"}
      onClick={() => setTheme(isDark ? "light" : "dark")}
    >
      {isDark ? <MoonIcon aria-hidden="true" /> : <SunIcon aria-hidden="true" />}
    </Button>
  );
}
