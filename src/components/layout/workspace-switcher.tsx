"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Building2Icon, CheckIcon, ChevronDownIcon } from "lucide-react";
import { switchWorkspaceAction } from "@/modules/organizations/actions";
import { toast } from "@/components/ui/toast";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface WorkspaceOption {
  organizationId: string;
  role: string;
  organization: { id: string; name: string; slug: string };
}

/**
 * Switches the session's active organization server-side (membership is
 * re-validated there), then refreshes so every scoped read follows the new
 * workspace.
 */
export function WorkspaceSwitcher({
  memberships,
  activeOrganizationId,
}: {
  memberships: WorkspaceOption[];
  activeOrganizationId: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();

  const active =
    memberships.find((m) => m.organization.id === activeOrganizationId) ?? memberships[0];

  function selectWorkspace(organizationId: string) {
    if (!active || organizationId === active.organization.id) return;
    startTransition(async () => {
      const result = await switchWorkspaceAction(organizationId);
      if (result.ok) {
        toast.add({
          title: "Workspace diganti",
          description: memberships.find((m) => m.organization.id === organizationId)
            ?.organization.name,
          type: "success",
        });
        router.refresh();
      } else {
        toast.add({ title: "Gagal mengganti workspace", description: result.error.message, type: "error" });
      }
    });
  }

  if (!active) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={pending || memberships.length === 0}
        className={buttonVariants({ variant: "outline", size: "sm" })}
        aria-label="Pilih workspace"
      >
        <Building2Icon aria-hidden="true" />
        <span className="max-w-36 truncate">{active.organization.name}</span>
        <ChevronDownIcon aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Workspace aktif</DropdownMenuLabel>
          {memberships.map((membership) => {
            const isActive = membership.organization.id === active.organization.id;
            return (
              <DropdownMenuItem
                key={membership.organization.id}
                onClick={() => selectWorkspace(membership.organization.id)}
                disabled={pending}
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-medium">{membership.organization.name}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {membership.organization.slug}
                  </span>
                </span>
                <Badge variant="outline">{membership.role}</Badge>
                {isActive ? <CheckIcon aria-hidden="true" /> : null}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel className="font-normal text-muted-foreground">
            Peran menentukan izin aksi di dalam workspace.
          </DropdownMenuLabel>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
