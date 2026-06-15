#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_NAME="Crypto Float"
OUT_DIR="$ROOT/dist/$APP_NAME-darwin-arm64"
APP_DIR="$OUT_DIR/$APP_NAME.app"
BUILD_ROOT="${TMPDIR:-/tmp}/crypto-float-package"
BUILD_APP="$BUILD_ROOT/$APP_NAME.app"
ELECTRON_APP="$ROOT/node_modules/electron/dist/Electron.app"
PLIST="$BUILD_APP/Contents/Info.plist"

if [[ ! -d "$ELECTRON_APP" ]]; then
  echo "Electron runtime not found. Run npm install first." >&2
  exit 1
fi

rm -rf "$BUILD_ROOT" "$APP_DIR"
mkdir -p "$BUILD_ROOT" "$OUT_DIR"
ditto --noextattr --noacl "$ELECTRON_APP" "$BUILD_APP"

mv "$BUILD_APP/Contents/MacOS/Electron" "$BUILD_APP/Contents/MacOS/$APP_NAME"
mkdir -p "$BUILD_APP/Contents/Resources/app"
rsync -a "$ROOT/src" "$ROOT/package.json" "$BUILD_APP/Contents/Resources/app/"

plutil -replace CFBundleDisplayName -string "$APP_NAME" "$PLIST"
plutil -replace CFBundleName -string "$APP_NAME" "$PLIST"
plutil -replace CFBundleExecutable -string "$APP_NAME" "$PLIST"
plutil -replace CFBundleIdentifier -string "com.local.cryptofloat" "$PLIST"

find "$BUILD_APP" -name "._*" -delete
dot_clean -m "$BUILD_APP" 2>/dev/null || true
xattr -cr "$BUILD_APP" 2>/dev/null || true
xattr -r -d com.apple.FinderInfo "$BUILD_APP" 2>/dev/null || true
xattr -r -d "com.apple.fileprovider.fpfs#P" "$BUILD_APP" 2>/dev/null || true
xattr -r -d com.apple.provenance "$BUILD_APP" 2>/dev/null || true
codesign --force --deep --sign - "$BUILD_APP"
codesign --verify --deep --strict "$BUILD_APP"

ditto --noextattr --noacl "$BUILD_APP" "$APP_DIR"

echo "Wrote $APP_DIR"
