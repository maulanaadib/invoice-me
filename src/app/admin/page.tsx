// src/app/admin/page.tsx
// Feature 09 — super-admin overview. Every number is an aggregate read from
// the database at request time (never client math): the dashboard metric
// definitions from feature 08 are reused so the admin overview and the
// per-org dashboard can never disagree about what "bulan ini" means.

import type { Metadata } from "next";
import { adminPageContext, formatBytes } from "@/app/admin/admin-ui";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatIdr } from "@/lib/money";
import { getAdminOverview } from "@/modules/admin/service";

export const metadata: Metadata = {
  title: "Ringkasan Platform — invoice-me",
};

export const dynamic = "force-dynamic";

interface StatCard {
  label: string;
  value: string;
  description: string;
}

export default async function AdminOverviewPage() {
  const ctx = await adminPageContext();
  const overview = await getAdminOverview(ctx);

  const cards: StatCard[] = [
    {
      label: "Pengguna",
      value: String(overview.totalUsers),
      description: `${overview.activeUsers} aktif · ${overview.suspendedUsers} ditangguhkan`,
    },
    {
      label: "Organisasi",
      value: String(overview.totalOrganizations),
      description: `${overview.suspendedOrganizations} ditangguhkan`,
    },
    {
      label: "Invoice hari ini",
      value: String(overview.invoicesToday),
      description: "Berdasarkan tanggal invoice (waktu Jakarta)",
    },
    {
      label: "Invoice bulan ini",
      value: String(overview.invoicesThisMonth),
      description: "Semua status, bulan berjalan",
    },
    {
      label: "Nilai invoice bulan ini",
      value: formatIdr(overview.invoiceValueThisMonth),
      description: "Invoice terbit (ISSUED s/d PAID) pada bulan berjalan",
    },
    {
      label: "PDF berhasil",
      value: String(overview.pdfSuccess),
      description: `${overview.pdfFailed} gagal · ${overview.pdfPending} dalam antrean`,
    },
    {
      label: "Penyimpanan terpakai",
      value: formatBytes(overview.storageTotalBytes),
      description: "Total upload + PDF resmi seluruh organisasi",
    },
    {
      label: "Login gagal",
      value: String(overview.loginFailures),
      description: "Total percobaan gagal (semua waktu)",
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Ringkasan platform</h1>
        <p className="text-sm text-muted-foreground">
          Kondisi instance self-hosted: pengguna, organisasi, tagihan, job PDF,
          penyimpanan, dan keamanan masuk.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <Card key={card.label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {card.label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-semibold tracking-tight tabular-nums">
                {card.value}
              </p>
              <CardDescription className="mt-1">{card.description}</CardDescription>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
