"use client";

import * as React from "react";
import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { UsersIcon } from "lucide-react";
import {
  assignRoleAction,
  inviteMemberAction,
  listOrganizationMembersAction,
  type OrgMemberView,
} from "@/modules/organizations/actions";
import type { ActionResult } from "@/lib/api-response";
import { fieldError } from "@/components/forms/form-utils";
import { toast } from "@/components/ui/toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";

const ROLE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "OWNER", label: "Pemilik (OWNER)" },
  { value: "ADMIN", label: "Admin (ADMIN)" },
  { value: "STAFF", label: "Staf (STAFF)" },
  { value: "VIEWER", label: "Penampil (VIEWER)" },
];

function roleLabel(value: string): string {
  return ROLE_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

function roleShortLabel(value: string): string {
  return ROLE_OPTIONS.find((option) => option.value === value)?.label.split(" (")[0] ?? value;
}

function MemberRow({
  organizationId,
  member,
  onChanged,
}: {
  organizationId: string;
  member: OrgMemberView;
  onChanged: () => void;
}) {
  const router = useRouter();
  const [role, setRole] = React.useState(member.role);
  const [pending, startTransition] = React.useTransition();
  const changed = role !== member.role;

  function save() {
    startTransition(async () => {
      const form = new FormData();
      form.set("organizationId", organizationId);
      form.set("targetUserId", member.userId);
      form.set("role", role);
      const result = await assignRoleAction(form);
      if (result.ok) {
        toast.add({
          title: "Peran diperbarui",
          description: `${member.email} → ${roleLabel(role)}`,
          type: "success",
        });
        router.refresh();
        onChanged();
      } else {
        toast.add({ title: "Gagal memperbarui peran", description: result.error.message, type: "error" });
      }
    });
  }

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-border bg-background px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-medium">
          {member.name || member.username || member.email}
        </span>
        <span className="truncate text-xs text-muted-foreground">{member.email}</span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Badge variant={member.status === "ACTIVE" ? "secondary" : "outline"}>
          {member.status === "INVITED" ? "Diundang" : member.status === "REMOVED" ? "Dihapus" : "Aktif"}
        </Badge>
        <Select value={role} onValueChange={(value) => setRole(String(value))}>
          <SelectTrigger className="min-w-36" aria-label={`Peran untuk ${member.email}`}>
            {roleShortLabel(role)}
          </SelectTrigger>
          <SelectContent>
            {ROLE_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" variant="outline" disabled={!changed || pending} onClick={save}>
          {pending ? "Menyimpan…" : "Simpan"}
        </Button>
      </div>
    </li>
  );
}

export function OrgMembersDialog({
  organizationId,
  organizationName,
}: {
  organizationId: string;
  organizationName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [members, setMembers] = React.useState<OrgMemberView[] | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [inviteRole, setInviteRole] = React.useState("VIEWER");

  const load = React.useCallback(async () => {
    // Callers are event handlers and action callbacks (never effects), so the
    // error banner can clear right away while the request is in flight.
    setLoadError(null);
    const result = await listOrganizationMembersAction(organizationId);
    if (result.ok) {
      setMembers(result.data.members);
    } else {
      setMembers(null);
      setLoadError(result.error.message);
    }
  }, [organizationId]);

  const [inviteState, inviteAction, invitePending] = useActionState<
    ActionResult<{ membershipId: string }> | null,
    FormData
  >(
    // Success side-effects run where the result is known (inside the action),
    // not in a state-sync effect: reload the list, toast, refresh.
    async (_prev, form) => {
      const result = await inviteMemberAction(form);
      if (result.ok) {
        toast.add({
          title: "Anggota ditambahkan",
          description: "Status INVITED — konfirmasi keanggotaan menyusul (fitur berikutnya).",
          type: "success",
        });
        void load();
        router.refresh();
      }
      return result;
    },
    null,
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setOpen(true);
          void load();
        }}
      >
        <UsersIcon aria-hidden="true" />
        Kelola anggota
      </Button>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Anggota — {organizationName}</DialogTitle>
          <DialogDescription>
            Ubah peran anggota atau tambahkan user terdaftar dengan status undangan.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <form
            action={inviteAction}
            className="flex flex-col gap-3 rounded-lg border border-border p-3 sm:flex-row sm:items-end"
            noValidate
          >
            <input type="hidden" name="organizationId" value={organizationId} />
            <input type="hidden" name="role" value={inviteRole} />
            <div className="flex flex-1 flex-col gap-2">
              <Label htmlFor={`invite-${organizationId}`}>Undang user (username/email)</Label>
              <Input
                id={`invite-${organizationId}`}
                name="identifier"
                autoComplete="off"
                autoCapitalize="none"
                disabled={invitePending}
              />
              {fieldError(inviteState, "identifier") ? (
                <p className="text-sm text-destructive">
                  {fieldError(inviteState, "identifier")}
                </p>
              ) : null}
            </div>
            <div className="flex flex-col gap-2">
              <Label>Peran</Label>
              <Select value={inviteRole} onValueChange={(value) => setInviteRole(String(value))}>
                <SelectTrigger className="min-w-36" aria-label="Peran undangan">
                  {roleShortLabel(inviteRole)}
                </SelectTrigger>
                <SelectContent>
                  {ROLE_OPTIONS.filter((option) => option.value !== "OWNER").map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" disabled={invitePending}>
              {invitePending ? "Mengundang…" : "Undang"}
            </Button>
          </form>
          {inviteState && !inviteState.ok && !fieldError(inviteState, "identifier") ? (
            <p role="alert" className="text-sm text-destructive">
              {inviteState.error.message}
            </p>
          ) : null}

          {loadError ? (
            <p role="alert" className="text-sm text-destructive">
              {loadError}
            </p>
          ) : members === null ? (
            <div className="flex flex-col gap-2">
              <div className="h-10 animate-pulse rounded-lg bg-muted" />
              <div className="h-10 animate-pulse rounded-lg bg-muted" />
            </div>
          ) : members.length === 0 ? (
            <p className="text-sm text-muted-foreground">Belum ada anggota.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {members.map((member) => (
                <MemberRow
                  key={member.membershipId}
                  organizationId={organizationId}
                  member={member}
                  onChanged={() => void load()}
                />
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
