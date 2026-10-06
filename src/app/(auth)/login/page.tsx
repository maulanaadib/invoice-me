import type { Metadata } from "next";
import { LoginForm } from "@/components/forms/login-form";

export const metadata: Metadata = {
  title: "Masuk — invoice-me",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  return <LoginForm next={typeof params.next === "string" ? params.next : null} />;
}
