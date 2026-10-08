import type { Metadata } from "next";
import Link from "next/link";
import { CreateOrganizationDialog } from "@/components/forms/create-organization-dialog";
import { OrgMembersDialog } from "@/components/forms/org-members-dialog";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listOrganizations } from "@/modules/organizations/service";

export const metadata: Metadata = {
  title: "Organisasi — invoice-me",
};

function formatDate(date: Date): string {
  return date.toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Jakarta",
  });
}

// This page reads from Prisma at request time — without this, the static
// prerenderer tries to build a DB client during `next build` and fails.
export const dynamic = "force-dynamic";

export default async function AdminOrganizationsPage() {
  const organizations = await listOrganizations();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Organisasi</h1>
          <p className="text-sm text-muted-foreground">
            Daftar semua workspace di platform. Buat organisasi baru dan kelola
            anggotanya di sini.
          </p>
        </div>
        <CreateOrganizationDialog />
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Organisasi</TableHead>
              <TableHead>Slug</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Anggota</TableHead>
              <TableHead>Dibuat</TableHead>
              <TableHead className="text-right">Aksi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {organizations.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6}>
                  <div className="py-8 text-center text-sm text-muted-foreground">
                    Belum ada organisasi. Buat organisasi pertama dengan tombol
                    “Buat organisasi”.
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              organizations.map((organization) => (
                <TableRow key={organization.id}>
                  <TableCell>
                    <span className="block max-w-64 truncate font-medium">
                      {organization.name}
                    </span>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {organization.slug}
                  </TableCell>
                  <TableCell>
                    <Badge variant={organization.status === "ACTIVE" ? "secondary" : "destructive"}>
                      {organization.status === "ACTIVE" ? "Aktif" : "Ditangguhkan"}
                    </Badge>
                  </TableCell>
                  <TableCell>{organization._count.memberships}</TableCell>
                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                    {formatDate(organization.createdAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <span className="flex items-center justify-end gap-2">
                      <Link
                        href={`/admin/organizations/${organization.id}`}
                        className="text-sm font-medium text-primary underline-offset-4 hover:underline"
                      >
                        Detail
                      </Link>
                      <OrgMembersDialog
                        organizationId={organization.id}
                        organizationName={organization.name}
                      />
                    </span>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
