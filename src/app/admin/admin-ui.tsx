// src/app/admin/admin-ui.tsx
// Colocated helpers for the /admin/* pages (non-route module): the session
// re-check every admin page performs (defense in depth #2), id-ID/Jakarta
// formatters, a byte formatter, and the shared pagination/empty-state markup.

import Link from "next/link";
import { redirect } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "cn";
import { getSession } from "@/server/session";
import type { AdminContext } from "@/modules/admin/service";

/** Every admin page re-checks the session itself, layout guard or not. */
export async function adminPageContext(): Promise<AdminContext> {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.user.platformRole !== "SUPER_ADMIN") redirect("/unauthorized");
  return { platformRole: session.user.platformRole, actorUserId: session.user.id };
}

export function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function formatDate(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Jakarta",
  });
}

export function formatDateTime(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jakarta",
  });
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value.toLocaleString("id-ID", {
    maximumFractionDigits: index === 0 ? 0 : 1,
  })} ${units[index]}`;
}

/** Same query with `page` replaced — used by prev/next links (URL = state). */
export function pageHref(
  params: Record<string, string | string[] | undefined>,
  page: number,
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    const single = Array.isArray(value) ? value[0] : value;
    if (single) search.set(key, single);
  }
  search.set("page", String(page));
  return `?${search.toString()}`;
}

export function AdminPagination({
  page,
  pageSize,
  total,
  params,
}: {
  page: number;
  pageSize: number;
  total: number;
  params: Record<string, string | string[] | undefined>;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted-foreground">
        Menampilkan {from}–{to} dari {total} data
        {totalPages > 1 ? ` (halaman ${page} dari ${totalPages})` : ""}
      </p>
      {totalPages > 1 ? (
        <div className="flex items-center gap-2">
          {page > 1 ? (
            <Link
              href={pageHref(params, page - 1)}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              Sebelumnya
            </Link>
          ) : (
            <span
              className={cn(
                buttonVariants({ variant: "outline", size: "sm" }),
                "pointer-events-none opacity-50",
              )}
            >
              Sebelumnya
            </span>
          )}
          {page < totalPages ? (
            <Link
              href={pageHref(params, page + 1)}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              Berikutnya
            </Link>
          ) : (
            <span
              className={cn(
                buttonVariants({ variant: "outline", size: "sm" }),
                "pointer-events-none opacity-50",
              )}
            >
              Berikutnya
            </span>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** Honest empty state: explains which condition produced zero rows. */
export function AdminEmptyState({
  title,
  description,
  resetHref,
}: {
  title: string;
  description: string;
  resetHref?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card px-6 py-10 text-center">
      <p className="font-medium">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      {resetHref ? (
        <Link href={resetHref} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "mt-4")}>
          Hapus filter
        </Link>
      ) : null}
    </div>
  );
}
