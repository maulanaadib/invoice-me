"use client";

// src/components/tables/payments-table.tsx
// Payment list for /payments: server-side pagination + invoice / customer /
// date filters driven by the URL (same pattern as CustomersTable — the server
// owns the rows, the table only owns presentation). Empty and filtered-empty
// states included (ui-context).

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createColumnHelper,
  createPaginatedRowModel,
  rowPaginationFeature,
  tableFeatures,
  useTable,
  type PaginationState,
} from "@tanstack/react-table";
import { ChevronLeftIcon, ChevronRightIcon, FilterIcon } from "lucide-react";
import type { PaymentRowView } from "@/modules/payments/service";
import { PAYMENT_METHOD_LABELS } from "@/modules/payments/schema";
import { formatIdr } from "@/lib/money";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// Page size lives in @/modules/payments/schema (PAYMENTS_PAGE_SIZE): a plain
// constant imported from a "use client" module into a server page would come
// back as a client reference, not a number.

const features = tableFeatures({
  rowPaginationFeature,
  paginatedRowModel: createPaginatedRowModel(),
});
type PaymentTableFeatures = typeof features;
const columnHelper = createColumnHelper<PaymentTableFeatures, PaymentRowView>();

/** "YYYY-MM-DD" → "DD/MM/YYYY" — calendar string only. */
function formatDate(value: string): string {
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jakarta",
  });
}

const columns = columnHelper.columns([
  columnHelper.accessor((row) => row.paymentDate, {
    id: "date",
    header: "Tanggal",
    cell: (info) => <span className="whitespace-nowrap font-mono text-sm">{formatDate(info.getValue())}</span>,
  }),
  columnHelper.accessor((row) => row.invoiceLabel, {
    id: "invoice",
    header: "Invoice",
    cell: (info) => (
      <div className="flex min-w-0 flex-col">
        <Link
          href={`/invoices/${info.row.original.invoiceId}`}
          className="truncate font-mono font-medium hover:underline"
        >
          {info.getValue()}
        </Link>
        <span className="truncate text-xs text-muted-foreground">
          {info.row.original.customerName}
        </span>
      </div>
    ),
  }),
  columnHelper.accessor((row) => row.method, {
    id: "method",
    header: "Metode",
    cell: (info) => <span className="text-sm">{PAYMENT_METHOD_LABELS[info.getValue()]}</span>,
  }),
  columnHelper.accessor((row) => row.amount, {
    id: "amount",
    header: "Nominal",
    cell: (info) => (
      <span className="block text-right font-mono font-medium">
        {formatIdr(info.getValue())}
        {info.row.original.overpaymentReason ? (
          <span className="block text-xs font-normal text-warning">Melebihi sisa</span>
        ) : null}
      </span>
    ),
  }),
  columnHelper.accessor((row) => row.referenceNumber ?? "—", {
    id: "reference",
    header: "Referensi",
    cell: (info) => <span className="font-mono text-sm">{info.getValue()}</span>,
  }),
  columnHelper.accessor((row) => row.recordedByName, {
    id: "recordedBy",
    header: "Dicatat oleh",
    cell: (info) => <span className="text-sm">{info.getValue()}</span>,
  }),
  columnHelper.accessor((row) => row.createdAt, {
    id: "createdAt",
    header: "Waktu catat",
    cell: (info) => (
      <span className="whitespace-nowrap text-sm text-muted-foreground">
        {formatTimestamp(info.getValue())}
      </span>
    ),
  }),
  columnHelper.display({
    id: "actions",
    header: "Aksi",
    cell: (info) => (
      <div className="flex items-center justify-end">
        <Link
          href={`/invoices/${info.row.original.invoiceId}`}
          className={buttonVariants({ variant: "ghost", size: "sm" })}
        >
          Detail invoice
        </Link>
      </div>
    ),
  }),
]);

export interface PaymentsTableProps {
  rows: PaymentRowView[];
  total: number;
  page: number;
  pageSize: number;
  /** Active filters (URL-owned). */
  invoice: string;
  customer: string;
  from: string;
  to: string;
}

export function PaymentsTable({
  rows,
  total,
  page,
  pageSize,
  invoice,
  customer,
  from,
  to,
}: PaymentsTableProps) {
  const router = useRouter();
  const [invoiceInput, setInvoiceInput] = React.useState(invoice);
  const [customerInput, setCustomerInput] = React.useState(customer);
  const [fromInput, setFromInput] = React.useState(from);
  const [toInput, setToInput] = React.useState(to);

  const pagination: PaginationState = { pageIndex: page - 1, pageSize };
  const hasFilter = Boolean(invoice || customer || from || to);

  function push(next: {
    page?: number;
    invoice?: string;
    customer?: string;
    from?: string;
    to?: string;
  }) {
    const params = new URLSearchParams();
    const nextInvoice = next.invoice ?? invoice;
    const nextCustomer = next.customer ?? customer;
    const nextFrom = next.from ?? from;
    const nextTo = next.to ?? to;
    const nextPage = next.page ?? 1;
    if (nextInvoice) params.set("invoice", nextInvoice);
    if (nextCustomer) params.set("customer", nextCustomer);
    if (nextFrom) params.set("from", nextFrom);
    if (nextTo) params.set("to", nextTo);
    if (nextPage > 1) params.set("page", String(nextPage));
    const query = params.toString();
    router.push(`/payments${query ? `?${query}` : ""}`);
  }

  const table = useTable({
    features,
    columns,
    data: rows,
    manualPagination: true,
    rowCount: total,
    autoResetPageIndex: false,
    state: { pagination },
    onPaginationChange: (updater) => {
      const next = typeof updater === "function" ? updater(pagination) : updater;
      push({ page: next.pageIndex + 1 });
    },
  });

  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="flex flex-col gap-4">
      <form
        className="flex flex-col gap-2 lg:flex-row lg:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          push({
            page: 1,
            invoice: invoiceInput.trim(),
            customer: customerInput.trim(),
            from: fromInput,
            to: toInput,
          });
        }}
      >
        <div className="flex flex-1 flex-col gap-1">
          <label htmlFor="filter-invoice" className="text-xs text-muted-foreground">
            Invoice
          </label>
          <Input
            id="filter-invoice"
            value={invoiceInput}
            onChange={(event) => setInvoiceInput(event.target.value)}
            placeholder="Nomor invoice..."
            className="lg:w-56"
          />
        </div>
        <div className="flex flex-1 flex-col gap-1">
          <label htmlFor="filter-customer" className="text-xs text-muted-foreground">
            Customer
          </label>
          <Input
            id="filter-customer"
            value={customerInput}
            onChange={(event) => setCustomerInput(event.target.value)}
            placeholder="Nama perusahaan..."
            className="lg:w-56"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="filter-from" className="text-xs text-muted-foreground">
            Dari tanggal
          </label>
          <Input
            id="filter-from"
            type="date"
            value={fromInput}
            onChange={(event) => setFromInput(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="filter-to" className="text-xs text-muted-foreground">
            Sampai tanggal
          </label>
          <Input
            id="filter-to"
            type="date"
            value={toInput}
            onChange={(event) => setToInput(event.target.value)}
          />
        </div>
        <div className="flex items-center gap-2">
          <Button type="submit" variant="outline" size="sm">
            <FilterIcon aria-hidden="true" />
            Terapkan
          </Button>
          {hasFilter ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setInvoiceInput("");
                setCustomerInput("");
                setFromInput("");
                setToInput("");
                push({ page: 1, invoice: "", customer: "", from: "", to: "" });
              }}
            >
              Hapus filter
            </Button>
          ) : null}
        </div>
      </form>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-6 py-12 text-center text-sm text-muted-foreground">
          {hasFilter
            ? "Tidak ada pembayaran yang cocok dengan filter ini."
            : "Belum ada pembayaran tercatat di organisasi ini. Catat pembayaran lewat detail invoice."}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <TableHead key={header.id}>
                      {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getAllCells().map((cell) => (
                    <TableCell key={cell.id}>
                      <table.FlexRender cell={cell} />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          Total {total} pembayaran · Halaman {page} dari {pageCount}
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!table.getCanPreviousPage()}
            onClick={() => table.previousPage()}
          >
            <ChevronLeftIcon aria-hidden="true" />
            Sebelumnya
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!table.getCanNextPage()}
            onClick={() => table.nextPage()}
          >
            Berikutnya
            <ChevronRightIcon aria-hidden="true" />
          </Button>
        </div>
      </div>
    </div>
  );
}
