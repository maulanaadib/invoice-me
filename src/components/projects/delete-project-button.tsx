"use client";

// src/components/projects/delete-project-button.tsx
// Hard-delete trigger for /projects/[id] with a confirm dialog (ui-context).
// The file is removed server-side best-effort; the audit row records the
// removal (PROJECT_UPDATED with change: "deleted" — see service comment).

import * as React from "react";
import { useRouter } from "next/navigation";
import { Trash2Icon } from "lucide-react";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/forms/confirm-dialog";
import { deleteProjectAction } from "@/modules/projects/actions";

export interface DeleteProjectButtonProps {
  projectId: string;
  title: string;
}

export function DeleteProjectButton({ projectId, title }: DeleteProjectButtonProps) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);

  async function confirmDelete() {
    setPending(true);
    const result = await deleteProjectAction({ projectId });
    setPending(false);
    if (result.ok) {
      toast.add({
        title: "Project dihapus",
        description: title,
        type: "success",
      });
      setOpen(false);
      router.push("/projects");
      router.refresh();
      return;
    }
    toast.add({
      title: "Gagal menghapus project",
      description: result.error.message,
      type: "error",
    });
  }

  return (
    <>
      <Button variant="destructive" size="sm" onClick={() => setOpen(true)}>
        <Trash2Icon aria-hidden="true" />
        Hapus project
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Hapus project ini?"
        description={`${title} beserta lampirannya akan dihapus permanen. Tindakan tercatat di audit log.`}
        confirmLabel="Hapus project"
        pending={pending}
        onConfirm={confirmDelete}
        trigger={<span className="hidden" aria-hidden="true" />}
      />
    </>
  );
}
