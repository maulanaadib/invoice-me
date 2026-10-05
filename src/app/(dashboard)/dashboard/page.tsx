export default function DashboardPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-6 rounded-xl border border-border bg-card p-10 shadow-sm">
        <div className="flex flex-col items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            invoice-me
          </h1>
          <p className="text-sm text-muted-foreground">
            Platform Invoice Self-Hosted
          </p>
        </div>

        <div className="rounded-lg border border-dashed border-border bg-muted/50 px-8 py-4 text-center">
          <p className="text-sm font-medium text-muted-foreground">
            Setup complete — feature 01 builds here
          </p>
        </div>

        <p className="max-w-xs text-center text-xs text-muted-foreground">
          Autentikasi, manajemen organisasi, dan fitur bisnis akan tersedia
          setelah feature 01 diimplementasi.
        </p>
      </div>
    </div>
  );
}
