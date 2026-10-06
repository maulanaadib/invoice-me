"use client";

// src/components/customers/contacts-panel.tsx
// PIC (CustomerContact) management tab on /customers/[id]: list, add, edit,
// delete, and set primary. All mutations go through server actions that
// authorize in the service layer — this component only doesn't waste the
// clicks of a read-only viewer.

import * as React from "react";
import { useRouter } from "next/navigation";
import { PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { toast } from "@/components/ui/toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { deleteContactAction } from "@/modules/customers/actions";
import type { ContactView } from "@/modules/customers/service";
import { ConfirmDialog } from "@/components/forms/confirm-dialog";
import { ContactDialog } from "@/components/customers/contact-dialog";

export interface ContactsPanelProps {
  customerId: string;
  contacts: ContactView[];
  canEdit: boolean;
}

export function ContactsPanel({ customerId, contacts, canEdit }: ContactsPanelProps) {
  const router = useRouter();
  const [dialog, setDialog] = React.useState<{ open: boolean; contact: ContactView | null }>({
    open: false,
    contact: null,
  });
  const [deleteTarget, setDeleteTarget] = React.useState<ContactView | null>(null);
  const [deleting, setDeleting] = React.useState(false);

  function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    void (async () => {
      const result = await deleteContactAction({ contactId: deleteTarget.id });
      setDeleting(false);
      if (result.ok) {
        toast.add({ title: "PIC dihapus", description: deleteTarget.name, type: "success" });
        setDeleteTarget(null);
        router.refresh();
      } else {
        toast.add({ title: "Gagal menghapus PIC", description: result.error.message, type: "error" });
      }
    })();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {contacts.length > 0
            ? `${contacts.length} PIC terdaftar untuk customer ini.`
            : "Belum ada PIC untuk customer ini."}
        </p>
        {canEdit ? (
          <Button size="sm" onClick={() => setDialog({ open: true, contact: null })}>
            <PlusIcon aria-hidden="true" />
            Tambah PIC
          </Button>
        ) : null}
      </div>

      {contacts.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground">
          Tambahkan PIC (nama, jabatan, kontak) agar tim penagihan tahu harus menghubungi siapa
          di customer ini.
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {contacts.map((contact) => (
            <li
              key={contact.id}
              className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex min-w-0 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{contact.name}</span>
                  {contact.isPrimary ? <Badge>PIC utama</Badge> : null}
                </div>
                <p className="text-xs text-muted-foreground">
                  {[contact.title, contact.division].filter(Boolean).join(" · ") || "—"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {[
                    contact.email,
                    contact.phone,
                    contact.whatsapp,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "Tidak ada kontak"}
                </p>
              </div>
              {canEdit ? (
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setDialog({ open: true, contact })}
                  >
                    <PencilIcon aria-hidden="true" />
                    Edit
                  </Button>
                  <Button variant="destructive" size="sm" onClick={() => setDeleteTarget(contact)}>
                    <Trash2Icon aria-hidden="true" />
                    Hapus
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <ContactDialog
        customerId={customerId}
        contact={dialog.contact}
        open={dialog.open}
        onOpenChange={(open) => setDialog((current) => ({ ...current, open }))}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="Hapus PIC ini?"
        description={`${deleteTarget?.name ?? "PIC"} akan dihapus permanen dari customer ini. Tindakan tercatat di audit log.`}
        confirmLabel="Hapus PIC"
        pending={deleting}
        onConfirm={confirmDelete}
        trigger={<span className="hidden" aria-hidden="true" />}
      />
    </div>
  );
}
