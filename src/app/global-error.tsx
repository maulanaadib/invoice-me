"use client";

// global-error replaces the root layout, so it renders outside every app
// provider. No context here — plain markup + globals.css tokens only.
import "./globals.css";

type GlobalErrorProps = {
  error: Error & { digest?: string };
  reset?: () => void;
};

export default function GlobalError({ reset }: GlobalErrorProps) {
  const handleReload = () => {
    if (typeof reset === "function") {
      reset();
      return;
    }
    window.location.reload();
  };

  return (
    <html lang="id">
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">
            Terjadi kesalahan
          </h1>
          <p className="max-w-sm text-sm text-muted-foreground">
            Terjadi kesalahan yang tidak terduga. Muat ulang halaman untuk
            mencoba kembali.
          </p>
          <button
            type="button"
            onClick={handleReload}
            className="mt-2 rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            Coba muat ulang
          </button>
        </main>
      </body>
    </html>
  );
}
