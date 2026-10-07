// src/components/invoice/editor-state.test.ts
// Regression for the first-autosave failure (feature 04 review BUG-1): a
// brand-new editor opens with one blank template row (qty "1", empty price).
// That row IS worth saving (qty is pre-filled), so it reaches the server —
// and the SAME schema the server re-runs must accept it, normalizing the
// empty price to "0" instead of rejecting with "Harga harus angka".

import { describe, expect, it } from "vitest";
import { invoiceDraftFormSchema } from "@/modules/invoices/schema";
import {
  canAutosave,
  emptyEditorValues,
  toDraftPayload,
  worthSavingRows,
  type EditorFormValues,
} from "@/components/invoice/editor-state";

/** A fresh editor with the minimum a first save needs (profile + customer). */
function freshEditorValues(): EditorFormValues {
  const values = emptyEditorValues();
  values.profileId = "profile-1";
  values.customerId = "customer-1";
  return values;
}

describe("autosave with a blank item template", () => {
  it("sends the template row and the server schema accepts it (price '' → 0)", () => {
    const values = freshEditorValues();
    expect(canAutosave(values)).toBe(true);

    // The template row carries quantity "1", so it is worth saving — the
    // payload the editor would really send contains exactly one item.
    expect(worthSavingRows(values)).toHaveLength(1);
    const payload = toDraftPayload(values);
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0]?.unitPrice).toBe("");

    const parsed = invoiceDraftFormSchema.safeParse(payload);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.items).toHaveLength(1);
      expect(parsed.data.items[0]?.unitPrice).toBe("0");
      expect(parsed.data.items[0]?.quantity).toBe("1");
    }
  });

  it("treats a price field the user cleared as 0, not as a validation error", () => {
    const values = freshEditorValues();
    values.items = [
      { ...values.items[0]!, description: "Jasa pengawasan lapangan", unitPrice: "" },
    ];

    const parsed = invoiceDraftFormSchema.safeParse(toDraftPayload(values));
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.items[0]?.unitPrice).toBe("0");
  });

  it("still rejects a price that is not a number", () => {
    const values = freshEditorValues();
    values.items = [{ ...values.items[0]!, description: "Sewa alat", unitPrice: "1000rb" }];

    const parsed = invoiceDraftFormSchema.safeParse(toDraftPayload(values));
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((issue) => issue.message.includes("Harga harus angka"))).toBe(
        true,
      );
    }
  });
});
