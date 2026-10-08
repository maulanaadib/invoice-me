"use client";

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
import { ChevronLeftIcon, ChevronRightIcon, SearchIcon, ShieldCheckIcon } from "lucide-react";
import {
  activateAdminUserAction,
  suspendAdminUserAction,
} from "@/modules/auth/admin-actions";
import type { ActionResult } from "@/lib/api-response";
import { toast } from "@/components/ui/toast";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/** Row shape for the admin user table (dates serialized across RSC). */
export interface AdminUserRow {
  id: string;
  username: string | null;
  name: string | null;
  email: string;
  platformRole: string;
  status: string;
  mustChangePassword: boolean;
  createdAt: string;
  membershipCount: number;
  /** True for the signed-in super admin — self-suspend is blocked server-side. */
  isSelf: boolean;
}

const features = tableFeatures({
  rowPaginationFeature,
  paginatedRowModel: createPaginatedRowModel(),
});
type UserTableFeatures = typeof features;
const columnHelper = createColumnHelper<UserTableFeatures, AdminUserRow>();

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Jakarta",
  });
}

function RowActions({ user }: { user: AdminUserRow }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const suspended = user.status === "SUSPENDED";

  function run(
    action: (form: FormData) => Promise<ActionResult>,
    successTitle: string,
  ) {
    startTransition(async () => {
      const form = new FormData();
      form.set("userId", user.id);
      const result = await action(form);
      if (result.ok) {
        toast.add({ title: successTitle, description: user.email, type: "success" });
        router.refresh();
      } else {
        toast.add({ title: "Gagal", description: result.error.message, type: "error" });
      }
    });
  }

  return (
    <div className="flex items-center justify-end gap-1">
      <Link
        href={`/admin/users/${user.id}`}
        className={buttonVariants({ variant: "ghost", size: "sm" })}
      >
        Detail
      </Link>
      {user.isSelf ? (
        <span className="px-2 text-xs text-muted-foreground">akun ini</span>
      ) : (
        <Button
          variant={suspended ? "outline" : "destructive"}
          size="sm"
          disabled={pending}
          onClick={() =>
            run(
              suspended ? activateAdminUserAction : suspendAdminUserAction,
              suspended ? "User diaktifkan" : "User ditangguhkan",
            )
          }
        >
          {suspended ? "Aktifkan" : "Tangguhkan"}
        </Button>
      )}
    </div>
  );
}

const columns = columnHelper.columns([
  columnHelper.accessor((row) => row.name || row.username || row.email, {
    id: "identity",
    header: "Pengguna",
    cell: (info) => (
      <div className="flex min-w-0 flex-col">
        <span className="truncate font-medium">
          {info.row.original.name || info.row.original.username || info.row.original.email}
        </span>
        <span className="truncate text-xs text-muted-foreground">{info.row.original.email}</span>
      </div>
    ),
  }),
  columnHelper.accessor("platformRole", {
    header: "Peran platform",
    cell: (info) =>
      info.getValue() === "SUPER_ADMIN" ? (
        <Badge>
          <ShieldCheckIcon aria-hidden="true" />
          Super Admin
        </Badge>
      ) : (
        <Badge variant="outline">User</Badge>
      ),
  }),
  columnHelper.accessor("status", {
    header: "Status",
    cell: (info) => (
      <Badge variant={info.getValue() === "SUSPENDED" ? "destructive" : "secondary"}>
        {info.getValue() === "SUSPENDED" ? "Ditangguhkan" : "Aktif"}
      </Badge>
    ),
  }),
  columnHelper.accessor("membershipCount", {
    header: "Organisasi",
    cell: (info) => info.getValue(),
  }),
  columnHelper.accessor("createdAt", {
    header: "Dibuat",
    cell: (info) => formatDate(info.getValue()),
  }),
  columnHelper.display({
    id: "actions",
    header: "Aksi",
    cell: (info) => <RowActions user={info.row.original} />,
  }),
]);

export interface UsersTableProps {
  rows: AdminUserRow[];
  total: number;
  page: number;
  pageSize: number;
  q: string;
  status: string;
  role: string;
}

export function UsersTable({
  rows,
  total,
  page,
  pageSize,
  q,
  status,
  role,
}: UsersTableProps) {
  const router = useRouter();
  const [search, setSearch] = React.useState(q);
  const [statusFilter, setStatusFilter] = React.useState(status);
  const [roleFilter, setRoleFilter] = React.useState(role);
  // The URL owns the current page index — derive pagination from the prop so
  // back/forward and filter navigation need no state-sync effect.
  const pagination: PaginationState = { pageIndex: page - 1, pageSize };

  function push(next: { page?: number; q?: string; status?: string; role?: string }) {
    const nextQ = next.q ?? q;
    const nextStatus = next.status ?? status;
    const nextRole = next.role ?? role;
    const nextPage = next.page ?? 1;
    const params = new URLSearchParams();
    if (nextQ) params.set("q", nextQ);
    if (nextStatus) params.set("status", nextStatus);
    if (nextRole) params.set("role", nextRole);
    if (nextPage > 1) params.set("page", String(nextPage));
    const query = params.toString();
    router.push(`/admin/users${query ? `?${query}` : ""}`);
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
  const hasFilters = Boolean(q || status || role);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
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
            placeholder="Cari nama, username, atau email…"
            aria-label="Cari pengguna"
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

        <div className="flex items-center gap-2">
          <Select
            value={statusFilter || "all"}
            onValueChange={(value) => {
              const next = String(value);
              setStatusFilter(next === "all" ? "" : next);
              push({ page: 1, status: next === "all" ? "" : next });
            }}
          >
            <SelectTrigger className="min-w-40" aria-label="Filter status">
              {statusFilter === "SUSPENDED"
                ? "Ditangguhkan"
                : statusFilter === "ACTIVE"
                  ? "Aktif"
                  : "Semua status"}
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua status</SelectItem>
              <SelectItem value="ACTIVE">Aktif</SelectItem>
              <SelectItem value="SUSPENDED">Ditangguhkan</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={roleFilter || "all"}
            onValueChange={(value) => {
              const next = String(value);
              setRoleFilter(next === "all" ? "" : next);
              push({ page: 1, role: next === "all" ? "" : next });
            }}
          >
            <SelectTrigger className="min-w-40" aria-label="Filter peran platform">
              {roleFilter === "SUPER_ADMIN"
                ? "Super Admin"
                : roleFilter === "USER"
                  ? "User"
                  : "Semua peran"}
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua peran</SelectItem>
              <SelectItem value="USER">User</SelectItem>
              <SelectItem value="SUPER_ADMIN">Super Admin</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-6 py-12 text-center text-sm text-muted-foreground">
          {hasFilters
            ? "Tidak ada pengguna yang cocok dengan filter ini."
            : "Belum ada pengguna di platform. Buat pengguna pertama dengan tombol “Buat user”."}
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
          Total {total} pengguna · Halaman {page} dari {pageCount}
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
