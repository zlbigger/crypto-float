const { app, BrowserWindow, dialog, ipcMain, net, session, shell } = require('electron');
const fs = require('fs/promises');
const path = require('path');

const DEFAULT_SETTINGS = {
  tokens: [
    { id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin' }
  ],
  alerts: [],
  sound: {
    type: 'preset',
    preset: 'bell',
    filePath: '',
    durationSeconds: 10
  },
  mascot: 'pixel-cat',
  mode: 'full',
  refreshSeconds: 15
};

let mainWindow;
let settingsPath;
let settings = structuredClone(DEFAULT_SETTINGS);
let coinbaseProductsCache;
let boardSyncState = {
  ok: false,
  connected: false,
  path: '',
  syncedAt: '',
  error: '尚未同步'
};

const BOARD_SETTINGS_FILENAME = 'crypto_float_settings.json';
const DEFAULT_BOARD_PATHS = process.platform === 'darwin'
  ? ['/Volumes/CIRCUITPY']
  : [];
const MASCOT_IDS = new Set(['pixel-cat']);

const COMMON_COINS = [
  { id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin' },
  { id: 'ethereum', symbol: 'ETH', name: 'Ethereum' },
  { id: 'dogecoin', symbol: 'DOGE', name: 'Dogecoin' },
  { id: 'solana', symbol: 'SOL', name: 'Solana' },
  { id: 'ripple', symbol: 'XRP', name: 'XRP' },
  { id: 'cardano', symbol: 'ADA', name: 'Cardano' },
  { id: 'avalanche-2', symbol: 'AVAX', name: 'Avalanche' },
  { id: 'chainlink', symbol: 'LINK', name: 'Chainlink' },
  { id: 'litecoin', symbol: 'LTC', name: 'Litecoin' },
  { id: 'polkadot', symbol: 'DOT', name: 'Polkadot' },
  { id: 'the-open-network', symbol: 'TON', name: 'Toncoin' },
  { id: 'shiba-inu', symbol: 'SHIB', name: 'Shiba Inu' }
];

async function applyProxyFromEnv() {
  const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY;
  if (!proxy) return;

  await session.defaultSession.setProxy({
    proxyRules: proxy
  });
}

function normalizeSettings(raw) {
  return {
    ...DEFAULT_SETTINGS,
    ...raw,
    tokens: Array.isArray(raw?.tokens) && raw.tokens.length ? raw.tokens : DEFAULT_SETTINGS.tokens,
    alerts: Array.isArray(raw?.alerts) ? raw.alerts : [],
    sound: {
      ...DEFAULT_SETTINGS.sound,
      ...(raw?.sound || {})
    },
    mascot: MASCOT_IDS.has(raw?.mascot) ? raw.mascot : DEFAULT_SETTINGS.mascot,
    mode: raw?.mode === 'compact' ? 'compact' : 'full'
  };
}

async function loadSettings() {
  settingsPath = path.join(app.getPath('userData'), 'settings.json');
  try {
    const data = await fs.readFile(settingsPath, 'utf8');
    settings = normalizeSettings(JSON.parse(data));
  } catch {
    settings = structuredClone(DEFAULT_SETTINGS);
    await saveSettings(settings);
  }
}

async function saveSettings(nextSettings) {
  settings = normalizeSettings(nextSettings);
  await fs.mkdir(path.dirname(settingsPath), { recursive: true });
  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2));
  await syncBoardSettings(settings);
  return settings;
}

function cleanSymbol(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function createBoardSettingsPayload(sourceSettings) {
  const normalized = normalizeSettings(sourceSettings);
  const tokens = normalized.tokens
    .map((token) => ({
      id: String(token.id || cleanSymbol(token.symbol).toLowerCase()),
      symbol: cleanSymbol(token.symbol),
      name: String(token.name || token.symbol || '').trim() || cleanSymbol(token.symbol)
    }))
    .filter((token) => token.symbol);

  const defaultToken = tokens.find((token) => token.id === normalized.compactTokenId) || tokens[0];
  const alerts = normalized.alerts
    .map((alert) => {
      const token = tokens.find((item) => item.id === alert.tokenId)
        || tokens.find((item) => item.symbol === cleanSymbol(alert.tokenSymbol));
      const value = Number(alert.value);
      if (!token || !Number.isFinite(value) || value <= 0) return null;

      return {
        id: String(alert.id || `${token.id}-${alert.direction}-${value}`),
        tokenId: token.id,
        symbol: token.symbol,
        direction: alert.direction === 'below' ? 'below' : 'above',
        value
      };
    })
    .filter(Boolean);

  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    source: 'Crypto Float',
    defaultSymbol: defaultToken?.symbol || 'BTC',
    quoteSymbol: 'USDT',
    refreshSeconds: Math.max(15, Number(normalized.refreshSeconds) || 15),
    rotateSeconds: 10,
    tokens,
    alerts
  };
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function findBoardPath() {
  const candidates = [
    process.env.CRYPTO_FLOAT_BOARD_PATH,
    ...DEFAULT_BOARD_PATHS
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (await pathExists(candidate)) return candidate;
  }
  return '';
}

async function replaceFile(targetPath, contents) {
  const tmpPath = `${targetPath}.tmp`;
  await fs.writeFile(tmpPath, contents);
  try {
    await fs.rename(tmpPath, targetPath);
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    await fs.unlink(targetPath).catch(() => {});
    await fs.rename(tmpPath, targetPath);
  }
}

function comparableBoardSettings(payload) {
  const { updatedAt, ...stablePayload } = payload;
  return JSON.stringify(stablePayload);
}

async function syncBoardSettings(sourceSettings = settings) {
  const boardPath = await findBoardPath();
  if (!boardPath) {
    boardSyncState = {
      ok: false,
      connected: false,
      path: '',
      syncedAt: '',
      error: '没有检测到 CIRCUITPY 板子'
    };
    console.log('[board-sync] CIRCUITPY not found');
    return boardSyncState;
  }

  try {
    const payload = createBoardSettingsPayload(sourceSettings);
    const targetPath = path.join(boardPath, BOARD_SETTINGS_FILENAME);
    try {
      const currentPayload = JSON.parse(await fs.readFile(targetPath, 'utf8'));
      if (comparableBoardSettings(currentPayload) === comparableBoardSettings(payload)) {
        boardSyncState = {
          ok: true,
          connected: true,
          path: targetPath,
          syncedAt: currentPayload.updatedAt || '',
          error: ''
        };
        console.log(`[board-sync] already current ${targetPath}`);
        return boardSyncState;
      }
    } catch {
      // Missing or invalid board config: write a fresh copy below.
    }

    await replaceFile(targetPath, `${JSON.stringify(payload, null, 2)}\n`);
    boardSyncState = {
      ok: true,
      connected: true,
      path: targetPath,
      syncedAt: payload.updatedAt,
      error: ''
    };
    console.log(`[board-sync] wrote ${targetPath}`);
  } catch (error) {
    boardSyncState = {
      ok: false,
      connected: true,
      path: boardPath,
      syncedAt: '',
      error: String(error?.message || error || '同步失败')
    };
    console.warn(`[board-sync] failed: ${boardSyncState.error}`);
  }

  return boardSyncState;
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 8000);

  let response;
  try {
    response = await net.fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(options.headers || {})
      }
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new Error(`${new URL(url).hostname} returned ${response.status}`);
  }

  return response.json();
}

async function fetchCoinGeckoPrices(tokenIds) {
  const ids = [...new Set(tokenIds)].filter(Boolean).join(',');
  if (!ids) return {};

  const url = new URL('https://api.coingecko.com/api/v3/simple/price');
  url.searchParams.set('ids', ids);
  url.searchParams.set('vs_currencies', 'usd');
  url.searchParams.set('include_24hr_change', 'true');

  return fetchJson(url);
}

async function fetchCryptoComparePrices(tokenIds) {
  const tokens = settings.tokens.filter((token) => tokenIds.includes(token.id));
  const symbols = [...new Set(tokens.map((token) => String(token.symbol || '').toUpperCase()).filter(Boolean))];
  if (!symbols.length) return {};

  const url = new URL('https://min-api.cryptocompare.com/data/pricemultifull');
  url.searchParams.set('fsyms', symbols.join(','));
  url.searchParams.set('tsyms', 'USD');

  const data = await fetchJson(url);
  const raw = data.RAW || {};

  return Object.fromEntries(tokens.flatMap((token) => {
    const symbol = String(token.symbol || '').toUpperCase();
    const quote = raw[symbol]?.USD;
    const price = Number(quote?.PRICE);
    const change = Number(quote?.CHANGEPCT24HOUR);
    if (!Number.isFinite(price)) return [];

    return [[token.id, {
      usd: price,
      usd_24h_change: Number.isFinite(change) ? change : null
    }]];
  }));
}

async function getCoinbaseProducts() {
  if (coinbaseProductsCache) return coinbaseProductsCache;
  const products = await fetchJson('https://api.exchange.coinbase.com/products', {
    headers: {
      'User-Agent': 'CryptoFloat/0.1'
    }
  });
  coinbaseProductsCache = products.filter((product) => product.quote_currency === 'USD');
  return coinbaseProductsCache;
}

async function fetchCoinbasePrices(tokenIds) {
  const tokens = settings.tokens.filter((token) => tokenIds.includes(token.id));
  const products = await getCoinbaseProducts();
  const result = {};

  await Promise.all(tokens.map(async (token) => {
    const symbol = String(token.symbol || '').toUpperCase();
    const product = products.find((item) => item.base_currency === symbol);
    if (!product) return;

    const [ticker, stats] = await Promise.all([
      fetchJson(`https://api.exchange.coinbase.com/products/${product.id}/ticker`, {
        headers: { 'User-Agent': 'CryptoFloat/0.1' }
      }),
      fetchJson(`https://api.exchange.coinbase.com/products/${product.id}/stats`, {
        headers: { 'User-Agent': 'CryptoFloat/0.1' }
      })
    ]);
    const price = Number(ticker.price);
    const open = Number(stats.open);
    const change = Number.isFinite(price) && Number.isFinite(open) && open > 0
      ? ((price - open) / open) * 100
      : null;
    result[token.id] = {
      usd: price,
      usd_24h_change: change
    };
  }));

  return result;
}

async function fetchHuobiPrices(tokenIds) {
  const tokens = settings.tokens.filter((token) => tokenIds.includes(token.id));
  const result = {};

  await Promise.all(tokens.map(async (token) => {
    const symbol = String(token.symbol || '').toLowerCase();
    if (!symbol) return;

    const data = await fetchJson(`https://api.huobi.pro/market/detail/merged?symbol=${symbol}usdt`);
    const tick = data.tick || {};
    const price = Number(tick.close);
    const open = Number(tick.open);
    if (!Number.isFinite(price)) return;

    result[token.id] = {
      usd: price,
      usd_24h_change: Number.isFinite(open) && open > 0 ? ((price - open) / open) * 100 : null
    };
  }));

  return result;
}

async function fetchGatePrices(tokenIds) {
  const tokens = settings.tokens.filter((token) => tokenIds.includes(token.id));
  const result = {};

  await Promise.all(tokens.map(async (token) => {
    const symbol = String(token.symbol || '').toUpperCase();
    if (!symbol) return;

    const data = await fetchJson(`https://api.gateio.ws/api/v4/spot/tickers?currency_pair=${symbol}_USDT`);
    const ticker = Array.isArray(data) ? data[0] : null;
    const price = Number(ticker?.last);
    const change = Number(ticker?.change_percentage);
    if (!Number.isFinite(price)) return;

    result[token.id] = {
      usd: price,
      usd_24h_change: Number.isFinite(change) ? change : null
    };
  }));

  return result;
}

async function fetchPrices(tokenIds) {
  const ids = [...new Set(tokenIds)].filter(Boolean);
  if (!ids.length) return {};

  const sources = [
    ['cryptocompare', fetchCryptoComparePrices],
    ['coingecko', fetchCoinGeckoPrices],
    ['gate', fetchGatePrices],
    ['huobi', fetchHuobiPrices],
    ['coinbase', fetchCoinbasePrices]
  ];
  const errors = [];

  for (const [source, fetcher] of sources) {
    try {
      const prices = await fetcher(ids);
      if (Object.keys(prices).length) return { source, prices };
    } catch (error) {
      errors.push(`${source}: ${error?.message || error}`);
    }
  }

  throw new Error(`真实行情源全部不可用：${errors.join('；')}`);
}

async function fetchPricesResult(tokenIds) {
  try {
    const result = await fetchPrices(tokenIds);
    return {
      ok: true,
      source: result.source,
      prices: result.prices,
      error: ''
    };
  } catch (error) {
    return {
      ok: false,
      source: 'none',
      prices: {},
      error: String(error?.message || error || '行情源连接失败')
    };
  }
}

async function searchCoinGecko(query) {
  const cleanQuery = String(query || '').trim();
  if (!cleanQuery) return [];

  const url = new URL('https://api.coingecko.com/api/v3/search');
  url.searchParams.set('query', cleanQuery);

  const data = await fetchJson(url);
  return (data.coins || []).slice(0, 8).map((coin) => ({
    id: coin.id,
    symbol: String(coin.symbol || '').toUpperCase(),
    name: coin.name,
    thumb: coin.thumb
  }));
}

async function searchCoinbase(query) {
  const cleanQuery = String(query || '').trim().toUpperCase();
  if (!cleanQuery) return [];

  const products = await getCoinbaseProducts();
  return products
    .filter((product) => (
      product.base_currency.includes(cleanQuery)
      || String(product.display_name || '').toUpperCase().includes(cleanQuery)
      || String(product.base_name || '').toUpperCase().includes(cleanQuery)
    ))
    .slice(0, 8)
    .map((product) => ({
      id: `coinbase-${product.base_currency.toLowerCase()}`,
      symbol: product.base_currency,
      name: product.base_name || product.display_name || product.base_currency
    }));
}

async function searchCoins(query) {
  try {
    return await searchCoinGecko(query);
  } catch {
    try {
      return await searchCoinbase(query);
    } catch {
      const cleanQuery = String(query || '').trim().toUpperCase();
      return COMMON_COINS.filter((coin) => (
        coin.symbol.includes(cleanQuery) || coin.name.toUpperCase().includes(cleanQuery)
      )).slice(0, 8);
    }
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 390,
    height: 540,
    minWidth: 320,
    minHeight: 430,
    frame: false,
    transparent: true,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: false,
    title: 'Crypto Float',
    vibrancy: 'under-window',
    visualEffectState: 'active',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(async () => {
  await applyProxyFromEnv();
  await loadSettings();
  await syncBoardSettings(settings);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('settings:get', async () => settings);
ipcMain.handle('settings:save', async (_event, nextSettings) => saveSettings(nextSettings));
ipcMain.handle('prices:fetch', async (_event, tokenIds) => fetchPricesResult(tokenIds));
ipcMain.handle('coins:search', async (_event, query) => searchCoins(query));
ipcMain.handle('board:sync', async () => syncBoardSettings(settings));
ipcMain.handle('board:status', async () => boardSyncState);

ipcMain.handle('sound:choose', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择提醒声音',
    properties: ['openFile'],
    filters: [
      { name: 'Audio', extensions: ['mp3', 'wav', 'm4a', 'aac', 'ogg'] }
    ]
  });

  if (result.canceled || !result.filePaths[0]) return null;
  return result.filePaths[0];
});

ipcMain.handle('app:open-settings-file', async () => {
  await shell.showItemInFolder(settingsPath);
});

ipcMain.on('window:minimize', () => mainWindow?.minimize());
ipcMain.on('window:close', () => mainWindow?.close());
ipcMain.on('window:set-mode', (_event, mode) => {
  if (!mainWindow) return;
  if (mode === 'compact') {
    mainWindow.setMinimumSize(260, 92);
    mainWindow.setSize(320, 96, true);
    return;
  }
  mainWindow.setMinimumSize(320, 520);
  mainWindow.setSize(390, 540, true);
});
