"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  ChevronRightIcon,
  KeyRoundIcon,
  LogOutIcon,
  MenuIcon,
  UserRoundIcon,
} from "lucide-react";
import { NAV_GROUPS } from "@/components/layout/nav-config";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { WorkspaceSwitcher, type WorkspaceOption } from "@/components/layout/workspace-switcher";
import { toast } from "@/components/ui/toast";
import { buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "cn";

export interface ShellUser {
  name: string;
  username: string | null;
  email: string;
  platformRole: string;
}

const SEGMENT_LABELS: Record<string, string> = {
  dashboard: "Dashboard",
  admin: "Administrator",
  users: "Pengguna",
  organizations: "Organisasi",
  "change-password": "Ubah Kata Sandi",
};

function breadcrumbLabel(segment: string): string {
  if (segment.length > 20) return "Detail"; // route ids ([id]) — not displayable
  return SEGMENT_LABELS[segment] ?? segment.charAt(0).toUpperCase() + segment.slice(1);
}

function NavList({
  isSuperAdmin,
  onNavigate,
}: {
  isSuperAdmin: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-5 px-3 py-2">
      {NAV_GROUPS.filter((group) => !group.adminOnly || isSuperAdmin).map((group) => (
        <div key={group.title} className="flex flex-col gap-1">
          <p className="px-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {group.title}
          </p>
          {group.links.map((link) => {
            const active =
              pathname === link.href || pathname.startsWith(`${link.href}/`);
            const Icon = link.icon;
            return (
              <Link
                key={link.href}
                href={link.href}
                onClick={onNavigate}
                aria-current={active ? "page" : undefined}
                className={cn(
                  buttonVariants({ variant: active ? "secondary" : "ghost", size: "sm" }),
                  "w-full justify-start gap-2 font-normal",
                  active && "font-medium",
                )}
              >
                <Icon aria-hidden="true" />
                {link.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

function Breadcrumb() {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return null;
  return (
    <nav aria-label="Breadcrumb" className="hidden items-center gap-1 text-sm md:flex">
      {segments.map((segment, index) => {
        const isLast = index === segments.length - 1;
        return (
          <React.Fragment key={`${segment}-${index}`}>
            {index > 0 ? (
              <ChevronRightIcon className="size-3.5 text-muted-foreground" aria-hidden="true" />
            ) : null}
            <span className={isLast ? "font-medium text-foreground" : "text-muted-foreground"}>
              {breadcrumbLabel(segment)}
            </span>
          </React.Fragment>
        );
      })}
    </nav>
  );
}

function UserMenu({ user }: { user: ShellUser }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const displayName = user.name || user.username || user.email;

  function signOut() {
    startTransition(async () => {
      try {
        const response = await fetch("/api/auth/sign-out", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        });
        if (response.ok) {
          // Session row is deleted server-side; back button cannot restore it.
          window.location.assign("/login");
          return;
        }
        toast.add({
          title: "Gagal keluar",
          description: "Sesi belum berakhir. Coba lagi.",
          type: "error",
        });
      } catch {
        toast.add({
          title: "Gagal terhubung ke server",
          description: "Periksa koneksi Anda lalu coba lagi.",
          type: "error",
        });
      }
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Menu akun"
        className={buttonVariants({ variant: "ghost", size: "sm" })}
      >
        <UserRoundIcon aria-hidden="true" />
        <span className="hidden max-w-36 truncate sm:inline">{displayName}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-64">
        <DropdownMenuLabel className="flex flex-col">
          <span className="truncate font-medium text-foreground">{displayName}</span>
          <span className="truncate text-xs font-normal text-muted-foreground">
            {user.email}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => router.push("/change-password")}
          disabled={pending}
        >
          <KeyRoundIcon aria-hidden="true" />
          Ubah kata sandi
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onClick={signOut} disabled={pending}>
          <LogOutIcon aria-hidden="true" />
          {pending ? "Keluar…" : "Keluar"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppShell({
  user,
  memberships,
  activeOrganizationId,
  children,
}: {
  user: ShellUser;
  memberships: WorkspaceOption[];
  activeOrganizationId: string | null;
  children: React.ReactNode;
}) {
  const isSuperAdmin = user.platformRole === "SUPER_ADMIN";
  const [mobileOpen, setMobileOpen] = React.useState(false);

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-border bg-card lg:flex">
        <div className="flex h-14 items-center border-b border-border px-4">
          <Link href="/dashboard" className="text-base font-semibold tracking-tight">
            invoice-me
          </Link>
        </div>
        <div className="flex flex-1 flex-col overflow-y-auto py-3">
          <NavList isSuperAdmin={isSuperAdmin} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-background/90 px-3 backdrop-blur supports-[backdrop-filter]:bg-background/75 lg:px-6">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger
              aria-label="Buka menu navigasi"
              className={buttonVariants({ variant: "ghost", size: "icon" })}
            >
              <MenuIcon aria-hidden="true" />
            </SheetTrigger>
            <SheetContent side="left" className="w-64 p-0">
              <SheetHeader className="border-b border-border">
                <SheetTitle>invoice-me</SheetTitle>
              </SheetHeader>
              <NavList isSuperAdmin={isSuperAdmin} onNavigate={() => setMobileOpen(false)} />
            </SheetContent>
          </Sheet>

          <Breadcrumb />

          <div className="ml-auto flex items-center gap-2">
            <WorkspaceSwitcher
              memberships={memberships}
              activeOrganizationId={activeOrganizationId}
            />
            <ThemeToggle />
            <UserMenu user={user} />
          </div>
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 px-3 py-6 lg:px-6">{children}</main>
      </div>
    </div>
  );
}
