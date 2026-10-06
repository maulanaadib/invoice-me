"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { revokeSessionAdminAction } from "@/modules/auth/admin-actions";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";

export interface SessionRowData {
  id: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  expiresAt: string;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jakarta",
  });
}

export function SessionList({
  userId,
  sessions,
}: {
  userId: string;
  sessions: SessionRowData[];
}) {
  const router = useRouter();
  const [pendingId, setPendingId] = React.useState<string | null>(null);

  function revoke(sessionId: string) {
    setPendingId(sessionId);
    const form = new FormData();
    form.set("userId", userId);
    form.set("sessionId", sessionId);
    void revokeSessionAdminAction(form)
      .then((result) => {
        if (result.ok) {
          toast.add({ title: "Sesi dicabut", type: "success" });
          router.refresh();
        } else {
          toast.add({ title: "Gagal mencabut sesi", description: result.error.message, type: "error" });
        }
      })
      .finally(() => setPendingId(null));
  }

  if (sessions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Tidak ada sesi aktif — user sedang keluar dari semua perangkat.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {sessions.map((session) => (
        <li
          key={session.id}
          className="flex flex-col gap-1 rounded-lg border border-border bg-background px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-sm">
              Masuk {formatDateTime(session.createdAt)} · IP {session.ipAddress ?? "—"}
            </span>
            <span className="truncate text-xs text-muted-foreground">
              {session.userAgent ? session.userAgent.slice(0, 80) : "Perangkat tidak diketahui"}
              {" · berakhir "}
              {formatDateTime(session.expiresAt)}
            </span>
          </div>
          <Button
            variant="destructive"
            size="sm"
            disabled={pendingId !== null}
            onClick={() => revoke(session.id)}
          >
            {pendingId === session.id ? "Mencabut…" : "Cabut"}
          </Button>
        </li>
      ))}
    </ul>
  );
}
