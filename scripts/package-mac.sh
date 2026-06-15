#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_NAME="Crypto Float"
OUT_DIR="$ROOT/dist/$APP_NAME-darwin-arm64"
APP_DIR="$OUT_DIR/$APP_NAME.app"
ELECTRON_APP="$ROOT/node_modules/electron/dist/Electron.app"
PLIST="$APP_DIR/Contents/Info.plist"

if [[ ! -d "$ELECTRON_APP" ]]; then
  echo "Electron runtime not found. Run npm install first." >&2
  exit 1
fi

rm -rf "$APP_DIR"
mkdir -p "$OUT_DIR"
cp -R "$ELECTRON_APP" "$APP_DIR"

mv "$APP_DIR/Contents/MacOS/Electron" "$APP_DIR/Contents/MacOS/$APP_NAME"
mkdir -p "$APP_DIR/Contents/Resources/app"
rsync -a "$ROOT/src" "$ROOT/package.json" "$APP_DIR/Contents/Resources/app/"

plutil -replace CFBundleDisplayName -string "$APP_NAME" "$PLIST"
plutil -replace CFBundleName -string "$APP_NAME" "$PLIST"
plutil -replace CFBundleExecutable -string "$APP_NAME" "$PLIST"
plutil -replace CFBundleIdentifier -string "com.local.cryptofloat" "$PLIST"

echo "Wrote $APP_DIR"
