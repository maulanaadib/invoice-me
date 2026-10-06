import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getWorkspaceOverview } from "@/modules/organizations/service";
import { getSession } from "@/server/session";

export const metadata: Metadata = {
  title: "Dashboard — invoice-me",
};

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const overview = await getWorkspaceOverview(session);
  const active =
    overview.memberships.find(
      (membership) => membership.organization.id === overview.activeOrganizationId,
    ) ?? overview.memberships[0];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Selamat datang, {session.user.name || session.user.username || session.user.email}
        </h1>
        <p className="text-sm text-muted-foreground">
          Anda masuk sebagai{" "}
          {session.user.platformRole === "SUPER_ADMIN" ? "super admin platform" : "pengguna"}.
        </p>
      </div>

      {active ? (
        <Card>
          <CardHeader>
            <CardTitle>Workspace aktif</CardTitle>
            <CardDescription>
              Semua data yang Anda lihat dan ubah dibatasi ke organisasi ini.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex items-center justify-between gap-4">
            <div className="flex min-w-0 flex-col">
              <span className="truncate font-medium">{active.organization.name}</span>
              <span className="truncate text-xs text-muted-foreground">
                {active.organization.slug}
              </span>
            </div>
            <Badge variant="outline">{active.role}</Badge>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Belum ada workspace</CardTitle>
            <CardDescription>
              Akun Anda belum menjadi anggota organisasi mana pun. Hubungi super
              admin untuk diundang ke sebuah workspace.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      <section aria-label="Workspace Anda" className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">
          Workspace Anda ({overview.memberships.length})
        </h2>
        {overview.memberships.length === 0 ? (
          <p className="text-sm text-muted-foreground">—</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {overview.memberships.map((membership) => (
              <li
                key={membership.organization.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3"
              >
                <span className="min-w-0 truncate text-sm font-medium">
                  {membership.organization.name}
                </span>
                <Badge variant="secondary">{membership.role}</Badge>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
