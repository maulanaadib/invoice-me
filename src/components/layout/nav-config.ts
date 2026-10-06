// src/components/layout/nav-config.ts
// Sidebar navigation source of truth. Every entry points at a real route —
// features that do not exist yet are deliberately absent here (no placeholder
// links, per non-negotiables).

import type { LucideIcon } from "lucide-react";
import { Building2Icon, LayoutDashboardIcon, UsersIcon } from "lucide-react";

export interface NavLink {
  href: string;
  label: string;
  icon: LucideIcon;
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
    links: [{ href: "/dashboard", label: "Dashboard", icon: LayoutDashboardIcon }],
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
