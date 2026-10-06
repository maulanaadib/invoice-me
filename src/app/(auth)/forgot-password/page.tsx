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
  title: "Lupa Kata Sandi — invoice-me",
};

export default function ForgotPasswordPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Lupa kata sandi?</CardTitle>
        <CardDescription>
          Pengaturan ulang kata sandi dilakukan oleh administrator.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          invoice-me tidak mengirim email reset kata sandi. Hubungi super admin
          atau admin organisasi Anda untuk menyetel ulang kata sandi akun Anda.
          Setelah kata sandi baru diatur, Anda akan diminta menggantinya saat
          masuk berikutnya.
        </p>
        <Button render={<Link href="/login">Kembali ke halaman masuk</Link>} />
      </CardContent>
    </Card>
  );
}
