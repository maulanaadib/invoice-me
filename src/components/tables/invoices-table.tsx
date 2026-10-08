"use client";

// src/components/tables/invoices-table.tsx
// Invoice list (feature 08): TanStack Table owns the CLIENT state (column
// definitions, pagination + sorting UI), the SERVER owns the rows — every
// page/sort/filter change is pushed into the URL and refetched by the server
// component (pagination mode, manual sorting). Row actions come from the
// server-computed permission flags on each row (see query-service).

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createColumnHelper,
  createPaginatedRowModel,
  rowPaginationFeature,
  rowSortingFeature,
  tableFeatures,
  useTable,
  type Column,
  type PaginationState,
  type SortingState,
} from "@tanstack/react-table";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ArrowUpDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  FilterIcon,
} from "lucide-react";
import { InvoiceRowActions } from "@/components/invoice/invoice-row-actions";
import {
  INVOICE_STATUS_LABELS,
  InvoiceStatusBadge,
} from "@/components/invoice/invoice-status-badge";
import { INVOICE_TYPE_LABELS } from "@/modules/invoices/schema";
import type { InvoiceListRow } from "@/modules/invoices/query-service";
import { formatIdr } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

// Page size lives in @/modules/invoices/query-service (INVOICES_PAGE_SIZE) —
// a constant imported from a "use client" module into a server page would
// come back as a client reference, not a number (feature 07 lesson).

const features = tableFeatures({
  rowPaginationFeature,
  rowSortingFeature,
  paginatedRowModel: createPaginatedRowModel(),
});
type InvoiceTableFeatures = typeof features;
const columnHelper = createColumnHelper<InvoiceTableFeatures, InvoiceListRow>();

export interface InvoiceListFilters {
  q: string;
  customer: string;
  profile: string;
  status: string;
  type: string;
  from: string;
  to: string;
  sort: string;
  dir: string;
}

/** "YYYY-MM-DD" → "DD/MM/YYYY" — calendar string only. */
function formatDate(value: string): string {
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}

function SortHeader<TValue>({
  label,
  column,
  align = "left",
}: {
  label: string;
  column: Column<InvoiceTableFeatures, InvoiceListRow, TValue>;
  align?: "left" | "right";
}) {
  const sorted = column.getIsSorted();
  if (!column.getCanSort()) {
    return <span className={align === "right" ? "block text-right" : undefined}>{label}</span>;
  }
  const directionLabel =
    sorted === "asc" ? " (urut naik)" : sorted === "desc" ? " (urut turun)" : "";
  return (
    <button
      type="button"
      onClick={column.getToggleSortingHandler()}
      className={`inline-flex items-center gap-1 rounded-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring ${
        align === "right" ? "w-full justify-end" : ""
      }`}
    >
      {label}
      {sorted === "asc" ? (
        <ArrowUpIcon className="size-3" aria-hidden="true" />
      ) : sorted === "desc" ? (
        <ArrowDownIcon className="size-3" aria-hidden="true" />
      ) : (
        <ArrowUpDownIcon className="size-3 opacity-40" aria-hidden="true" />
      )}
      <span className="sr-only">{directionLabel}</span>
    </button>
  );
}

function buildColumns(meta: {
  canOverrideOverpayment: boolean;
  uploadMaxMb: number;
}) {
  return columnHelper.columns([
    columnHelper.accessor((row) => row.label, {
      id: "number",
      header: (ctx) => <SortHeader label="Nomor" column={ctx.column} />,
      cell: (info) => (
        <Link
          href={`/invoices/${info.row.original.id}`}
          className="font-mono font-medium hover:underline"
        >
          {info.getValue()}
        </Link>
      ),
    }),
    columnHelper.accessor((row) => row.invoiceDate, {
      id: "invoiceDate",
      enableSorting: true,
      sortDescFirst: true,
      header: (ctx) => <SortHeader label="Tanggal" column={ctx.column} />,
      cell: (info) => (
        <span className="whitespace-nowrap font-mono text-sm">
          {formatDate(info.getValue())}
        </span>
      ),
    }),
    columnHelper.accessor((row) => row.customerName, {
      id: "customer",
      header: (ctx) => <SortHeader label="Customer" column={ctx.column} />,
      cell: (info) => <span className="text-sm">{info.getValue()}</span>,
    }),
    columnHelper.accessor((row) => row.referenceNumber ?? "—", {
      id: "reference",
      header: "Referensi",
      cell: (info) => <span className="font-mono text-sm">{info.getValue()}</span>,
    }),
    columnHelper.accessor((row) => row.invoiceType, {
      id: "type",
      header: "Jenis",
      cell: (info) => (
        <span className="whitespace-nowrap text-sm">
          {INVOICE_TYPE_LABELS[info.getValue()]}
        </span>
      ),
    }),
    columnHelper.accessor((row) => row.grandTotal, {
      id: "grandTotal",
      header: (ctx) => <SortHeader label="Grand total" column={ctx.column} align="right" />,
      cell: (info) => (
        <span className="block whitespace-nowrap text-right font-mono font-medium">
          {formatIdr(info.getValue())}
        </span>
      ),
    }),
    columnHelper.accessor((row) => row.displayStatus, {
      id: "status",
      header: "Status",
      cell: (info) => <InvoiceStatusBadge status={info.getValue()} />,
    }),
    columnHelper.accessor((row) => row.dueDate ?? "", {
      id: "dueDate",
      sortDescFirst: true,
      header: (ctx) => <SortHeader label="Jatuh tempo" column={ctx.column} />,
      cell: (info) =>
        info.getValue() ? (
          <span className="whitespace-nowrap font-mono text-sm">
            {formatDate(info.getValue())}
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">—</span>
        ),
    }),
    columnHelper.accessor((row) => row.createdByName, {
      id: "createdBy",
      header: "Pembuat",
      cell: (info) => <span className="text-sm">{info.getValue()}</span>,
    }),
    columnHelper.display({
      id: "actions",
      header: "Aksi",
      cell: (info) => (
        <div className="flex items-center justify-end">
          <InvoiceRowActions
            row={info.row.original}
            canOverrideOverpayment={meta.canOverrideOverpayment}
            uploadMaxMb={meta.uploadMaxMb}
          />
        </div>
      ),
    }),
  ]);
}

export interface InvoicesTableProps {
  rows: InvoiceListRow[];
  total: number;
  page: number;
  pageSize: number;
  filters: InvoiceListFilters;
  options: {
    customers: Array<{ id: string; companyName: string }>;
    profiles: Array<{ id: string; name: string }>;
  };
  /** The "Invoice Baru" entry — only where invoice.draft.create exists. */
  mayCreate: boolean;
  canOverrideOverpayment: boolean;
  uploadMaxMb: number;
}

const ALL = "all";

export function InvoicesTable({
  rows,
  total,
  page,
  pageSize,
  filters,
  options,
  mayCreate,
  canOverrideOverpayment,
  uploadMaxMb,
}: InvoicesTableProps) {
  const router = useRouter();
  const [qInput, setQInput] = React.useState(filters.q);
  const [fromInput, setFromInput] = React.useState(filters.from);
  const [toInput, setToInput] = React.useState(filters.to);

  const pagination: PaginationState = { pageIndex: page - 1, pageSize };
  const sorting: SortingState = React.useMemo(
    () => [{ id: filters.sort, desc: filters.dir !== "asc" }],
    [filters.sort, filters.dir],
  );

  const hasFilter = Boolean(
    filters.q ||
      filters.customer ||
      filters.profile ||
      filters.status ||
      filters.type ||
      filters.from ||
      filters.to,
  );

  function push(next: Partial<InvoiceListFilters> & { page?: number }) {
    const merged: InvoiceListFilters = {
      q: next.q ?? filters.q,
      customer: next.customer ?? filters.customer,
      profile: next.profile ?? filters.profile,
      status: next.status ?? filters.status,
      type: next.type ?? filters.type,
      from: next.from ?? filters.from,
      to: next.to ?? filters.to,
      sort: next.sort ?? filters.sort,
      dir: next.dir ?? filters.dir,
    };
    const nextPage = next.page ?? 1;
    const params = new URLSearchParams();
    if (merged.q) params.set("q", merged.q);
    if (merged.customer) params.set("customer", merged.customer);
    if (merged.profile) params.set("profile", merged.profile);
    if (merged.status) params.set("status", merged.status);
    if (merged.type) params.set("type", merged.type);
    if (merged.from) params.set("from", merged.from);
    if (merged.to) params.set("to", merged.to);
    if (merged.sort !== "invoiceDate") params.set("sort", merged.sort);
    if (merged.dir !== "desc") params.set("dir", merged.dir);
    if (nextPage > 1) params.set("page", String(nextPage));
    const query = params.toString();
    router.push(`/invoices${query ? `?${query}` : ""}`);
  }

  const columns = React.useMemo(
    () => buildColumns({ canOverrideOverpayment, uploadMaxMb }),
    [canOverrideOverpayment, uploadMaxMb],
  );

  const table = useTable({
    features,
    columns,
    data: rows,
    // Server owns the row set: no local pagination/sorting of a page slice.
    manualPagination: true,
    rowCount: total,
    autoResetPageIndex: false,
    manualSorting: true,
    autoResetSorting: false,
    enableSortingRemoval: false,
    enableMultiSort: false,
    state: { pagination, sorting },
    onPaginationChange: (updater) => {
      const next = typeof updater === "function" ? updater(pagination) : updater;
      push({ page: next.pageIndex + 1 });
    },
    onSortingChange: (updater) => {
      const next = typeof updater === "function" ? updater(sorting) : updater;
      const first = next[0];
      push({
        page: 1,
        sort: first?.id ?? "invoiceDate",
        dir: first?.desc === false ? "asc" : "desc",
      });
    },
  });

  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="flex flex-col gap-4">
      <form
        className="flex flex-col gap-2 xl:flex-row xl:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          push({
            page: 1,
            q: qInput.trim(),
            from: fromInput,
            to: toInput,
          });
        }}
      >
        <div className="flex flex-1 flex-col gap-1">
          <label htmlFor="invoice-search" className="text-xs text-muted-foreground">
            Cari
          </label>
          <Input
            id="invoice-search"
            value={qInput}
            onChange={(event) => setQInput(event.target.value)}
            placeholder="Nomor invoice atau nama customer..."
            className="xl:w-64"
          />
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Status</span>
          <Select
            value={filters.status || ALL}
            onValueChange={(value) => {
              const next = String(value);
              push({ page: 1, status: next === ALL ? "" : next });
            }}
          >
            <SelectTrigger className="min-w-40" aria-label="Filter status">
              {filters.status
                ? INVOICE_STATUS_LABELS[
                    filters.status as keyof typeof INVOICE_STATUS_LABELS
                  ] ?? filters.status
                : "Semua status"}
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Semua status</SelectItem>
              <SelectItem value="DRAFT">Draft</SelectItem>
              <SelectItem value="ISSUED">Terbit</SelectItem>
              <SelectItem value="SENT">Terkirim</SelectItem>
              <SelectItem value="PARTIALLY_PAID">Dibayar sebagian</SelectItem>
              <SelectItem value="PAID">Lunas</SelectItem>
              <SelectItem value="OVERDUE">Jatuh tempo</SelectItem>
              <SelectItem value="CANCELLED">Dibatalkan</SelectItem>
              <SelectItem value="REVISED">Direvisi</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Jenis</span>
          <Select
            value={filters.type || ALL}
            onValueChange={(value) => {
              const next = String(value);
              push({ page: 1, type: next === ALL ? "" : next });
            }}
          >
            <SelectTrigger className="min-w-40" aria-label="Filter jenis invoice">
              {filters.type
                ? INVOICE_TYPE_LABELS[
                    filters.type as keyof typeof INVOICE_TYPE_LABELS
                  ] ?? filters.type
                : "Semua jenis"}
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Semua jenis</SelectItem>
              <SelectItem value="FULL">Penuh</SelectItem>
              <SelectItem value="DOWN_PAYMENT">Down payment</SelectItem>
              <SelectItem value="SETTLEMENT">Pelunasan</SelectItem>
              <SelectItem value="TERM">Termin</SelectItem>
              <SelectItem value="CUSTOM">Kustom</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Customer</span>
          <Select
            value={filters.customer || ALL}
            onValueChange={(value) => {
              const next = String(value);
              push({ page: 1, customer: next === ALL ? "" : next });
            }}
          >
            <SelectTrigger className="min-w-44" aria-label="Filter customer">
              {options.customers.find((row) => row.id === filters.customer)
                ?.companyName ?? "Semua customer"}
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Semua customer</SelectItem>
              {options.customers.map((customer) => (
                <SelectItem key={customer.id} value={customer.id}>
                  {customer.companyName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Profil invoice</span>
          <Select
            value={filters.profile || ALL}
            onValueChange={(value) => {
              const next = String(value);
              push({ page: 1, profile: next === ALL ? "" : next });
            }}
          >
            <SelectTrigger className="min-w-40" aria-label="Filter profil invoice">
              {options.profiles.find((row) => row.id === filters.profile)?.name ??
                "Semua profil"}
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Semua profil</SelectItem>
              {options.profiles.map((profile) => (
                <SelectItem key={profile.id} value={profile.id}>
                  {profile.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="invoice-from" className="text-xs text-muted-foreground">
            Dari tanggal
          </label>
          <Input
            id="invoice-from"
            type="date"
            value={fromInput}
            onChange={(event) => setFromInput(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="invoice-to" className="text-xs text-muted-foreground">
            Sampai tanggal
          </label>
          <Input
            id="invoice-to"
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
                setQInput("");
                setFromInput("");
                setToInput("");
                push({
                  page: 1,
                  q: "",
                  customer: "",
                  profile: "",
                  status: "",
                  type: "",
                  from: "",
                  to: "",
                });
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
            ? "Tidak ada invoice yang cocok dengan filter ini. Coba longgarkan filternya."
            : mayCreate
              ? "Belum ada invoice di organisasi ini. Buat yang pertama lewat tombol “Invoice Baru”."
              : "Belum ada invoice di organisasi ini."}
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
          Total {total} invoice · Halaman {page} dari {pageCount}
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
