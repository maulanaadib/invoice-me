import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ChangePasswordForm } from "@/components/forms/change-password-form";
import { getSession } from "@/server/session";

export const metadata: Metadata = {
  title: "Ubah Kata Sandi — invoice-me",
};

export default async function ChangePasswordPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  return <ChangePasswordForm forced={session.user.mustChangePassword === true} />;
}
