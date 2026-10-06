"use client";

// src/components/projects/attachment-panel.tsx
// PO file upload for /projects/[id]: PDF/image, max 2MB, MIME sniffed
// SERVER-side by content (uploadProjectAttachmentAction → StorageService →
// validateUpload). The client checks below are convenience only — a renamed
// or re-typed hostile file is still judged by its bytes on the server.

import * as React from "react";
import { useRouter } from "next/navigation";
import { FileTextIcon, PaperclipIcon, Trash2Icon } from "lucide-react";
import { toast } from "@/components/ui/toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/forms/confirm-dialog";
import {
  removeProjectAttachmentAction,
  uploadProjectAttachmentAction,
} from "@/modules/projects/actions";

const ACCEPT = "application/pdf,image/png,image/jpeg,image/webp";

export interface AttachmentPanelProps {
  projectId: string;
  /** Stored path (null = no attachment yet) — also drives the view link. */
  attachmentPath: string | null;
  /** Server-side size ceiling, mirrored here for instant feedback. */
  maxMb: number;
  canEdit: boolean;
}

export function AttachmentPanel({
  projectId,
  attachmentPath,
  maxMb,
  canEdit,
}: AttachmentPanelProps) {
  const router = useRouter();
  const [file, setFile] = React.useState<File | null>(null);
  const [uploading, setUploading] = React.useState(false);
  const [removeOpen, setRemoveOpen] = React.useState(false);
  const [removing, setRemoving] = React.useState(false);

  async function upload(next: File | null) {
    if (!next) return;
    // Convenience pre-check: the server re-runs the same rule by content.
    if (next.size > maxMb * 1024 * 1024) {
      toast.add({
        title: "File terlalu besar",
        description: `Ukuran file melebihi batas ${maxMb} MB. Kompres atau pilih file yang lebih kecil.`,
        type: "error",
      });
      return;
    }
    setUploading(true);
    const form = new FormData();
    form.set("projectId", projectId);
    form.set("file", next);
    const result = await uploadProjectAttachmentAction(form);
    setUploading(false);
    if (result.ok) {
      toast.add({ title: "Lampiran diunggah", description: next.name, type: "success" });
      setFile(null);
      router.refresh();
      return;
    }
    toast.add({
      title: "Unggahan gagal",
      description: result.error.message,
      type: "error",
    });
  }

  async function confirmRemove() {
    setRemoving(true);
    const result = await removeProjectAttachmentAction({ projectId });
    setRemoving(false);
    if (result.ok) {
      toast.add({ title: "Lampiran dihapus", type: "success" });
      setRemoveOpen(false);
      router.refresh();
      return;
    }
    toast.add({
      title: "Gagal menghapus lampiran",
      description: result.error.message,
      type: "error",
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <PaperclipIcon aria-hidden="true" className="size-4 text-muted-foreground" />
          <div className="flex min-w-0 flex-col">
            <span className="text-sm font-medium">Lampiran referensi (PO)</span>
            <span className="text-xs text-muted-foreground">
              PDF, PNG, JPEG, atau WebP — maksimal {maxMb} MB. Tipe file diperiksa dari isi
              berkasnya, bukan dari nama file.
            </span>
          </div>
        </div>
        {attachmentPath ? <Badge variant="outline">Terlampir</Badge> : null}
      </div>

      {attachmentPath ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            render={<a href={`/api/storage/${attachmentPath}`} target="_blank" rel="noreferrer" />}
          >
            <FileTextIcon aria-hidden="true" />
            Lihat lampiran
          </Button>
          {canEdit ? (
            <Button variant="destructive" size="sm" onClick={() => setRemoveOpen(true)}>
              <Trash2Icon aria-hidden="true" />
              Hapus lampiran
            </Button>
          ) : null}
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
          Belum ada lampiran. Unggah file PO asli agar dokumen pendukung tersimpan bersama
          project ini.
        </p>
      )}

      {canEdit ? (
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="file"
              accept={ACCEPT}
              disabled={uploading}
              onChange={(event) => {
                const next = event.target.files?.[0] ?? null;
                setFile(next);
                void upload(next);
                event.target.value = "";
              }}
              className="text-sm file:mr-3 file:cursor-pointer file:rounded-md file:border file:border-border file:bg-background file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-muted"
            />
          </label>
          {uploading ? (
            <span className="text-sm text-muted-foreground">Mengunggah…</span>
          ) : file ? (
            <span className="text-sm text-muted-foreground">Terpilih: {file.name}</span>
          ) : null}
        </div>
      ) : null}

      <ConfirmDialog
        open={removeOpen}
        onOpenChange={setRemoveOpen}
        title="Hapus lampiran ini?"
        description="File PO akan dihapus dari penyimpanan. Tindakan tercatat di audit log."
        confirmLabel="Hapus lampiran"
        pending={removing}
        onConfirm={confirmRemove}
        trigger={<span className="hidden" aria-hidden="true" />}
      />
    </div>
  );
}
