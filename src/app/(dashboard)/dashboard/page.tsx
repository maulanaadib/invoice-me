// src/app/(dashboard)/dashboard/page.tsx
// Dashboard (feature 08): seven summary cards from database aggregates, a
// ringkas 12-month tagihan-vs-pembayaran chart (recharts), and the 5 newest
// activity events. Everything is loaded for the ACTIVE workspace only
// (org isolation) and gated by invoice.view — no scope, no numbers.

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ActivityTimeline } from "@/components/dashboard/activity-timeline";
import { MonthlyChart } from "@/components/dashboard/monthly-chart";
import { SummaryCards } from "@/components/dashboard/summary-cards";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  getDashboardCards,
  getMonthlySeries,
  getRecentActivity,
} from "@/modules/dashboard/service";
import { resolveActiveOrgScope } from "@/modules/organizations/service";
import { getSession } from "@/server/session";

export const metadata: Metadata = {
  title: "Dashboard — invoice-me",
};

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const scope = await resolveActiveOrgScope(session);
  if (!scope) {
    return (
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Ringkasan tagihan dan pembayaran workspace aktif Anda.
          </p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Belum ada workspace aktif</CardTitle>
            <CardDescription>
              Pilih atau buat organisasi terlebih dahulu untuk melihat ringkasan
              invoice.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const [cards, series, activity] = await Promise.all([
    getDashboardCards({ scope }),
    getMonthlySeries({ scope }),
    getRecentActivity({ scope }),
  ]);

  const displayName = session.user.name || session.user.username || session.user.email;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Halo, {displayName}
        </h1>
        <p className="text-sm text-muted-foreground">
          Ringkasan invoice dan pembayaran workspace aktif Anda.
        </p>
      </div>

      <SummaryCards cards={cards} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Tagihan vs pembayaran</CardTitle>
            <CardDescription>
              12 bulan terakhir — invoice terbit dibanding pembayaran yang masuk.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {series.empty ? (
              <div
                className="rounded-lg border border-dashed border-border px-6 py-12 text-center text-sm text-muted-foreground"
                data-testid="dashboard-chart-empty"
              >
                Belum ada tagihan atau pembayaran dalam 12 bulan terakhir.
                Grafik muncul begitu ada invoice terbit.
              </div>
            ) : (
              <MonthlyChart points={series.points} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Aktivitas terbaru</CardTitle>
            <CardDescription>5 event terakhir di organisasi ini.</CardDescription>
          </CardHeader>
          <CardContent>
            <ActivityTimeline items={activity} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
