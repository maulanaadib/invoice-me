// src/app/(dashboard)/customers/page.tsx
// Customer list: server-side pagination + search (URL-driven), TanStack Table
// presentation in CustomersTable. Reads require an active-org scope only;
// the "Tambah customer" entry is shown to STAFF+ (server actions re-check).

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PlusIcon } from "lucide-react";
import { CustomersTable, CUSTOMERS_PAGE_SIZE } from "@/components/tables/customers-table";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { can } from "@/modules/permissions/service";
import { listCustomers } from "@/modules/customers/service";
import { resolveActiveOrgScope } from "@/modules/organizations/service";
import { getSession } from "@/server/session";

export const metadata: Metadata = {
  title: "Customer — invoice-me",
};

export const dynamic = "force-dynamic";

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const scope = await resolveActiveOrgScope(session);
  const params = await searchParams;
  const page = Math.max(1, Number(first(params.page) ?? "1") || 1);
  const q = (first(params.q) ?? "").slice(0, 100);

  if (!scope) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-2xl font-semibold tracking-tight">Customer</h1>
        <Card>
          <CardHeader>
            <CardTitle>Belum ada workspace aktif</CardTitle>
            <CardDescription>
              Pilih atau buat organisasi terlebih dahulu untuk mengelola customer.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const result = await listCustomers({ scope }, { page, pageSize: CUSTOMERS_PAGE_SIZE, q });
  const mayCreate = can("customer.create", scope);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Customer</h1>
          <p className="text-sm text-muted-foreground">
            Master data customer dan PIC untuk penagihan. Soft delete: customer yang dihapus
            tetap tercatat di audit log.
          </p>
        </div>
        {mayCreate ? (
          <Button render={<Link href="/customers/new" />}>
            <PlusIcon aria-hidden="true" />
            Tambah customer
          </Button>
        ) : null}
      </div>

      <CustomersTable
        rows={result.rows}
        total={result.total}
        page={result.page}
        pageSize={result.pageSize}
        q={q}
      />
    </div>
  );
}
