// src/app/admin/organizations/[id]/page.tsx
// Feature 09 — organization detail for support + suspend/reactivate. Suspend
// blocks sign-in and new mutations only (ratified rule) — the page says so in
// its own confirmation copy, and reads/downloads stay untouched.

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";
import {
  adminPageContext,
  formatBytes,
  formatDate,
  formatDateTime,
} from "@/app/admin/admin-ui";
import { SetOrganizationStatusForm } from "@/components/forms/set-organization-status-form";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { isAppError } from "@/lib/errors";
import { auditActionLabel } from "@/modules/admin/audit-labels";
import {
  getAdminOrganizationDetail,
  type AdminOrganizationDetail,
} from "@/modules/admin/service";

export const metadata: Metadata = {
  title: "Detail Organisasi — Panel Admin — invoice-me",
};

export const dynamic = "force-dynamic";

export default async function AdminOrganizationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await adminPageContext();
  const { id } = await params;

  let detail: AdminOrganizationDetail;
  try {
    detail = await getAdminOrganizationDetail(ctx, id);
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const { organization, memberships, invoiceCount, memberCount, storage, lastActivity } =
    detail;

  const summary = [
    { label: "Anggota aktif", value: String(memberCount) },
    { label: "Invoice", value: String(invoiceCount) },
    { label: "File tersimpan", value: String(storage.uploadFiles + storage.pdfFiles) },
    { label: "Penyimpanan", value: formatBytes(storage.totalBytes) },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Link
          href="/admin/organizations"
          className={buttonVariants({ variant: "ghost", size: "sm" })}
        >
          <ArrowLeftIcon aria-hidden="true" />
          Kembali ke daftar organisasi
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{organization.name}</h1>
          <Badge
            variant={organization.status === "ACTIVE" ? "secondary" : "destructive"}
          >
            {organization.status === "ACTIVE" ? "Aktif" : "Ditangguhkan"}
          </Badge>
          <span className="font-mono text-xs text-muted-foreground">
            {organization.slug}
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          Dibuat {formatDate(organization.createdAt)}
          {lastActivity
            ? ` · aktivitas terakhir: ${auditActionLabel(lastActivity.action)} oleh ${lastActivity.actorName} (${formatDateTime(lastActivity.createdAt)})`
            : " · belum ada aktivitas tercatat"}
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-4">
        <div className="text-sm text-muted-foreground">
          {organization.status === "ACTIVE"
            ? "Menangguhkan organisasi memblokir login dan aksi baru anggotanya — data tetap tersimpan dan tetap bisa dibaca."
            : "Organisasi ditangguhkan: anggota tidak bisa masuk atau membuat perubahan baru. Data tetap bisa dibaca."}
        </div>
        <SetOrganizationStatusForm
          organizationId={organization.id}
          organizationName={organization.name}
          status={organization.status}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        {summary.map((card) => (
          <Card key={card.label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {card.label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold tracking-tight tabular-nums">
                {card.value}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Rincian penyimpanan</CardTitle>
          <CardDescription>Upload + PDF resmi milik organisasi ini.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
          <div className="flex items-center justify-between gap-4 rounded-md border border-border px-3 py-2">
            <span className="text-muted-foreground">
              Upload ({storage.uploadFiles} file)
            </span>
            <span className="font-medium tabular-nums">
              {formatBytes(storage.uploadBytes)}
            </span>
          </div>
          <div className="flex items-center justify-between gap-4 rounded-md border border-border px-3 py-2">
            <span className="text-muted-foreground">
              PDF resmi ({storage.pdfFiles} file)
            </span>
            <span className="font-medium tabular-nums">
              {formatBytes(storage.pdfBytes)}
            </span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Anggota</CardTitle>
          <CardDescription>{memberships.length} baris (semua status).</CardDescription>
        </CardHeader>
        <CardContent>
          {memberships.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Organisasi ini belum punya anggota.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Anggota</TableHead>
                    <TableHead>Peran</TableHead>
                    <TableHead>Status keanggotaan</TableHead>
                    <TableHead>Status akun</TableHead>
                    <TableHead>Bergabung</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {memberships.map((membership) => (
                    <TableRow key={membership.id}>
                      <TableCell>
                        <Link
                          href={`/admin/users/${membership.userId}`}
                          className="block max-w-56 truncate text-sm font-medium underline-offset-4 hover:underline"
                        >
                          {membership.name || membership.username || membership.userId}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{membership.role}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={membership.status === "ACTIVE" ? "secondary" : "outline"}
                        >
                          {membership.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            membership.userStatus === "SUSPENDED"
                              ? "destructive"
                              : "outline"
                          }
                        >
                          {membership.userStatus === "SUSPENDED"
                            ? "Ditangguhkan"
                            : "Aktif"}
                        </Badge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                        {formatDate(membership.joinedAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
