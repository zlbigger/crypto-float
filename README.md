# Crypto Float

Crypto Float is a lightweight macOS floating crypto price watcher. It keeps selected token prices on top of your desktop, supports price alerts, custom sounds, cute animated alert characters, and a compact ticker mode for day-to-day monitoring.

Crypto Float 是一个 macOS 悬浮加密货币行情工具。它可以置顶显示 BTC 等代币价格，支持价格提醒、内置/自定义提醒声音、Q 版提醒角色，以及简约浮动行情条。

## Features

- Floating always-on-top macOS window.
- BTC is enabled by default on first launch.
- Search and add more tokens.
- Live price refresh from multiple public market APIs.
- Price alerts for above/below USD targets.
- Built-in alert sounds with preview.
- Custom local audio file support.
- Alert sound duration, defaulting to 10 seconds.
- Manual stop button for active alert sounds.
- Cute alert characters: cat, dog, chibi girl, chibi boy.
- Compact mode that automatically rotates through added token prices.
- Click, double-click, or right-click the compact ticker to return to full mode.
- Local settings stored in the app user data directory.

## Download

For normal users, download the macOS app from the GitHub Releases page:

- `Crypto-Float-mac-arm64.zip`

Unzip it, then open `Crypto Float.app`.

Because this is currently an unsigned local build, macOS may block it the first time. If that happens, right-click `Crypto Float.app` and choose **Open**.

## Build From Source

Requirements:

- macOS
- Node.js 20+
- npm

Install dependencies:

```bash
npm install
```

Run in development:

```bash
npm start
```

Run syntax checks:

```bash
npm run check
```

Build the macOS `.app`:

```bash
npm run package:mac
```

The app will be generated at:

```text
dist/Crypto Float-darwin-arm64/Crypto Float.app
```

## Market Data

Crypto Float tries multiple public data sources and uses the first available live result:

- CryptoCompare
- CoinGecko
- Gate.io
- Huobi
- Coinbase

Public APIs may be rate-limited or temporarily unavailable. If your network requires a proxy, start the app with proxy environment variables:

```bash
HTTPS_PROXY=http://127.0.0.1:7890 npm start
```

## Privacy

Crypto Float stores settings locally through Electron's user data directory. It does not require an account and does not send your alert settings to a private backend.

## Roadmap Ideas

- Signed and notarized macOS builds.
- Universal Intel + Apple Silicon build.
- Custom app icon.
- More alert characters and sound packs.
- Optional menu bar mode.

## License

MIT
