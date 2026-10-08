import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import type { NavVisibility } from "@/components/layout/nav-config";
import { can } from "@/modules/permissions/service";
import { getWorkspaceOverview, resolveActiveOrgScope } from "@/modules/organizations/service";
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
  // Same permission-aware sidebar flags as the dashboard shell (fail closed
  // when this super admin has no active workspace membership).
  const scope = await resolveActiveOrgScope(session);
  const navVisibility: NavVisibility = {
    payments: scope ? can("payment.view", scope) : false,
    customers: scope ? can("customer.view", scope) : false,
    projects: scope ? can("project.view", scope) : false,
  };

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
      navVisibility={navVisibility}
    >
      {children}
    </AppShell>
  );
}
