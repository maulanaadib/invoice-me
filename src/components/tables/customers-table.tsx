"use client";

// src/components/tables/customers-table.tsx
// Customer list for /customers: server-side pagination + search driven by the
// URL (same pattern as the admin users table — the server owns the rows, the
// table only owns presentation). Empty and filtered-empty states included.

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
import { ChevronLeftIcon, ChevronRightIcon, SearchIcon } from "lucide-react";
import type { CustomerListItem } from "@/modules/customers/service";
import { Badge } from "@/components/ui/badge";
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

export const CUSTOMERS_PAGE_SIZE = 10;

const features = tableFeatures({
  rowPaginationFeature,
  paginatedRowModel: createPaginatedRowModel(),
});
type CustomerTableFeatures = typeof features;
const columnHelper = createColumnHelper<CustomerTableFeatures, CustomerListItem>();

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Jakarta",
  });
}

const columns = columnHelper.columns([
  columnHelper.accessor((row) => row.companyName, {
    id: "company",
    header: "Perusahaan",
    cell: (info) => (
      <div className="flex min-w-0 flex-col">
        <Link
          href={`/customers/${info.row.original.id}`}
          className="truncate font-medium hover:underline"
        >
          {info.row.original.companyName}
        </Link>
        {info.row.original.legalName ? (
          <span className="truncate text-xs text-muted-foreground">
            {info.row.original.legalName}
          </span>
        ) : null}
      </div>
    ),
  }),
  columnHelper.accessor((row) => row.city ?? row.businessType ?? "—", {
    id: "location",
    header: "Kota / usaha",
    cell: (info) => <span className="text-sm">{info.getValue()}</span>,
  }),
  columnHelper.accessor((row) => row.phone ?? row.email ?? "—", {
    id: "contact",
    header: "Kontak",
    cell: (info) => <span className="text-sm">{info.getValue()}</span>,
  }),
  columnHelper.accessor("contactCount", {
    id: "pic",
    header: "PIC",
    cell: (info) => (info.getValue() > 0 ? `${info.getValue()} orang` : "—"),
  }),
  columnHelper.accessor("isActive", {
    id: "status",
    header: "Status",
    cell: (info) =>
      info.getValue() ? (
        <Badge variant="outline">Aktif</Badge>
      ) : (
        <Badge variant="secondary">Tidak aktif</Badge>
      ),
  }),
  columnHelper.accessor("createdAt", {
    id: "createdAt",
    header: "Dibuat",
    cell: (info) => <span className="text-sm">{formatDate(info.getValue())}</span>,
  }),
  columnHelper.display({
    id: "actions",
    header: "Aksi",
    cell: (info) => (
      <div className="flex items-center justify-end">
        <Link
          href={`/customers/${info.row.original.id}`}
          className={buttonVariants({ variant: "ghost", size: "sm" })}
        >
          Detail
        </Link>
      </div>
    ),
  }),
]);

export interface CustomersTableProps {
  rows: CustomerListItem[];
  total: number;
  page: number;
  pageSize: number;
  q: string;
}

export function CustomersTable({ rows, total, page, pageSize, q }: CustomersTableProps) {
  const router = useRouter();
  const [search, setSearch] = React.useState(q);
  // The URL owns the current page index — derive pagination from the prop so
  // back/forward and filter navigation need no state-sync effect.
  const pagination: PaginationState = { pageIndex: page - 1, pageSize };

  function push(next: { page?: number; q?: string }) {
    const nextQ = next.q ?? q;
    const nextPage = next.page ?? 1;
    const params = new URLSearchParams();
    if (nextQ) params.set("q", nextQ);
    if (nextPage > 1) params.set("page", String(nextPage));
    const query = params.toString();
    router.push(`/customers${query ? `?${query}` : ""}`);
  }

  const table = useTable({
    features,
    columns,
    data: rows,
    // Server pages: rows are already the current page; rowCount drives counts.
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
        className="flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          push({ page: 1, q: search.trim() });
        }}
      >
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Cari nama perusahaan atau nama legal…"
          aria-label="Cari customer"
          className="lg:w-72"
        />
        <Button type="submit" variant="outline" size="sm">
          <SearchIcon aria-hidden="true" />
          Cari
        </Button>
        {q ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearch("");
              push({ page: 1, q: "" });
            }}
          >
            Hapus carian
          </Button>
        ) : null}
      </form>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-6 py-12 text-center text-sm text-muted-foreground">
          {q
            ? "Tidak ada customer yang cocok dengan pencarian ini."
            : "Belum ada customer di organisasi ini. Buat customer pertama lewat tombol “Tambah customer”."}
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
          Total {total} customer · Halaman {page} dari {pageCount}
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
