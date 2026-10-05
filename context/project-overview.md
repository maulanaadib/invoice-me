# invoice-me (InvoiceFlow)

## Overview

**invoice-me** adalah platform invoice self-hosted multi-tenant untuk membuat, mengelola, dan mengekspor invoice profesional (Down Payment, Pelunasan, Full, Termin) dengan live preview A4 dan ekspor PDF. Dibangun untuk pemakaian internal multi-organization terlebih dahulu, dirancang untuk bisa dipublikasikan sebagai SaaS self-hosted.

## Goals

- Membuat invoice 4 jenis (DP, Pelunasan, Full, Termin) dengan perhitungan otomatis yang akurat secara hukum pajak Indonesia (PPN exclusive/inclusive/manual, terbilang Bahasa Indonesia).
- Multi-tenant: beberapa perusahaan dapat memakai instance yang sama tanpa bocor data antar organization.
- Hasil akhir terlihat seperti aplikasi bisnis sungguhan, bukan demo AI: setiap tombol benar-benar bekerja, PDF profesional siap kirim.
- Self-hosted sepenuhnya via Docker Compose di Coolify, termasuk backup/restore.

## Core User Flow

1. Super admin login, membuat user dengan temporary password.
2. User login (username atau email), dipaksa ganti password, lalu onboarding: buat/pilih organization, isi profil invoice, upload logo, atur nomor invoice, meterai, rekening, penanda tangan.
3. User membuat customer + PIC, dan/atau project/PO sebagai dasar penagihan.
4. User membuat invoice di editor split-screen (kiri form, kanan live preview A4): pilih profile, jenis penagihan, customer, item pekerjaan, pajak, rekening, meterai.
5. User menerbitkan invoice: nomor final dialokasikan, snapshot disimpan, data dikunci, PDF resmi dibuat oleh pdf-service.
6. User mengunduh PDF, mencatat pembayaran, status berubah (SENT/PARTIALLY_PAID/PAID), bisa revisi atau batalkan.
7. Super admin memantau seluruh aktivitas via panel admin + audit log.

## Features

**Foundation**

- Autentikasi (login username/email + password, no public registration, rate limit, lockout, force password change)
- Multi-tenant organization + membership dengan role (OWNER, ADMIN, STAFF, VIEWER)
- Onboarding wizard 12 langkah + invoice profile (logo, warna brand, nomor invoice, meterai)
- Customer & PIC, Project/PO reference

**Invoice engine**

- Editor split-screen dengan live preview A4, autosave draft
- Tabel item dinamis (drag reorder, unit preset, auto calculation)
- Kalkulasi decimal (DP/persentase, pelunasan, termin, custom, PPN, discount, rounding)
- Terbilang Bahasa Indonesia
- Invoice numbering engine (token pattern, anti race condition, reset policy)
- Issue flow dengan snapshot immutability + lock data finansial
- Status lifecycle (DRAFT → ISSUED → SENT → PARTIALLY_PAID → PAID / OVERDUE / CANCELLED / REVISED)
- Revision flow (invoice lama jadi REVISED, tidak double count)

**PDF & preview**

- Shared renderer (preview dan print pakai source yang sama)
- Template Corporate Blue, A4 portrait, multi-page dengan repeated table header
- pdf-service terpisah (Playwright Chromium, signed internal request)
- Storage persistent + secure download

**Operasional**

- Pembayaran (record payment, update status otomatis, upload bukti)
- Dashboard cards + grafik ringkas tagihan vs pembayaran
- Invoice list server-side (pagination, search, filter, sort, row actions)
- Bank account (encrypt at rest, masked) + signer management
- Super admin panel (users, organizations, invoices, PDF jobs, audit logs, storage, system health)
- Audit log 22 action

## Scope

### In Scope

- Seluruh acceptance criteria master prompt bagian 35 (40 poin): Docker Compose sehat, migration + seed, login multi-user, org isolation, onboarding, invoice 4 jenis, kalkulasi server benar, terbilang benar, PDF A4 multi-page, revision, pembayaran, admin monitoring, audit log, backup/restore, lint/typecheck/test/build lulus.
- UI Bahasa Indonesia, locale id-ID, timezone Asia/Jakarta (DB UTC).
- Dark + light mode (print selalu light), template Corporate Blue.
- Deployment Docker Compose di Coolify (app + postgres + pdf-service, optional cloudflared).

### Out Of Scope

- **QRIS** — fase berikutnya; modul rekening siap field opsional.
- **SMTP forgot-password** — MVP menampilkan "hubungi admin"; struktur kode siap integrasi SMTP nanti.
- **Multi-currency** — dukungan awal IDR; struktur kode extensible tapi tidak ada currency lain di MVP.
- **Product analytics** — hanya error tracking (GlitchTip).
- **E-meterai resmi** — aplikasi hanya mengatur layout placeholder, bukan pembubuhan e-meterai resmi.
- **Billing SaaS / monetisasi** — belum; struktur multi-tenant siap, tidak ada payment gateway.
- **Internationalization** — hardcode id-ID untuk MVP.
- **Public API / realtime collaboration / offline support** — tidak ada.
- **Email notification** — defer.
