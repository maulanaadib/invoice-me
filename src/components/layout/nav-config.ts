// src/components/layout/nav-config.ts
// Sidebar navigation source of truth. Every entry points at a real route —
// features that do not exist yet are deliberately absent here (no placeholder
// links, per non-negotiables). `requires` marks entries the shell hides for
// roles without that permission (feature 08: permission-aware menu — the
// server layout resolves the booleans from the CENTRAL matrix in
// modules/permissions, never by comparing role strings here).

import type { LucideIcon } from "lucide-react";
import {
  Building2Icon,
  CreditCardIcon,
  FileTextIcon,
  FolderKanbanIcon,
  LayoutDashboardIcon,
  ReceiptTextIcon,
  UsersIcon,
  UsersRoundIcon,
} from "lucide-react";

/** Which links are permission-gated (resolved server-side per session). */
export interface NavVisibility {
  payments: boolean;
  customers: boolean;
  projects: boolean;
}

export interface NavLink {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Hidden when this flag is false (no active workspace → all gated). */
  requires?: keyof NavVisibility;
}

export interface NavGroup {
  title: string;
  links: NavLink[];
  /** Only rendered for platform SUPER_ADMIN (proxy + layout also enforce it). */
  adminOnly?: boolean;
}

export const NAV_GROUPS: NavGroup[] = [
  {
    title: "Ruang kerja",
    links: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboardIcon },
      { href: "/invoices", label: "Invoice", icon: ReceiptTextIcon },
      { href: "/payments", label: "Pembayaran", icon: CreditCardIcon, requires: "payments" },
      { href: "/customers", label: "Customer", icon: UsersRoundIcon, requires: "customers" },
      { href: "/projects", label: "Project / PO", icon: FolderKanbanIcon, requires: "projects" },
      { href: "/profiles", label: "Profil Invoice", icon: FileTextIcon },
    ],
  },
  {
    title: "Administrasi platform",
    adminOnly: true,
    links: [
      { href: "/admin/users", label: "Pengguna", icon: UsersIcon },
      { href: "/admin/organizations", label: "Organisasi", icon: Building2Icon },
    ],
  },
];

/** Links of a group the current session may see. */
export function visibleLinks(
  links: NavLink[],
  visibility: NavVisibility,
): NavLink[] {
  return links.filter((link) => !link.requires || visibility[link.requires]);
}
