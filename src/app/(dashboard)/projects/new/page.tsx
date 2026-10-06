// src/app/(dashboard)/projects/new/page.tsx
// Create project/PO. VIEWER is redirected (no writable form for them) — the
// server action still re-checks with assertCan, so a crafted request gets 403.

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ProjectForm } from "@/components/projects/project-form";
import { can } from "@/modules/permissions/service";
import { resolveActiveOrgScope } from "@/modules/organizations/service";
import { getSession } from "@/server/session";

export const metadata: Metadata = {
  title: "Tambah Project — invoice-me",
};

export const dynamic = "force-dynamic";

export default async function NewProjectPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const scope = await resolveActiveOrgScope(session);
  if (!scope || !can("project.create", scope)) redirect("/projects");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Tambah project / PO</h1>
        <p className="text-sm text-muted-foreground">
          Simpan referensi PO/SPK/kontrak beserta lampirannya — data ini dipakai saat membuat
          invoice dari project.
        </p>
      </div>

      <ProjectForm
        mode="create"
        canEdit
        initialCustomerName=""
        defaultValues={{
          customerId: "",
          referenceType: "PURCHASE_ORDER",
          referenceNumber: "",
          referenceDate: "",
          title: "",
          description: "",
          workValue: "",
          currency: "IDR",
          startDate: "",
          endDate: "",
          status: "ACTIVE",
          notes: "",
        }}
      />
    </div>
  );
}
