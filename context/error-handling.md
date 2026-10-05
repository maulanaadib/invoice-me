# Error Handling and Observability

The contract for failure. When something breaks, every layer fails the same way, so a builder never invents an error shape mid feature.

## Error Response Shape

```ts
type ApiResponse<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: {
        code: string;      // machine code, e.g. "VALIDATION_ERROR"
        message: string;   // user-facing Bahasa Indonesia
        details?: Record<string, unknown>; // field errors, safe values only
      };
    };
```

One shape for every API response, success and failure. A client can rely on it everywhere.

## Error Categories

| Category | Meaning | HTTP status | Retryable |
| --- | --- | --- | --- |
| `VALIDATION_ERROR` | Input gagal validasi Zod | 400 | no |
| `UNAUTHORIZED` | Tidak ada session / session kedaluwarsa | 401 | no |
| `FORBIDDEN` | Ada session, role tidak cukup | 403 | no |
| `NOT_FOUND` | Resource tidak ada atau bukan milik org session (IDOR guard returns 404, bukan 403, untuk hindari info leak) | 404 | no |
| `CONFLICT` | Race condition nomor invoice, sequence conflict, unique violation | 409 | yes (retry terbatas) |
| `RATE_LIMITED` | Terlalu banyak request / login attempt | 429 | yes (backoff) |
| `LOCKED` | Invoice sudah ISSUED, data finansial dikunci | 423 | no |
| `INTERNAL_ERROR` | Error tak terduga | 500 | yes (retry terbatas) |

## Handling Rules

- **Error dilempar dari service layer** sebagai typed `AppError(code, message, details)`. Route handler menangkap dan memetakan ke HTTP + response shape.
- **Client fetch wrapper** mengekstrak `error` atau `data`; tidak ada try/catch raw di component.
- **Conflict retry**: numbering engine retry maksimal 3x dengan backoff; jika masih gagal, lempar `CONFLICT` ke user.
- **IDOR guard mengembalikan 404**, bukan 403, agar tidak membocorkan eksistensi resource.
- **Upload error** dipisahkan: file terlalu besar, tipe salah, korup — masing-masing message Indonesia jelas.
- **Never leak internals**: no stack trace, no query, no internal module name di response. Error server-side di-log penuh, user hanya lihat message umum.

## Logging

- **pino structured JSON ke stdout** (Docker logs menangkap). Level: `info` (lifecycle), `warn` (validasi/authorization failure), `error` (internal error).
- Log fields stabil: `timestamp`, `level`, `msg`, `module`, `action`, `userId` (jika ada), `organizationId` (jika ada), `requestId`.
- **Tidak boleh muncul di log**: password, token, `BETTER_AUTH_SECRET`, `INTERNAL_PDF_SECRET`, encryption key, nomor rekening lengkap, NPWP, email user di level info (hanya userId hashed).
- Audit action dicatat terpisah ke `AuditLog` table (bukan hanya log), karena ini yang dipakai panel admin.

## Observability

- **GlitchTip (self-hosted Sentry-compatible)** dari feature 01: unhandled error + promise rejection otomatis terkirim (`GLITCHTIP_DSN` env; disabled di dev).
- **`/health` endpoint** mengembalikan status: db reachable, storage writable, pdf-service reachable. Dipakai Docker healthcheck. Tidak membocorkan secret.
- **`/health` pdf-service** sendiri untuk compose dependency health.
- Docker healthcheck di setiap service; compose `depends_on` pakai `condition: service_healthy`.
- Metrics/tracing (Prometheus/OTel) **defer** — JSON structured log + GlitchTip cukup untuk MVP.

## User Facing Errors

- Bahasa Indonesia plain language. Contoh: "Nomor invoice sudah digunakan, coba lagi" bukan "CONFLICT: unique constraint violation".
- **Field error** muncul inline di form dengan label jelas.
- **Toast** non-intrusive untuk aksi berhasil/gagal (shadcn toast), tidak blocking.
- **Empty state** + **loading state** di setiap halaman/table; bukan blank page.
- **Global error page** (`error.tsx`) dan **not-found page** (`not-found.tsx`) Bahasa Indonesia.
- **Unsaved changes warning** di invoice editor (`beforeunload` + route block) saat ada perubahan draft belum tersimpan.
