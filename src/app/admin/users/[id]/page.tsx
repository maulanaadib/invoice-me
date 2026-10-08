import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";
import { adminPageContext, formatDateTime } from "@/app/admin/admin-ui";
import { isAppError } from "@/lib/errors";
import { SessionList, type SessionRowData } from "@/components/tables/session-list";
import { UserDetailActions } from "@/components/forms/user-detail-actions";
import { SetPlatformRoleForm } from "@/components/forms/set-platform-role-form";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getAdminUserDetail, type AdminUserDetail } from "@/modules/admin/service";

export const metadata: Metadata = {
  title: "Detail Pengguna — invoice-me",
};

export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await adminPageContext();
  const { id } = await params;

  let page: AdminUserDetail;
  try {
    page = await getAdminUserDetail(ctx, id);
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }

  const { detail, invoicesByOrg } = page;
  const { user, memberships, sessions, invoiceCount } = detail;
  const sessionRows: SessionRowData[] = sessions.map((row) => ({
    id: row.id,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  }));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Link
          href="/admin/users"
          className={buttonVariants({ variant: "ghost", size: "sm" })}
        >
          <ArrowLeftIcon aria-hidden="true" />
          Kembali ke daftar pengguna
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            {user.name || user.username || user.email}
          </h1>
          <Badge variant={user.status === "SUSPENDED" ? "destructive" : "secondary"}>
            {user.status === "SUSPENDED" ? "Ditangguhkan" : "Aktif"}
          </Badge>
          {user.platformRole === "SUPER_ADMIN" ? (
            <Badge>Super Admin</Badge>
          ) : (
            <Badge variant="outline">User</Badge>
          )}
          {user.mustChangePassword ? (
            <Badge variant="outline">Wajib ganti sandi saat masuk</Badge>
          ) : null}
        </div>
      </div>

      <UserDetailActions userId={user.id} status={user.status} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Informasi akun</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="flex flex-col gap-3 text-sm">
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">Email</dt>
                <dd className="truncate font-medium">{user.email}</dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">Username</dt>
                <dd className="truncate font-medium">{user.username ?? "—"}</dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">Dibuat</dt>
                <dd className="font-medium">{formatDateTime(user.createdAt)}</dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">Diperbarui</dt>
                <dd className="font-medium">{formatDateTime(user.updatedAt)}</dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">Invoice dibuat (total)</dt>
                <dd className="font-medium tabular-nums">{invoiceCount}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Platform role</CardTitle>
            <CardDescription>
              Menentukan akses ke panel super admin. Perubahan tercatat di log
              audit sebagai <code className="text-xs">USER_ROLE_CHANGED</code>.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3">
              <Badge variant={user.platformRole === "SUPER_ADMIN" ? "default" : "outline"}>
                {user.platformRole === "SUPER_ADMIN" ? "SUPER_ADMIN" : "USER"}
              </Badge>
            </div>
            <div className="mt-4">
              <SetPlatformRoleForm
                userId={user.id}
                currentRole={
                  user.platformRole === "SUPER_ADMIN" ? "SUPER_ADMIN" : "USER"
                }
                isSelf={user.id === ctx.actorUserId}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Keanggotaan organisasi</CardTitle>
            <CardDescription>
              {memberships.length} organisasi — peran menentukan izin di dalam workspace.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {memberships.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Belum menjadi anggota organisasi mana pun.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {memberships.map((membership) => (
                  <li
                    key={membership.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 py-2"
                  >
                    <span className="min-w-0 truncate text-sm font-medium">
                      {membership.organization.name}
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <Badge variant="outline">{membership.role}</Badge>
                      <Badge
                        variant={membership.status === "ACTIVE" ? "secondary" : "outline"}
                      >
                        {membership.status}
                      </Badge>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Invoice dibuat per organisasi</CardTitle>
            <CardDescription>
              Pecahan dari total “Invoice dibuat” di atas — dihitung dengan cara
              yang sama (invoice yang dibuat user ini), dikelompokkan per
              organisasi, jumlahnya selalu sama dengan total.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {invoicesByOrg.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Belum membuat invoice apa pun.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {invoicesByOrg.map((entry) => (
                  <li
                    key={entry.organizationId}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 py-2"
                  >
                    <Link
                      href={`/admin/organizations/${entry.organizationId}`}
                      className="min-w-0 truncate text-sm font-medium underline-offset-4 hover:underline"
                    >
                      {entry.organizationName}
                    </Link>
                    <span className="shrink-0 text-sm font-medium tabular-nums">
                      {entry.count} invoice
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Sesi aktif</CardTitle>
          <CardDescription>
            Mencabut sesi langsung mengeluarkan user dari perangkat terkait.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SessionList userId={user.id} sessions={sessionRows} />
        </CardContent>
      </Card>
    </div>
  );
}
