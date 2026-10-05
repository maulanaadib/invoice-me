# Feature 01: Auth & Multi-Tenant Foundation

## Goal

Bangun fondasi autentikasi dan multi-tenancy: login dengan username atau email, organization + membership dengan role, central permission service, serta user management oleh super admin. Setelah feature ini, user bisa login, punya organization, dan data bisnis sudah ter-scope per organization.

## Design

- **Login**: halaman `/login` menerima **username atau email** + password. Better Auth dengan email-password plugin + username plugin + admin plugin. Public registration **dimatikan**.
- **Session**: cookie HttpOnly + Secure (production) + SameSite. Remember session (extended expiry) opsional via checkbox. Logout mengakhiri session server-side.
- **Rate limit + lockout**: maksimal percobaan gagal beruntun (default 5) per username+IP → lockout sementara (durasi escalating: 1m, 5m, 15m). Audit login success/failure.
- **Force password change**: setelah admin create user (temporary password) atau admin reset password, user **harus** ganti password sebelum bisa akses fitur apa pun (`mustChangePassword` flag). Middleware redirect ke `/change-password`.
- **Super admin user management** (route `/admin/users`): create user (username, email, temporary password, platform role), suspend, activate, reset password (force change), lihat membership, lihat invoice count, revoke session.
- **Organization & membership**: user bisa punya beberapa membership; workspace switcher di topbar mengubah organization aktif di session. `Organization` + `Membership` (role `OWNER`/`ADMIN`/`STAFF`/`VIEWER`) sesuai `data-model.md`.
- **Central permission service** (`src/modules/permissions`): satu fungsi `can(action, resource, ctx)` dengan matrix role. Role string hanya hidup di satu file ini. Dipakai oleh semua service layer feature selanjutnya.
- **First-user bootstrap**: saat login pertama super admin (seed), jika belum ada organization, super admin bisa create organization + assign owner (atau ini dilakukan saat onboarding feature 02 — di feature ini hanya super admin create org untuk user lain).
- **Halaman pendukung**: `/forgot-password` (menjelaskan "hubungi admin", struktur kode siap SMTP), `/change-password`, `/unauthorized`.

## Implementation

1. **Schema migration**: tambah `PlatformRole`/`UserStatus` enum (sudah di feature 00), model `Organization`, `Membership`, dan field User platform (`platformRole`, `mustChangePassword`, `status`). Migration `auth-multi-tenant`.
2. **Better Auth config** (`src/server/auth.ts`): plugin emailPassword, username, admin. Rate limit config. Session cookie config. Hook post-login untuk cek `mustChangePassword` + audit log.
3. **Auth API routes**: `app/api/auth/[...all]/route.ts` (Better Auth handler).
4. **Login page** (`app/(auth)/login/page.tsx`): React Hook Form + Zod, field "Username atau Email", password, remember checkbox, error message Bahasa Indonesia, link forgot-password. Rate limit response → tampilkan sisa waktu lockout.
5. **Middleware** (`middleware.ts`): protect route `(dashboard)` + `admin`, cek session, redirect `/login`. Cek `mustChangePassword` → redirect `/change-password`. Cek platform role untuk `/admin/*`.
6. **`modules/auth/service.ts`**: login audit, lockout state (table atau in-memory dengan TTL; pilih: `AuditLog` + cache sederhana, tidak perlu Redis), force-change logic, suspend check (user SUSPENDED → tolak login).
7. **`modules/organizations/service.ts`**: createOrganization, listMemberships, switchActiveOrganization (session), assignRole, invite member (defer email — hanya catat membership INVITED).
8. **`modules/permissions/service.ts`**: matrix permission:
   ```ts
   const MATRIX = { OWNER: ['*'], ADMIN: ['* except delete_org, transfer_ownership'], STAFF: ['invoice.draft.*', 'customer.*', 'project.*', 'invoice.preview', 'invoice.export'], VIEWER: ['invoice.view', 'invoice.download'] }
   ```
   Export `can(action, ctx)`, `requireOrgScope(ctx)` helper.
9. **`modules/audit/service.ts`**: `log({ actorUserId, organizationId, action, entityType, entityId, metadata, request })` — sanitasi metadata, hash IP opsional.
10. **Super admin pages**: `/admin/users` list (TanStack Table + server pagination), create dialog, detail `/admin/users/[id]`, reset password, suspend/activate, force change, revoke session. Setiap aksi audit. `/admin/organizations` minimal list (detail defer ke feature 09).
11. **Topbar workspace switcher** + layout dashboard (sidebar collapsible, breadcrumb, theme toggle) — layout shell yang dipakai feature selanjutnya.
12. **Seed**: super admin dari env `SEED_ADMIN_*` (idempotent).

## Dependencies

- Feature 00 (scaffold, Better Auth config, Prisma, Docker, health).
- `data-model.md` untuk User/Organization/Membership schema.

## Scope Limits

- **Tidak** ada onboarding wizard 12 langkah — feature 02.
- **Tidak** ada invoice profile / logo upload — feature 02.
- **Tidak** mengirim email undangan — defer (membership INVITED tanpa email).
- **Tidak** ada MFA / social login — out of scope MVP.
- **Tidak** ada super admin panel lengkap (organizations detail, invoice monitoring, audit log viewer, PDF jobs, storage) — feature 09. Hanya user management + org list minimal.
- **Tidak** ada dashboard card — feature 08.

## Check When Done

- [ ] Login dengan username berhasil; login dengan email berhasil.
- [ ] Login dengan password salah 5x → lockout, pesan Bahasa Indonesia jelas dengan durasi.
- [ ] User suspended tidak bisa login.
- [ ] Admin create user dengan temporary password → user login → dipaksa ganti password → baru bisa akses dashboard.
- [ ] Admin reset password → user dipaksa ganti password.
- [ ] Logout mengakhiri session; tombol back browser tidak restore akses.
- [ ] Cookie HttpOnly + Secure (production) + SameSite (cek header response).
- [ ] Permission service: `can('invoice.issue', ctx)` untuk OWNER true, VIEWER false — unit test.
- [ ] Org isolation integration test: user org A request invoice org B → 404 (persiapan: gunakan factory + entity sederhana milik org, atau test langsung dengan Customer placeholder jika feature 03 belum ada — boleh pakai entity `Organization` saja untuk scope test).
- [ ] Workspace switcher mengubah org aktif; query bisnis setelah switch scoped ke org baru.
- [ ] Super admin bisa lihat seluruh user, suspend, reset password, revoke session.
- [ ] Setiap aksi auth (login success/fail, logout, user created, suspended, password reset) tercatat di AuditLog.
- [ ] Audit metadata tidak mengandung password/token.
- [ ] Middleware: route protected redirect ke `/login`; `/admin/*` hanya SUPER_ADMIN.
- [ ] Unit test: permission matrix (minimal 10 assertion per role).
- [ ] Integration test: login flow end-to-end dengan test DB.
- [ ] Lint, typecheck, production build lulus.

## Commit and Push

This feature is only ready to commit after its `Check When Done` passes and the test suite is green.

1. Every item in `Check When Done` passes.
2. Tests pass (`npm run test`).
3. Lint and typecheck pass (`npm run lint`, `npm run typecheck`).
4. Ask which branch: **`main`** (recommended, trunk-based) atau new branch. Never commit silently.
5. Commit: `feat(01): auth multi-tenant — Better Auth, org membership, permission service, super admin user management`.
6. Push. Never force push.

## Progress Tracker

When this feature lands, update `context/progress-tracker.md`:

- Move `auth-multi-tenant` from **Next Up** to **In Progress** at build start, then to **Completed** when `Check When Done` passes.
- Add to **Open Questions**: apakah lockout perlu persistent across restart (table) atau in-memory cukup untuk MVP; apakah email undangan membership perlu sebelum GA.
- Add to **Architecture Decisions**: central permission service matrix di `modules/permissions`; audit log write helper di `modules/audit`; workspace switch via session active org.
- Add one line to **Session Notes**: "Feature 01 done: login (username/email), lockout, force-change, org+membership, permission service, super admin user mgmt."
- Do not touch other features' rows.
