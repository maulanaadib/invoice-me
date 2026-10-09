import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import type { NavVisibility } from "@/components/layout/nav-config";
import { can } from "@/modules/permissions/service";
import { getWorkspaceOverview, resolveActiveOrgScope } from "@/modules/organizations/service";
import { getSession } from "@/server/session";

export const metadata: Metadata = {
  title: "Dashboard — invoice-me",
};

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  // Defense in depth: the proxy already routes this, but a compromised
  // process must not expose the dashboard to an un-onboarded user.
  if (
    session.user.platformRole !== "SUPER_ADMIN" &&
    session.user.onboardingComplete !== true
  ) {
    redirect("/onboarding");
  }

  const overview = await getWorkspaceOverview(session);
  const scope = await resolveActiveOrgScope(session);

  // Permission-aware menu (feature 08): flags come from the central matrix;
  // no active workspace → gated entries stay hidden (fail closed).
  const navVisibility: NavVisibility = {
    payments: scope ? can("payment.view", scope) : false,
    customers: scope ? can("customer.view", scope) : false,
    projects: scope ? can("project.view", scope) : false,
    bankAccounts: scope ? can("bankAccount.view", scope) : false,
    signers: scope ? can("signer.view", scope) : false,
  };

  return (
    <AppShell
      user={{
        name: session.user.name,
        username: session.user.username ?? null,
        email: session.user.email,
        platformRole: session.user.platformRole ?? "USER",
      }}
      memberships={overview.memberships}
      activeOrganizationId={overview.activeOrganizationId}
      navVisibility={navVisibility}
    >
      {children}
    </AppShell>
  );
}
