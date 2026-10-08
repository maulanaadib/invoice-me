// src/app/admin/audit-logs/page.tsx
// Feature 09 — platform audit trail with filters (action, actor, organization,
// date range) and URL-driven pagination. Metadata renders as stored — the audit
// write helper sanitized it before it ever reached the table, so the viewer
// only ever shows already-clean JSON (verified by integration test).

import type { Metadata } from "next";
import Link from "next/link";
import {
  AdminEmptyState,
  AdminPagination,
  adminPageContext,
  first,
  formatDateTime,
} from "@/app/admin/admin-ui";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AUDIT_ACTION_LABELS, auditActionLabel } from "@/modules/admin/audit-labels";
import { ADMIN_PAGE_SIZE } from "@/modules/admin/schema";
import { listAdminAuditLogs, listAdminFilterOptions } from "@/modules/admin/service";
import { AuditAction } from "@prisma/client";

export const metadata: Metadata = {
  title: "Log Audit — Panel Admin — invoice-me",
};

export const dynamic = "force-dynamic";

const FIELD_CLASS =
  "h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground";

export default async function AdminAuditLogsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await adminPageContext();
  const params = await searchParams;

  const [result, options] = await Promise.all([
    listAdminAuditLogs(ctx, params),
    listAdminFilterOptions(ctx),
  ]);

  const action = first(params.action) ?? "";
  const actor = first(params.actorUserId) ?? "";
  const organizationId = first(params.organizationId) ?? "";
  const from = first(params.from) ?? "";
  const to = first(params.to) ?? "";
  const hasFilter = Boolean(action || actor || organizationId || from || to);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Log audit</h1>
        <p className="text-sm text-muted-foreground">
          Jejak seluruh aktivitas platform — login, perubahan data, aksi super
          admin. Metadata sudah disanitasi sebelum tersimpan; tidak ada rahasia
          di halaman ini.
        </p>
      </div>

      <form
        method="get"
        className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-4"
      >
        <div className="flex flex-col gap-1">
          <Label htmlFor="admin-audit-action">Aksi</Label>
          <select
            id="admin-audit-action"
            name="action"
            defaultValue={action}
            className={`${FIELD_CLASS} max-w-64`}
          >
            <option value="">Semua aksi</option>
            {Object.values(AuditAction).map((value) => (
              <option key={value} value={value}>
                {AUDIT_ACTION_LABELS[value]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="admin-audit-actor">Pelaku</Label>
          <select
            id="admin-audit-actor"
            name="actorUserId"
            defaultValue={actor}
            className={`${FIELD_CLASS} max-w-56`}
          >
            <option value="">Semua pengguna</option>
            {options.users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="admin-audit-org">Organisasi</Label>
          <select
            id="admin-audit-org"
            name="organizationId"
            defaultValue={organizationId}
            className={`${FIELD_CLASS} max-w-56`}
          >
            <option value="">Semua organisasi (dan tanpa organisasi)</option>
            {options.organizations.map((organization) => (
              <option key={organization.id} value={organization.id}>
                {organization.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="admin-audit-from">Dari</Label>
          <input
            id="admin-audit-from"
            type="date"
            name="from"
            defaultValue={from}
            className={FIELD_CLASS}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="admin-audit-to">Sampai</Label>
          <input
            id="admin-audit-to"
            type="date"
            name="to"
            defaultValue={to}
            className={FIELD_CLASS}
          />
        </div>
        <div className="flex gap-2">
          <Button type="submit" size="sm">
            Terapkan
          </Button>
          <Link
            href="/admin/audit-logs"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            Reset
          </Link>
        </div>
      </form>

      {result.rows.length === 0 ? (
        <AdminEmptyState
          title={
            result.total > 0
              ? "Halaman di luar jangkauan"
              : hasFilter
                ? "Tidak ada log yang cocok"
                : "Belum ada log audit"
          }
          description={
            result.total > 0
              ? "Kembali ke halaman pertama untuk melihat log terbaru."
              : hasFilter
                ? "Ubah atau hapus filter untuk melihat log lain."
                : "Log ditulis otomatis pada setiap aktivitas penting."
          }
          resetHref={result.total > 0 || hasFilter ? "/admin/audit-logs" : undefined}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Waktu</TableHead>
                <TableHead>Aksi</TableHead>
                <TableHead>Pelaku</TableHead>
                <TableHead>Organisasi</TableHead>
                <TableHead>Entitas</TableHead>
                <TableHead>IP</TableHead>
                <TableHead>Metadata</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                    {formatDateTime(row.createdAt)}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{auditActionLabel(row.action)}</Badge>
                    <span className="block text-[10px] text-muted-foreground">
                      {row.action}
                    </span>
                  </TableCell>
                  <TableCell>
                    {row.actorUserId ? (
                      <Link
                        href={`/admin/users/${row.actorUserId}`}
                        className="text-sm font-medium underline-offset-4 hover:underline"
                      >
                        {row.actorName}
                      </Link>
                    ) : (
                      <span className="text-sm">{row.actorName}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {row.organizationId && row.organizationName ? (
                      <Link
                        href={`/admin/organizations/${row.organizationId}`}
                        className="block max-w-44 truncate text-sm underline-offset-4 hover:underline"
                        title={row.organizationName}
                      >
                        {row.organizationName}
                      </Link>
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <span className="block text-sm">{row.entityType}</span>
                    <span
                      className="block max-w-40 truncate font-mono text-[10px] text-muted-foreground"
                      title={row.entityId}
                    >
                      {row.entityId || "—"}
                    </span>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {row.ipAddress ?? "—"}
                  </TableCell>
                  <TableCell>
                    <details>
                      <summary className="cursor-pointer select-none text-xs text-muted-foreground">
                        Lihat metadata
                      </summary>
                      <pre className="mt-2 max-w-md overflow-auto rounded-md bg-muted p-2 text-[11px] leading-relaxed">
                        {JSON.stringify(row.metadata, null, 2)}
                      </pre>
                    </details>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <AdminPagination
        page={result.page}
        pageSize={ADMIN_PAGE_SIZE}
        total={result.total}
        params={params}
      />
    </div>
  );
}