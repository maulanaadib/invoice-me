import type { Metadata } from "next";
import { redirect } from "next/navigation";
import type { PlatformRole, UserStatus } from "@prisma/client";
import { CreateUserDialog } from "@/components/forms/create-user-dialog";
import { UsersTable, type AdminUserRow } from "@/components/tables/users-table";
import { USERS_PAGE_SIZE } from "@/modules/admin/constants";
import { listUsers } from "@/modules/auth/service";
import { getSession } from "@/server/session";

export const metadata: Metadata = {
  title: "Kelola Pengguna — invoice-me",
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.user.platformRole !== "SUPER_ADMIN") redirect("/unauthorized");

  const params = await searchParams;
  const requestedPage = Number(first(params.page) ?? "1");
  const page = Number.isFinite(requestedPage) && requestedPage > 0 ? Math.trunc(requestedPage) : 1;
  const q = (first(params.q) ?? "").slice(0, 100);
  const rawStatus = first(params.status);
  const status: UserStatus | undefined =
    rawStatus === "ACTIVE" || rawStatus === "SUSPENDED" ? rawStatus : undefined;
  const rawRole = first(params.role);
  const role: PlatformRole | undefined =
    rawRole === "SUPER_ADMIN" || rawRole === "USER" ? rawRole : undefined;

  const result = await listUsers({
    page,
    pageSize: USERS_PAGE_SIZE,
    q,
    status,
    platformRole: role,
  });

  const rows: AdminUserRow[] = result.rows.map((user) => ({
    id: user.id,
    username: user.username,
    name: user.name,
    email: user.email,
    platformRole: user.platformRole,
    status: user.status,
    mustChangePassword: user.mustChangePassword,
    createdAt: user.createdAt.toISOString(),
    membershipCount: user.membershipCount,
    isSelf: user.id === session.user.id,
  }));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Pengguna</h1>
          <p className="text-sm text-muted-foreground">
            Kelola akun platform: buat pengguna, tangguhkan, atur ulang kata sandi,
            dan cabut sesi.
          </p>
        </div>
        <CreateUserDialog />
      </div>
      <UsersTable
        rows={rows}
        total={result.total}
        page={result.page}
        pageSize={USERS_PAGE_SIZE}
        q={q}
        status={status ?? ""}
        role={role ?? ""}
      />
    </div>
  );
}
