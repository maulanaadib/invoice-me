# Product Context

## Problem

Membuat invoice profesional di Indonesia masih manual dan rawan kesalahan: angka ditulis tangan atau di Excel floating-point, terbilang ditulis manual, nomor invoice bisa ganda atau tidak konsisten, dan format PDF tidak konsisten antar karyawan. Untuk bisnis yang menagih pakai Down Payment dan Termin (umum di project hardware/jasa), pelacakan "sudah ditagihkan vs sisa tagihan" per PO dilakukan manual dengan spreadsheet yang mudah lepas. Solusi invoice SaaS existing umumnya tidak self-hosted, tidak mengakomodasi pola penagihan DP/Termin Indonesia, dan tidak mendukung beberapa profile invoice dalam satu organization.

## Users

| User | Job they hire the product to do |
| --- | --- |
| Owner bisnis jasa/hardware | Menagih project bertahap (DP, termin, pelunasan) tanpa salah hitung sisa, dan tahu persis berapa sudah ditagihkan per PO. |
| Staff admin/finance | Membuat invoice cepat dengan preview A4 yang persis sama dengan PDF yang dikirim, tanpa Format ulang manual. |
| Super admin platform (self-hosted) | Mengelola beberapa user dan organization dalam satu instance tanpa data antar perusahaan bocor, dengan audit trail. |
| Viewer (auditor/akuntan) | Melihat dan mengunduh invoice yang diizinkan tanpa bisa mengubah data. |

## Success Metrics

| Metric | Baseline | Target | How measured |
| --- | --- | --- | --- |
| Waktu buat invoice DP/Termin dari PO | 15–30 menit (Excel + Word + manual terbilang) | < 5 menit end-to-end termasuk PDF | E2E test timing + manual sampling |
| Kesalahan hitung / selisih angka di invoice | Terjadi saat formula Excel manual | 0 (server-side decimal recalculation) | Unit test calculation suite (no floating point error) |
| Invoice ganda / nomor hilang | Sering terjadi manual | 0 (numbering engine anti-race, unique constraint) | Unit test numbering concurrency |
| Invoice lama berubah saat profil/customer diubah | Terjadi saat edit master data | 0 (snapshot immutability saat ISSUED) | Integration test: edit profile, assert invoice issued tidak berubah |
| Visibility sisa tagihan per PO | Tidak ada (cek spreadsheet manual) | Real-time di invoice editor dan project detail | ProjectReference.billedRemaining tampil di UI + integration test |
| Onboarding organization baru | Manual setup berhari-hari | < 20 menit via wizard 12 langkah | E2E test onboarding flow |

## Non Goals

- **Bukan payment gateway.** Aplikasi tidak memproses pembayaran; hanya mencatat pembayaran yang diterima manual. Status PAID adalah rekaman, bukan konfirmasi bank.
- **Bukan e-meterai resmi.** Aplikasi hanya mengatur layout placeholder e-meterai. Pembubuhan e-meterai resmi tetap dilakukan di luar aplikasi (diterangkan di pengaturan meterai).
- **Bukan akuntansi full-cycle.** Tidak ada jurnal, neraca, atau laporan pajak. Fokusnya dokumen invoice yang benar.
- **Bukan editor template visual.** Template invoice adalah Corporate Blue satu paket untuk MVP; kustomisasi hanya via profile primary color.
- **Bukan multi-currency converter.** IDR saja untuk MVP.
- **Bukan SaaS ter-hosting kami.** Self-hosted di infra pengguna (Coolify/Docker). Data sepenuhnya milik pengguna.
