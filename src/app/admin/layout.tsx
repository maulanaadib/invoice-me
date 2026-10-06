import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { getWorkspaceOverview } from "@/modules/organizations/service";
import { getSession } from "@/server/session";

export const metadata: Metadata = {
  title: "Administrasi — invoice-me",
};

/**
 * Super admin gate for /admin/* — the proxy already redirects non-super-admins;
 * this server-side re-check exists because a compromised process must not mean
 * a bypass (defense in depth).
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.user.platformRole !== "SUPER_ADMIN") redirect("/unauthorized");

  const overview = await getWorkspaceOverview(session);

  return (
    <AppShell
      user={{
        name: session.user.name,
        username: session.user.username ?? null,
        email: session.user.email,
        platformRole: session.user.platformRole,
      }}
      memberships={overview.memberships}
      activeOrganizationId={overview.activeOrganizationId}
    >
      {children}
    </AppShell>
  );
}
