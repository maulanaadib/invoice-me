import type { Metadata } from "next";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Akses Ditolak — invoice-me",
};

export default function UnauthorizedPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Akses ditolak</CardTitle>
        <CardDescription>403 — Halaman ini hanya untuk super admin.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          Akun Anda tidak memiliki izin untuk membuka halaman administrasi
          platform. Jika Anda merasa ini keliru, hubungi super admin.
        </p>
        <Button render={<Link href="/dashboard">Kembali ke dashboard</Link>} variant="outline" />
      </CardContent>
    </Card>
  );
}
