"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCcwIcon } from "lucide-react";
import { retryPdfJobAction } from "@/modules/admin/actions";
import type { ActionResult } from "@/lib/api-response";
import { toast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";

/**
 * Re-enqueues a FAILED PDF job (feature 09). Result-aware: success refreshes
 * the list so the row shows PENDING immediately, failure surfaces the service
 * message — the button never pretends an action happened.
 */
export function RetryPdfJobButton({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    async (_prev, form) => {
      const result = await retryPdfJobAction(form);
      if (result.ok) {
        toast.add({
          title: "Job PDF diantrekan ulang",
          description: "Worker akan memprosesnya pada siklus berikutnya.",
          type: "success",
        });
        router.refresh();
      } else {
        toast.add({ title: "Gagal mengulang job", description: result.error.message, type: "error" });
      }
      return result;
    },
    null,
  );

  return (
    <form action={formAction} className="inline-flex">
      <input type="hidden" name="jobId" value={jobId} />
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        <RefreshCcwIcon aria-hidden="true" />
        {pending ? "Mengantre…" : "Ulangi"}
      </Button>
      <span className="sr-only">
        {state && !state.ok ? state.error.message : ""}
      </span>
    </form>
  );
}
