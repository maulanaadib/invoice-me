"use client";

import * as React from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const STORAGE_KEY = "invoice-me.cookie-consent";
export type CookieConsent = "accepted" | "rejected";

/**
 * Feature 11C — cookie consent banner (infrastructure only; analytics is
 * explicitly deferred per the spec's Scope Limits). The choice persists in
 * localStorage; the session cookie remains essential and is not gated by
 * this banner. Rendered in the root layout so it appears on every page.
 */
export function CookieConsentBanner() {
  // `hydrated` flips true after mount, when localStorage can be read on the
  // client without mismatching the server-rendered empty first paint.
  const [hydrated, setHydrated] = React.useState(false);
  const [choice, setChoice] = React.useState<CookieConsent | null>(null);

  React.useEffect(() => {
    // Defer the first state write past the synchronous effect body so the
    // react-hooks/set-state-in-effect rule is satisfied (this is a genuine
    // post-mount read of an external system — localStorage — not a derived
    // state sync). The visible flag is what decides whether the banner is
    // shown; `choice` only ever changes via a user click (event handler).
    const id = window.setTimeout(() => {
      setHydrated(true);
      let stored: string | null = null;
      try {
        stored = window.localStorage.getItem(STORAGE_KEY);
      } catch {
        // localStorage unavailable — treat as no choice yet.
      }
      if (stored === "accepted" || stored === "rejected") {
        setChoice(stored);
      }
    }, 0);
    return () => window.clearTimeout(id);
  }, []);

  function decide(next: CookieConsent) {
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Non-fatal: the banner simply reappears next visit.
    }
    setChoice(next);
  }

  // Before hydration, or once a choice is made, the banner is not shown.
  if (!hydrated || choice !== null) return null;

  // Overlay bar: the wrapper and card are CLICK-THROUGH (pointer-events-none)
  // so a consent notice can never block the page's own controls underneath
  // it — at a 720p-tall window the login card's submit button sits exactly
  // under this bar. Only the banner's own buttons and links opt back in.

  return (
    <div
      role="region"
      aria-label="Persetujuan cookie"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center p-4"
    >
      <Card className="pointer-events-none w-full max-w-2xl shadow-lg">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Cookie &amp; privasi</CardTitle>
          <CardDescription>
            Kami menggunakan cookie sesi yang esensial agar Anda tetap masuk dan aplikasi berfungsi.
            Saat ini tidak ada cookie analitik pihak ketiga yang aktif. Lihat{" "}
            <Link href="/privacy" className="pointer-events-auto underline">
              Kebijakan Privasi
            </Link>{" "}
            dan{" "}
            <Link href="/terms" className="pointer-events-auto underline">
              Syarat &amp; Ketentuan
            </Link>
            .
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="pointer-events-auto"
            onClick={() => decide("rejected")}
          >
            Hanya esensial
          </Button>
          <Button
            type="button"
            size="sm"
            className="pointer-events-auto"
            onClick={() => decide("accepted")}
          >
            Terima
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}