// src/app/admin/system/page.tsx
// Feature 09 — system health for the self-hosted instance: database, storage
// writability and pdf-service reachability (the same probes /health runs, plus
// pdf-service), environment checks WITHOUT secret values, and version info.

import type { Metadata } from "next";
import { adminPageContext } from "@/app/admin/admin-ui";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  getSystemHealth,
  type HealthProbe,
} from "@/modules/admin/service";

export const metadata: Metadata = {
  title: "Kesehatan Sistem — Panel Admin — invoice-me",
};

export const dynamic = "force-dynamic";

function StatusBadge({ probe }: { probe: HealthProbe }) {
  return (
    <Badge variant={probe.status === "ok" ? "default" : "destructive"}>
      {probe.status === "ok" ? "Sehat" : "Tidak sehat"}
    </Badge>
  );
}

function ProbeCard({
  title,
  probe,
  description,
}: {
  title: string;
  probe: HealthProbe;
  description: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            {title}
          </CardTitle>
          <StatusBadge probe={probe} />
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-sm">
          {probe.status === "ok"
            ? probe.latencyMs !== undefined
              ? `Merespons dalam ${probe.latencyMs} ms.`
              : "Berfungsi normal."
            : probe.message ?? "Tidak berfungsi."}
        </p>
        <CardDescription className="mt-1">{description}</CardDescription>
      </CardContent>
    </Card>
  );
}

export default async function AdminSystemPage() {
  const ctx = await adminPageContext();
  const health = await getSystemHealth(ctx);
  const secrets = health.envChecks.filter((check) => check.value === null);
  const operational = health.envChecks.filter((check) => check.value !== null);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Kesehatan sistem</h1>
        <p className="text-sm text-muted-foreground">
          Pemeriksaan langsung terhadap database, volume penyimpanan, dan
          layanan PDF. Variabel rahasia hanya menampilkan status keberadaan —
          nilainya tidak pernah ditampilkan.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <ProbeCard
          title="Database"
          probe={health.database}
          description="Koneksi PostgreSQL yang dipakai seluruh aplikasi."
        />
        <ProbeCard
          title="Penyimpanan"
          probe={health.storage}
          description="Volume storage root dapat ditulisi (upload + PDF)."
        />
        <ProbeCard
          title="Layanan PDF"
          probe={health.pdfService}
          description="pdf-service (Playwright Chromium) merespons /health."
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Versi</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            <div className="flex items-center justify-between gap-4">
              <span className="text-muted-foreground">Aplikasi</span>
              <span className="font-medium tabular-nums">{health.version.app}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-muted-foreground">Node.js</span>
              <span className="font-medium tabular-nums">{health.version.node}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-muted-foreground">Next.js</span>
              <span className="font-medium tabular-nums">{health.version.next}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Variabel rahasia</CardTitle>
            <CardDescription>
              Hanya status keberadaan — nilai tidak pernah dikirim ke browser.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm">
            {secrets.map((check) => (
              <div key={check.name} className="flex items-center justify-between gap-4">
                <span className="truncate font-mono text-xs">{check.name}</span>
                <Badge variant={check.present ? "default" : "destructive"}>
                  {check.present ? "Terisi" : "Belum di-set"}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Konfigurasi operasional</CardTitle>
          <CardDescription>
            Nilai non-rahasia dari environment (baca saja — pengaturan runtime
            diatur di hosting, bukan di sini).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Variabel</TableHead>
                  <TableHead>Nilai</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {operational.map((check) => (
                  <TableRow key={check.name}>
                    <TableCell className="font-mono text-xs">{check.name}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {check.value ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
