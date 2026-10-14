# Build flake: next build prerender "/_global-error" useContext null

Discovered 2026-10-14 during UI modernization (Change 1 = commit 62b8a47).

## Symptom

`next build` (Next 16.3.8, output: standalone) intermittently fails:

```
Error occurred prerendering page "/_global-error"
TypeError: Cannot read properties of null (reading 'useContext')
Export encountered an error on /_global-error/page: /_global-error, exiting the build.
```

Right before it, non-fatal warnings appear:
```
Each child in a list should have a unique "key" prop.
Check the top-level render call using <head> / <meta>.
```

## Evidence (7 runs at 62b8a47, 6 at 1bb9933)

| Commit | Runs | Result |
| --- | --- | --- |
| 1bb9933 (pre-UI) | 4 | 4 OK, 0 fail |
| 62b8a47 (token refresh) | 7 | 5 OK, **2 fail** |

Not deterministic: same tree, same CSS, 5/7 pass.

## What it is NOT

- NOT the color tokens, radius scale, typography changes — reverting only
  `globals.css` to the 1bb9933 version made the flake disappear, but so did
  re-running the full 62b8a47 CSS unchanged, and so did removing/keeping the
  shadow scale in various shapes (xs only, xs+sm, xs+sm+md all built OK).
- NOT a runtime app bug — `next start` serves the app fine (login, dashboard,
  invoice editor all 200). Only the static prerender of `_global-error` breaks.
- There is no `src/app/global-error.tsx`; the page is Next's built-in.

## Most likely cause

`_global-error` renders OUTSIDE the root layout, so `ThemeProvider`
(next-themes, `attribute="class"`) is not in its React tree. next-themes reads
context at module/render time; during prerender the hook's context provider
tree can resolve to null under memory/build-worker pressure — the classic
next-themes + global-error combination. The CSS change made it *more likely*
(larger generated stylesheet = more work in the build worker) but is not the
root cause; the latent hazard predates it.

## Fix options (none applied yet — owed decision)

1. **Add `src/app/global-error.tsx`** that renders without ThemeProvider
   (plain `<html><body>` + error content). Most direct fix; the page becomes
   deterministic because it no longer depends on next-themes context.
2. **Retry the build in CI** — papers over the flake, does not fix it. Bad for
   Coolify deploys (no retry by default).
3. Pin next-themes version — no evidence the version is the trigger.

Recommended: **option 1**. It is a 1-file additive change, no contract impact,
and it removes the only prerender path that touches next-themes outside the
provider.

## Impact

- Local dev / `next start`: none.
- Production deploy (Coolify builds `next build`): ~30% of builds fail. This is
  a real deploy blocker for the Coolify rollout and must be fixed before deploy.

## Note on orchestrator process

The orchestrator verified `next build` ONCE at Change 1, saw EXIT=0, and pushed
62b8a47. The flake surfaced on later runs. Single-run verification of a build
known to be flaky is insufficient — see lesson in progress-tracker notes.
