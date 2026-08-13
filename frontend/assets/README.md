# App icon & splash (source images)

Drop your logo here and the APK build turns it into every Android icon size
automatically (via `@capacitor/assets`, wired into `.github/workflows/android-apk.yml`).

## What to add

| File | Size | Notes |
|------|------|-------|
| `icon.png` | **1024×1024** PNG | **Required** for a custom icon. Square. A centered logo works best; transparency is used as the adaptive-icon foreground. |
| `splash.png` | 2732×2732 PNG | Optional. Launch/splash image. Logo centered in the middle ~1/3. |
| `splash-dark.png` | 2732×2732 PNG | Optional. Dark-mode splash. |

## How to use

1. Add `icon.png` (1024×1024) to this folder — commit it, or upload via the
   GitHub web UI (**Add file → Upload files** into `frontend/assets/`).
2. Run the **Build Android APK** workflow (fresh **Run workflow**, not Re-run).
3. The new `swara-debug-apk` will show your logo on the home screen.

If no `icon.png` is present, the build uses the default Capacitor icon — the
step is a no-op, so the build never fails for a missing logo.
