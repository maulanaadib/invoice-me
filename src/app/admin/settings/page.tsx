// src/app/admin/settings/page.tsx
// Feature 09 — read-only platform settings (spec scope limit: "Tidak ada
// platform settings runtime editable — values dari env"). Everything shown
// here is echoed from the validated environment; there is no save button
// because there is nothing to save.

import type { Metadata } from "next";
import { adminPageContext } from "@/app/admin/admin-ui";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getPlatformSettings } from "@/modules/admin/service";

export const metadata: Metadata = {
  title: "Pengaturan Platform — Panel Admin — invoice-me",
};

export const dynamic = "force-dynamic";

export default async function AdminSettingsPage() {
  const ctx = await adminPageContext();
  const settings = await getPlatformSettings(ctx);

  const rows: Array<{ label: string; value: string; note?: string }> = [
    { label: "Timezone default", value: settings.defaultTimezone },
    { label: "Locale", value: settings.locale },
    { label: "Mata uang", value: settings.currency },
    {
      label: "Batas ukuran upload",
      value: `${settings.uploadMaxMb} MB`,
      note: "Berlaku untuk logo, tanda tangan, PO, dan bukti pembayaran",
    },
    { label: "Root penyimpanan", value: settings.storageRoot },
    { label: "Worker PDF", value: settings.pdfWorkerEnabled === "true" ? "Aktif" : "Nonaktif" },
    { label: "URL aplikasi", value: settings.appUrl },
    { label: "Mode environment", value: settings.nodeEnv },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Pengaturan platform</h1>
        <p className="text-sm text-muted-foreground">
          Konfigurasi baca-saja dari environment. Perubahan dilakukan di
          hosting (Coolify) lalu aplikasi di-deploy ulang — tidak ada pengaturan
          runtime yang bisa diubah dari sini.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Konfigurasi aktif</CardTitle>
          <CardDescription>
            Sumber: environment variable tervalidasi saat aplikasi mulai.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {rows.map((row) => (
            <div
              key={row.label}
              className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border pb-3 last:border-0 last:pb-0"
            >
              <div className="flex flex-col">
                <span className="text-sm font-medium">{row.label}</span>
                {row.note ? (
                  <span className="text-xs text-muted-foreground">{row.note}</span>
                ) : null}
              </div>
              <span className="font-mono text-sm text-muted-foreground">{row.value}</span>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
