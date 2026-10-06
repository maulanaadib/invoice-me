"use client";

// src/components/tables/projects-table.tsx
// Project/PO list for /projects: server-side pagination + search driven by
// the URL (same pattern as the customers table). Work value renders as a
// formatted decimal string — it never round-trips through a float.

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
import { ChevronLeftIcon, ChevronRightIcon, PaperclipIcon, SearchIcon } from "lucide-react";
import type { ProjectListItem } from "@/modules/projects/service";
import {
  PROJECT_STATUS_LABELS,
  REFERENCE_TYPE_LABELS,
} from "@/modules/projects/schema";
import { formatIdr } from "@/lib/money";
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

export const PROJECTS_PAGE_SIZE = 10;

const STATUS_VARIANT: Record<ProjectListItem["status"], "default" | "secondary" | "outline" | "destructive"> = {
  ACTIVE: "outline",
  COMPLETED: "secondary",
  ON_HOLD: "default",
  CANCELLED: "destructive",
};

/** "450000000" → "Rp 450.000.000" — shared string-only helper (lib/money). */
const formatRupiah = formatIdr;

const features = tableFeatures({
  rowPaginationFeature,
  paginatedRowModel: createPaginatedRowModel(),
});
type ProjectTableFeatures = typeof features;
const columnHelper = createColumnHelper<ProjectTableFeatures, ProjectListItem>();

const columns = columnHelper.columns([
  columnHelper.accessor((row) => row.title, {
    id: "title",
    header: "Project",
    cell: (info) => (
      <div className="flex min-w-0 flex-col">
        <Link
          href={`/projects/${info.row.original.id}`}
          className="truncate font-medium hover:underline"
        >
          {info.row.original.title}
        </Link>
        <span className="truncate text-xs text-muted-foreground">
          {info.row.original.customerName}
        </span>
      </div>
    ),
  }),
  columnHelper.accessor((row) => row.referenceType, {
    id: "reference",
    header: "Referensi",
    cell: (info) => (
      <div className="flex min-w-0 flex-col gap-1">
        <Badge variant="secondary">
          {REFERENCE_TYPE_LABELS[info.row.original.referenceType]}
        </Badge>
        <span className="truncate font-mono text-xs">{info.row.original.referenceNumber}</span>
      </div>
    ),
  }),
  columnHelper.accessor("workValue", {
    id: "workValue",
    header: "Nilai pekerjaan",
    cell: (info) => <span className="font-mono text-sm">{formatRupiah(info.getValue())}</span>,
  }),
  columnHelper.accessor("status", {
    id: "status",
    header: "Status",
    cell: (info) => (
      <Badge variant={STATUS_VARIANT[info.getValue()]}>
        {PROJECT_STATUS_LABELS[info.getValue()]}
      </Badge>
    ),
  }),
  columnHelper.display({
    id: "attachment",
    header: "Lampiran",
    cell: (info) =>
      info.row.original.hasAttachment ? (
        <PaperclipIcon aria-label="Punya lampiran PO" className="size-4" />
      ) : (
        <span className="text-sm text-muted-foreground">—</span>
      ),
  }),
  columnHelper.display({
    id: "actions",
    header: "Aksi",
    cell: (info) => (
      <div className="flex items-center justify-end">
        <Link
          href={`/projects/${info.row.original.id}`}
          className={buttonVariants({ variant: "ghost", size: "sm" })}
        >
          Detail
        </Link>
      </div>
    ),
  }),
]);

export interface ProjectsTableProps {
  rows: ProjectListItem[];
  total: number;
  page: number;
  pageSize: number;
  q: string;
}

export function ProjectsTable({ rows, total, page, pageSize, q }: ProjectsTableProps) {
  const router = useRouter();
  const [search, setSearch] = React.useState(q);
  const pagination: PaginationState = { pageIndex: page - 1, pageSize };

  function push(next: { page?: number; q?: string }) {
    const nextQ = next.q ?? q;
    const nextPage = next.page ?? 1;
    const params = new URLSearchParams();
    if (nextQ) params.set("q", nextQ);
    if (nextPage > 1) params.set("page", String(nextPage));
    const query = params.toString();
    router.push(`/projects${query ? `?${query}` : ""}`);
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
        className="flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          push({ page: 1, q: search.trim() });
        }}
      >
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Cari judul, nomor referensi, atau customer…"
          aria-label="Cari project"
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
            ? "Tidak ada project yang cocok dengan pencarian ini."
            : "Belum ada project / PO di organisasi ini. Buat yang pertama lewat tombol “Tambah project”."}
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
          Total {total} project · Halaman {page} dari {pageCount}
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
