import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { getWorkspaceOverview } from "@/modules/organizations/service";
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
    >
      {children}
    </AppShell>
  );
}
