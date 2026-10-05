import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Dashboard — invoice-me",
};

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
