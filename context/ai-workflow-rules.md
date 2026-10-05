# Development Workflow

## Approach

Build this project incrementally using a spec-driven workflow. Context files define what to build, how to build it, and what the current state of progress is. Always implement against these specs — do not infer or invent behavior from scratch.

## Scoping Rules

- Work on one feature unit or subsystem at a time.
- Prefer small, verifiable increments over large speculative changes.
- Do not combine unrelated system boundaries in a single implementation step.

## When To Split Work

Split an implementation step if it combines:

- Two or more feature specs (one feature per chat, always).
- A UI slice and a PDF rendering change in the same step (PDF is a separate boundary).
- A schema migration and a refactor that does not depend on it.
- More than one module boundary change at once.
- A change that cannot be verified end to end within a single feature's `Check When Done`.

If a change cannot be verified end to end quickly, the scope is too broad — split it.

## Handling Missing Requirements

- Do not invent product behavior that is not defined in the context files.
- If a requirement is ambiguous, resolve it in the relevant context file before implementing.
- If a requirement is missing, add it as an open question in `progress-tracker.md` before continuing.
- Do not invent function names, configuration, or package imports. Read the package's official documentation when unsure.

## Protected Foundation Components

Do not modify generated third-party foundation components unless explicitly instructed.

This includes:

- `src/components/ui/*` — shadcn/ui generated components (Button, Input, Dialog, Table, Toast, dll.)
- `tailwind.config.ts` foundation tokens (extends, plugins) — kecuali task eksplisit
- `prisma/schema.prisma` milik Better Auth (`user`, `account`, `session`, `verification`) — tambah field boleh, ubah relasi inti tidak
- `package.json` scripts yang sudah didefinisikan di feature 00

These should remain default and reusable.

Project-specific styling, layout changes, and feature logic must be implemented in app-level components instead of modifying foundation components.

Only modify these files when a task explicitly requires it.

## Keeping Docs In Sync

Update the relevant context file whenever implementation changes:

- `progress-tracker.md` — setiap feature selesai / state berubah (wajib, bukan opsional).
- `data-model.md` — setiap entity/field baru ditambah.
- `architecture-context.md` env var table — setiap env var baru (tambah row di sini dulu, baru pakai).
- `security-standards.md` — jika ada rule authorization baru yang discovery saat build.

Progress state must reflect the actual state of the implementation, not the intended state.

## Before Moving To The Next Unit

- `Check When Done` dari feature spec lulus semua.
- Lint + typecheck + test lulus.
- Progress tracker di-update (feature → Completed, next goal diset).
- Commit sudah dibuat (per `## Commit and Push` di feature spec).

## Commit and Push

A feature is only ready to commit after its `Check When Done` passes and the test suite is green. This is not negotiable, and it is the same in every feature spec.

The order is fixed:

1. Every item in the feature spec's `Check When Done` passes.
2. Tests pass (`npm run test`).
3. Lint and typecheck pass (`npm run lint`, `npm run typecheck`).
4. Ask which branch to commit to. Never commit silently, never pick the branch without asking.
5. Commit with a message that names the feature.
6. Push. Never force push.

A red test or a failed check is a stop condition, not a thing to commit around. Fix it first.

Branch default: **`main`** (solo trunk-based). Branch alternatif hanya jika engineer minta review. Auto-deploy Coolify aktif pada push ke `main`.
