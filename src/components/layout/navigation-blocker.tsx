"use client";

// src/components/layout/navigation-blocker.tsx
// Shared "unsaved changes" guard (feature 04 autosave editor). The editor sets
// `blocked` while the draft is dirty or mid-save; every in-app navigation entry
// point (sidebar links, user menu) asks `confirmLeave()` first, and the raw
// browser cases (tab close/reload) are handled by the editor's own
// beforeunload listener. `GuardedLink` is the Link wrapper per the Next.js
// docs' "Blocking navigation" pattern (Link `onNavigate` prop).

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export const UNSAVED_CHANGES_MESSAGE =
  "Perubahan pada draft belum tersimpan. Tinggalkan halaman?";

interface NavigationBlockerValue {
  blocked: boolean;
  setBlocked: (blocked: boolean) => void;
  /** True when it is safe to navigate now (unblocked, or user confirmed). */
  confirmLeave: () => boolean;
  /** confirmLeave() + router.push — guarded programmatic navigation. */
  guardedPush: (href: string) => void;
}

const NavigationBlockerContext = React.createContext<NavigationBlockerValue>({
  blocked: false,
  setBlocked: () => {},
  confirmLeave: () => true,
  guardedPush: () => {},
});

export function NavigationBlockerProvider({ children }: { children: React.ReactNode }) {
  const [blocked, setBlocked] = React.useState(false);
  const router = useRouter();
  // Ref keeps the callbacks reading the CURRENT value at click time.
  // Written in an effect, not during render, so refs are never accessed
  // during the render phase.
  const blockedRef = React.useRef(blocked);
  React.useEffect(() => {
    blockedRef.current = blocked;
  }, [blocked]);

  const confirmLeave = React.useCallback((): boolean => {
    if (!blockedRef.current) return true;
    if (window.confirm(UNSAVED_CHANGES_MESSAGE)) {
      setBlocked(false);
      return true;
    }
    return false;
  }, []);

  const guardedPush = React.useCallback(
    (href: string) => {
      if (!confirmLeave()) return;
      router.push(href);
    },
    [confirmLeave, router],
  );

  const value = React.useMemo<NavigationBlockerValue>(
    () => ({ blocked, setBlocked, confirmLeave, guardedPush }),
    [blocked, confirmLeave, guardedPush],
  );

  return (
    <NavigationBlockerContext.Provider value={value}>
      {children}
    </NavigationBlockerContext.Provider>
  );
}

export function useNavigationBlocker(): NavigationBlockerValue {
  return React.useContext(NavigationBlockerContext);
}

/** Link that asks before navigating while `blocked` is active. */
export function GuardedLink({ children, ...props }: React.ComponentProps<typeof Link>) {
  const { confirmLeave } = useNavigationBlocker();
  return (
    <Link
      {...props}
      onNavigate={(event) => {
        if (!confirmLeave()) event.preventDefault();
        props.onNavigate?.(event);
      }}
    >
      {children}
    </Link>
  );
}
