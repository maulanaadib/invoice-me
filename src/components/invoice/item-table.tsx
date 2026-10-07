"use client";

// src/components/invoice/item-table.tsx
// Dynamic work-item table (feature 04): add / remove / duplicate / drag
// reorder (@dnd-kit sortable + keyboard sensor), unit preset dropdown with a
// free-text custom option, per-row live line amount (same decimal engine as
// the server), qty > 0 / price >= 0 row feedback, and the max-50-items guard.
// Rows are keyed by a stable `key` (never the array index) so inputs keep
// focus while typing and a reorder never swaps values between rows.

import * as React from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CopyIcon, GripVerticalIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CurrencyInput } from "@/components/projects/currency-input";
import { groupDigits } from "@/lib/money";
import { calculateInvoice } from "@/modules/invoices/calculation";
import { MAX_INVOICE_ITEMS } from "@/modules/invoices/schema";
import { newItemRow, type EditorItemRow } from "@/components/invoice/editor-state";

export const UNIT_PRESETS = ["Unit", "Pcs", "Set", "Lot", "Paket", "Jasa", "Jam", "Hari", "Bulan"] as const;
const CUSTOM_UNIT = "__custom__";

export interface ItemTableProps {
  items: EditorItemRow[];
  onChange: (items: EditorItemRow[]) => void;
  disabled?: boolean;
}

/** Row-local quantity rule (mirrors the zod item schema): must parse > 0. */
function quantityError(value: string): string | null {
  if (value.trim() === "") return "Isi jumlah";
  if (!/^\d{1,15}(\.\d{1,2})?$/.test(value.trim())) return "Angka tidak valid";
  return Number(value) > 0 ? null : "Harus > 0";
}

/** Row-local unit price rule: blank counts as 0 (draft leniency), never < 0. */
function priceError(value: string): string | null {
  if (value.trim() === "") return null;
  return /^\d{1,15}(\.\d{1,2})?$/.test(value.trim()) ? null : "Angka tidak valid";
}

export function ItemTable({ items, onChange, disabled = false }: ItemTableProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Live per-line amounts for display: one shared calculation over the rows
  // (identical engine/formulas to the server's recalculation).
  const lineAmounts = React.useMemo(() => {
    try {
      return calculateInvoice({
        invoiceType: "FULL",
        taxMode: "NONE",
        items: items.map((row) => ({
          quantity: quantityError(row.quantity) ? "0" : row.quantity,
          unitPrice: priceError(row.unitPrice) ? "0" : row.unitPrice,
          discountAmount: row.discountAmount || "0",
        })),
      }).lineAmounts;
    } catch {
      return items.map(() => "0.00");
    }
  }, [items]);

  function updateRow(index: number, patch: Partial<EditorItemRow>) {
    const next = items.slice();
    next[index] = { ...next[index]!, ...patch };
    onChange(next);
  }

  function addRow() {
    if (items.length >= MAX_INVOICE_ITEMS) return;
    onChange([...items, newItemRow()]);
  }

  function duplicateRow(index: number) {
    if (items.length >= MAX_INVOICE_ITEMS) return;
    const source = items[index]!;
    const copy = { ...source, key: `item-${crypto.randomUUID()}` };
    const next = items.slice();
    next.splice(index + 1, 0, copy);
    onChange(next);
  }

  function removeRow(index: number) {
    onChange(items.filter((_, i) => i !== index));
  }

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = items.findIndex((row) => row.key === active.id);
    const to = items.findIndex((row) => row.key === over.id);
    if (from === -1 || to === -1) return;
    onChange(arrayMove(items, from, to));
  }

  const atLimit = items.length >= MAX_INVOICE_ITEMS;

  return (
    <div className="flex flex-col gap-3">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={items.map((row) => row.key)} strategy={rectSortingStrategy}>
          <div className="flex flex-col gap-2">
            {items.map((row, index) => (
              <SortableItemRow
                key={row.key}
                row={row}
                index={index}
                amount={lineAmounts[index] ?? "0.00"}
                disabled={disabled}
                canRemove={items.length > 1}
                onChange={(patch) => updateRow(index, patch)}
                onDuplicate={() => duplicateRow(index)}
                onRemove={() => removeRow(index)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      <div className="flex items-center justify-between">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addRow}
          disabled={disabled || atLimit}
        >
          <PlusIcon aria-hidden="true" />
          Tambah item
        </Button>
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {items.length} / {MAX_INVOICE_ITEMS} item
          {atLimit ? " — batas maksimum tercapai" : ""}
        </p>
      </div>
    </div>
  );
}

interface SortableItemRowProps {
  row: EditorItemRow;
  index: number;
  amount: string;
  disabled: boolean;
  canRemove: boolean;
  onChange: (patch: Partial<EditorItemRow>) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}

function SortableItemRow({
  row,
  index,
  amount,
  disabled,
  canRemove,
  onChange,
  onDuplicate,
  onRemove,
}: SortableItemRowProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: row.key, disabled });

  const qtyError = quantityError(row.quantity);
  const priceInvalid = priceError(row.unitPrice);
  const isCustomUnit = !UNIT_PRESETS.some((unit) => unit === row.unit);

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`rounded-lg border bg-card p-3 ${isDragging ? "z-10 opacity-80 shadow-lg" : ""}`}
      aria-label={`Item ${index + 1}`}
    >
      <div className="grid grid-cols-[auto_1fr] gap-2 sm:grid-cols-[auto_minmax(0,1fr)_84px_112px_150px_130px_auto] sm:items-center">
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          disabled={disabled}
          aria-label={`Susun ulang item ${index + 1} — gunakan tombol panah setelah fokus`}
          className="cursor-grab touch-none rounded p-1 text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring active:cursor-grabbing"
        >
          <GripVerticalIcon aria-hidden="true" className="size-4" />
        </button>

        <div className="flex min-w-0 flex-col gap-1">
          <Label htmlFor={`item-desc-${row.key}`} className="sr-only">
            Deskripsi item {index + 1}
          </Label>
          <Input
            id={`item-desc-${row.key}`}
            placeholder="Uraian pekerjaan *"
            value={row.description}
            disabled={disabled}
            onChange={(event) => onChange({ description: event.target.value })}
          />
          <Input
            aria-label={`Detail item ${index + 1} (opsional)`}
            placeholder="Detail / sub-uraian (opsional)"
            className="h-7 text-xs"
            value={row.details}
            disabled={disabled}
            onChange={(event) => onChange({ details: event.target.value })}
          />
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor={`item-qty-${row.key}`} className="sr-only">
            Qty item {index + 1}
          </Label>
          <Input
            id={`item-qty-${row.key}`}
            inputMode="decimal"
            placeholder="Qty"
            className="text-right font-mono"
            aria-invalid={qtyError ? true : undefined}
            value={row.quantity}
            disabled={disabled}
            onChange={(event) => onChange({ quantity: event.target.value })}
          />
          {qtyError ? (
            <span className="text-[11px] leading-none text-destructive sm:hidden">{qtyError}</span>
          ) : null}
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor={`item-unit-${row.key}`} className="sr-only">
            Unit item {index + 1}
          </Label>
          <Select
            value={isCustomUnit ? CUSTOM_UNIT : row.unit}
            onValueChange={(value) => {
              if (value === CUSTOM_UNIT) onChange({ unit: "" });
              else onChange({ unit: String(value ?? "") });
            }}
            disabled={disabled}
          >
            <SelectTrigger id={`item-unit-${row.key}`} className="w-full" aria-label={`Unit item ${index + 1}`}>
              <SelectValue placeholder="Unit" />
            </SelectTrigger>
            <SelectContent>
              {UNIT_PRESETS.map((unit) => (
                <SelectItem key={unit} value={unit}>
                  {unit}
                </SelectItem>
              ))}
              <SelectItem value={CUSTOM_UNIT}>Unit khusus…</SelectItem>
            </SelectContent>
          </Select>
          {isCustomUnit ? (
            <CustomUnitInput row={row} disabled={disabled} onChange={onChange} />
          ) : null}
        </div>

        <div className="flex flex-col gap-1">
          <CurrencyInput
            id={`item-price-${row.key}`}
            value={row.unitPrice}
            disabled={disabled}
            placeholder="Harga/satuan"
            aria-invalid={priceInvalid ? true : undefined}
            onValueChange={(raw) => onChange({ unitPrice: raw })}
          />
        </div>

        <div className="flex items-center justify-between gap-1 sm:flex-col sm:items-end sm:justify-center">
          <span className="text-[11px] text-muted-foreground sm:hidden">Jumlah</span>
          <span className="text-right font-mono text-sm tabular-nums" title="Qty × harga (preview)">
            Rp {groupDigits(amount)}
          </span>
        </div>

        <div className="col-start-2 flex justify-end gap-1 sm:col-start-auto sm:col-span-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 text-muted-foreground hover:text-foreground"
            onClick={onDuplicate}
            disabled={disabled}
            aria-label={`Duplikat item ${index + 1}`}
          >
            <CopyIcon aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 text-muted-foreground hover:text-destructive"
            onClick={onRemove}
            disabled={disabled || !canRemove}
            aria-label={`Hapus item ${index + 1}`}
          >
            <Trash2Icon aria-hidden="true" />
          </Button>
        </div>
      </div>
      {qtyError || priceInvalid ? (
        <p className="mt-1 hidden text-[11px] text-destructive sm:block" role="alert">
          {qtyError ?? priceInvalid} — item ini belum dihitung benar.
        </p>
      ) : null}
    </div>
  );
}

function CustomUnitInput({
  row,
  disabled,
  onChange,
}: {
  row: EditorItemRow;
  disabled: boolean;
  onChange: (patch: Partial<EditorItemRow>) => void;
}) {
  return (
    <Input
      aria-label="Nama unit khusus"
      placeholder="mis. m², roll"
      className="h-7 text-xs"
      value={row.unit}
      disabled={disabled}
      onChange={(event) => onChange({ unit: event.target.value.slice(0, 20) })}
    />
  );
}
