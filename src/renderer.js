const api = window.cryptoFloat;

const SOUND_PRESETS = {
  bell: { label: '清亮铃声', notes: [880, 1175, 1320], wave: 'sine', gap: 0.36 },
  pulse: { label: '电子脉冲', notes: [520, 520, 740], wave: 'square', gap: 0.28 },
  chime: { label: '柔和叮咚', notes: [660, 990, 1320], wave: 'triangle', gap: 0.42 },
  urgent: { label: '请注意警示', notes: [760, 520, 760, 520], wave: 'sawtooth', gap: 0.22 },
  soft: { label: '轻柔提示', notes: [392, 523, 659], wave: 'sine', gap: 0.52 }
};

const MASCOT_LABELS = {
  'pixel-cat': '像素猫'
};

const els = {
  status: document.getElementById('status'),
  priceList: document.getElementById('priceList'),
  refreshBtn: document.getElementById('refreshBtn'),
  settingsBtn: document.getElementById('settingsBtn'),
  settingsOverlay: document.getElementById('settingsOverlay'),
  closeSettingsBtn: document.getElementById('closeSettingsBtn'),
  closeBtn: document.getElementById('closeBtn'),
  minBtn: document.getElementById('minBtn'),
  compactBar: document.getElementById('compactBar'),
  compactSymbol: document.getElementById('compactSymbol'),
  compactName: document.getElementById('compactName'),
  compactPrice: document.getElementById('compactPrice'),
  compactChange: document.getElementById('compactChange'),
  expandBtn: document.getElementById('expandBtn'),
  modeSelect: document.getElementById('modeSelect'),
  tabs: document.querySelectorAll('.tab'),
  tabPanels: document.querySelectorAll('.tab-panel'),
  coinSearch: document.getElementById('coinSearch'),
  searchBtn: document.getElementById('searchBtn'),
  searchResults: document.getElementById('searchResults'),
  boardSyncStatus: document.getElementById('boardSyncStatus'),
  syncBoardBtn: document.getElementById('syncBoardBtn'),
  alertToken: document.getElementById('alertToken'),
  alertDirection: document.getElementById('alertDirection'),
  alertValue: document.getElementById('alertValue'),
  addAlertBtn: document.getElementById('addAlertBtn'),
  alerts: document.getElementById('alerts'),
  soundPreset: document.getElementById('soundPreset'),
  soundDuration: document.getElementById('soundDuration'),
  testSoundBtn: document.getElementById('testSoundBtn'),
  stopSoundBtn: document.getElementById('stopSoundBtn'),
  customSoundBtn: document.getElementById('customSoundBtn'),
  presetSoundBtn: document.getElementById('presetSoundBtn'),
  soundInfo: document.getElementById('soundInfo'),
  mascotSelect: document.getElementById('mascotSelect'),
  mascotPreview: document.getElementById('mascotPreview'),
  mascotRunner: document.getElementById('mascotRunner'),
  runnerMascot: document.getElementById('runnerMascot')
};

let settings;
let prices = {};
let timer;
let activeAudio = null;
let compactIndex = 0;
let compactRotateTimer;
let boardSyncState = null;
const firedAlerts = new Set();

function normalizeClientSettings(raw) {
  const tokens = Array.isArray(raw?.tokens) && raw.tokens.length
    ? raw.tokens
    : [{ id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin' }];
  return {
    ...raw,
    tokens,
    alerts: Array.isArray(raw?.alerts) ? raw.alerts : [],
    sound: {
      type: raw?.sound?.type === 'custom' ? 'custom' : 'preset',
      preset: SOUND_PRESETS[raw?.sound?.preset] ? raw.sound.preset : 'bell',
      filePath: raw?.sound?.filePath || '',
      durationSeconds: clampDuration(raw?.sound?.durationSeconds)
    },
    mascot: MASCOT_LABELS[raw?.mascot] ? raw.mascot : 'pixel-cat',
    mode: raw?.mode === 'compact' ? 'compact' : 'full',
    refreshSeconds: Math.max(5, Number(raw?.refreshSeconds) || 15)
  };
}

function clampDuration(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 10;
  return Math.min(60, Math.max(1, Math.round(number)));
}

function formatUsd(value) {
  if (typeof value !== 'number') return '-';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: value >= 100 ? 2 : 6
  }).format(value);
}

function friendlyError(error) {
  return String(error?.message || error || '未知错误')
    .replace(/^Error invoking remote method '[^']+':\s*/, '')
    .replace(/^Error:\s*/, '');
}

function tokenOptions() {
  return settings.tokens.map((token) => (
    `<option value="${token.id}">${token.symbol}</option>`
  )).join('');
}

function render() {
  settings = normalizeClientSettings(settings);
  document.body.classList.toggle('compact-mode', settings.mode === 'compact');
  api.setWindowMode?.(settings.mode);

  els.modeSelect.value = settings.mode;
  compactIndex %= settings.tokens.length;

  renderCompactBar();
  renderPrices();
  renderAlerts();
  renderSoundControls();
  renderMascotControls();
  renderBoardSync();
}

function renderCompactBar() {
  const token = settings.tokens[compactIndex % settings.tokens.length] || settings.tokens[0];
  const data = prices[token.id] || {};
  const change = data.usd_24h_change;
  const isUp = Number(change) >= 0;

  els.compactSymbol.textContent = token.symbol;
  els.compactName.textContent = token.name;
  els.compactPrice.textContent = formatUsd(data.usd);
  els.compactChange.textContent = Number.isFinite(change) ? `${isUp ? '+' : ''}${change.toFixed(2)}%` : '...';
  els.compactChange.className = isUp ? 'up' : 'down';
}

function renderPrices() {
  els.priceList.innerHTML = '';

  settings.tokens.forEach((token) => {
    const data = prices[token.id] || {};
    const change = data.usd_24h_change;
    const isUp = Number(change) >= 0;
    const card = document.createElement('article');
    card.className = 'price-card';
    card.innerHTML = `
      <div>
        <strong>${token.symbol}</strong>
        <span>${token.name}</span>
      </div>
      <div class="price-meta">
        <b>${formatUsd(data.usd)}</b>
        <small class="${isUp ? 'up' : 'down'}">${Number.isFinite(change) ? `${isUp ? '+' : ''}${change.toFixed(2)}%` : '...'}</small>
      </div>
      <button class="remove-token" title="移除">×</button>
    `;
    card.querySelector('.remove-token').addEventListener('click', async () => {
      if (settings.tokens.length === 1) return;
      settings.tokens = settings.tokens.filter((item) => item.id !== token.id);
      settings.alerts = settings.alerts.filter((alert) => alert.tokenId !== token.id);
      compactIndex = 0;
      await persistAndRender();
      await refreshPrices();
    });
    els.priceList.appendChild(card);
  });
}

function renderAlerts() {
  els.alertToken.innerHTML = tokenOptions();
  els.alerts.innerHTML = settings.alerts.length ? '' : '<div class="muted">还没有提醒。</div>';

  settings.alerts.forEach((alert) => {
    const token = settings.tokens.find((item) => item.id === alert.tokenId);
    const row = document.createElement('div');
    row.className = 'alert-row';
    row.innerHTML = `
      <span>${token?.symbol || alert.tokenId} ${alert.direction === 'above' ? '高于' : '低于'} ${formatUsd(alert.value)}</span>
      <button title="删除">×</button>
    `;
    row.querySelector('button').addEventListener('click', async () => {
      settings.alerts = settings.alerts.filter((item) => item.id !== alert.id);
      firedAlerts.delete(alert.id);
      await persistAndRender();
    });
    els.alerts.appendChild(row);
  });
}

function renderSoundControls() {
  els.soundPreset.value = settings.sound.preset;
  els.soundDuration.value = settings.sound.durationSeconds;
  const label = settings.sound.type === 'custom' && settings.sound.filePath
    ? `自定义：${settings.sound.filePath.split('/').pop()}`
    : `内置：${SOUND_PRESETS[settings.sound.preset].label}`;
  els.soundInfo.textContent = `${label}，持续 ${settings.sound.durationSeconds} 秒`;
}

function renderMascotControls() {
  els.mascotSelect.value = settings.mascot;
  els.mascotPreview.setAttribute('aria-label', MASCOT_LABELS[settings.mascot]);
  els.runnerMascot.setAttribute('aria-label', MASCOT_LABELS[settings.mascot]);
}

function renderBoardSync() {
  if (!els.boardSyncStatus) return;
  if (!boardSyncState) {
    els.boardSyncStatus.textContent = '正在检测 CIRCUITPY...';
    els.boardSyncStatus.className = 'sync-status';
    return;
  }

  if (boardSyncState.ok) {
    const time = boardSyncState.syncedAt
      ? new Date(boardSyncState.syncedAt).toLocaleTimeString('zh-CN', { hour12: false })
      : '';
    els.boardSyncStatus.textContent = `已同步到板子${time ? ` ${time}` : ''}`;
    els.boardSyncStatus.className = 'sync-status ok';
    return;
  }

  els.boardSyncStatus.textContent = boardSyncState.connected
    ? `同步失败：${boardSyncState.error || '未知错误'}`
    : '未检测到 CIRCUITPY 板子';
  els.boardSyncStatus.className = 'sync-status warn';
}

async function updateBoardSyncStatus() {
  if (!api.getBoardStatus) return;
  boardSyncState = await api.getBoardStatus();
  renderBoardSync();
}

async function syncBoardNow() {
  if (!api.syncBoard) return;
  els.boardSyncStatus.textContent = '同步中...';
  els.boardSyncStatus.className = 'sync-status';
  boardSyncState = await api.syncBoard();
  renderBoardSync();
}

async function persistAndRender() {
  settings = normalizeClientSettings(await api.saveSettings(settings));
  render();
  await updateBoardSyncStatus();
}

async function switchToFullMode() {
  if (settings.mode === 'full') return;
  settings.mode = 'full';
  await persistAndRender();
}

function switchTab(name) {
  els.tabs.forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.tab === name);
  });
  els.tabPanels.forEach((panel) => {
    panel.classList.toggle('active', panel.dataset.panel === name);
  });
}

function openSettings() {
  els.settingsOverlay.classList.add('open');
  els.settingsOverlay.setAttribute('aria-hidden', 'false');
  updateBoardSyncStatus();
}

function closeSettings() {
  els.settingsOverlay.classList.remove('open');
  els.settingsOverlay.setAttribute('aria-hidden', 'true');
}

function startCompactRotation() {
  clearInterval(compactRotateTimer);
  compactRotateTimer = setInterval(() => {
    if (!settings || settings.mode !== 'compact' || settings.tokens.length < 2) return;
    compactIndex = (compactIndex + 1) % settings.tokens.length;
    renderCompactBar();
  }, 5000);
}

async function refreshPrices() {
  clearTimeout(timer);
  els.status.textContent = '正在刷新...';
  try {
    const result = await api.fetchPrices(settings.tokens.map((token) => token.id));
    prices = result.ok === false ? {} : (result.prices || result);
    const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    els.status.textContent = result.ok === false
      ? `无真实行情 ${time}，请检查网络或代理`
      : `已更新 ${time}，来源：${result.source || 'live'}`;
    render();
    checkAlerts();
  } catch (error) {
    els.status.textContent = `行情获取失败：${friendlyError(error)}`;
  } finally {
    timer = setTimeout(refreshPrices, Math.max(5, settings.refreshSeconds) * 1000);
  }
}

function checkAlerts() {
  settings.alerts.forEach((alert) => {
    const price = prices[alert.tokenId]?.usd;
    if (typeof price !== 'number') return;

    const hit = alert.direction === 'above' ? price >= alert.value : price <= alert.value;
    if (!hit || firedAlerts.has(alert.id)) return;

    firedAlerts.add(alert.id);
    playAlertSound();
    showMascot();
    els.status.textContent = `提醒触发：${alert.tokenSymbol} ${formatUsd(price)}`;
  });
}

function stopAlertSound() {
  if (!activeAudio) return;
  activeAudio.stop();
  activeAudio = null;
}

function playAlertSound() {
  stopAlertSound();
  const durationMs = settings.sound.durationSeconds * 1000;

  if (settings.sound.type === 'custom' && settings.sound.filePath) {
    const audio = new Audio(`file://${settings.sound.filePath}`);
    audio.loop = true;
    audio.play().catch(() => playPresetSound(durationMs));
    const timeout = setTimeout(() => stopAlertSound(), durationMs);
    activeAudio = {
      stop() {
        clearTimeout(timeout);
        audio.pause();
        audio.currentTime = 0;
      }
    };
    return;
  }

  playPresetSound(durationMs);
}

function playPresetSound(durationMs) {
  const audioContext = new AudioContext();
  const preset = SOUND_PRESETS[settings.sound.preset] || SOUND_PRESETS.bell;
  const timers = [];
  let stopped = false;

  function playNote(frequency, delay) {
    const timer = setTimeout(() => {
      if (stopped) return;
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = preset.wave;
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.001, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.22, audioContext.currentTime + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.22);
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start();
      oscillator.stop(audioContext.currentTime + 0.24);
    }, delay);
    timers.push(timer);
  }

  for (let elapsed = 0; elapsed < durationMs; elapsed += preset.notes.length * preset.gap * 1000 + 260) {
    preset.notes.forEach((note, index) => playNote(note, elapsed + index * preset.gap * 1000));
  }

  const timeout = setTimeout(() => stopAlertSound(), durationMs);
  activeAudio = {
    stop() {
      stopped = true;
      clearTimeout(timeout);
      timers.forEach(clearTimeout);
      audioContext.close().catch(() => {});
    }
  };
}

function showMascot() {
  els.mascotRunner.classList.remove('run');
  void els.mascotRunner.offsetWidth;
  els.mascotRunner.classList.add('run');
}

async function searchCoins() {
  const query = els.coinSearch.value.trim();
  if (!query) return;

  els.searchResults.innerHTML = '<div class="muted">搜索中...</div>';
  try {
    const results = await api.searchCoins(query);
    els.searchResults.innerHTML = results.length ? '' : '<div class="muted">没有找到代币。</div>';
    results.forEach((coin) => {
      const exists = settings.tokens.some((token) => token.id === coin.id);
      const button = document.createElement('button');
      button.className = 'result';
      button.disabled = exists;
      button.innerHTML = `
        <span>${coin.symbol}</span>
        <small>${coin.name}</small>
      `;
      button.addEventListener('click', async () => {
        settings.tokens.push({ id: coin.id, symbol: coin.symbol, name: coin.name });
        els.coinSearch.value = '';
        els.searchResults.innerHTML = '';
        await persistAndRender();
        await refreshPrices();
      });
      els.searchResults.appendChild(button);
    });
  } catch (error) {
    els.searchResults.innerHTML = `<div class="muted">搜索失败：${friendlyError(error)}</div>`;
  }
}

els.refreshBtn.addEventListener('click', refreshPrices);
els.settingsBtn.addEventListener('click', openSettings);
els.closeSettingsBtn.addEventListener('click', closeSettings);
els.settingsOverlay.addEventListener('click', (event) => {
  if (event.target === els.settingsOverlay) closeSettings();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && els.settingsOverlay.classList.contains('open')) {
    closeSettings();
  }
});
els.closeBtn.addEventListener('click', api.close);
els.minBtn.addEventListener('click', api.minimize);
els.searchBtn.addEventListener('click', searchCoins);
els.syncBoardBtn.addEventListener('click', syncBoardNow);
els.coinSearch.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') searchCoins();
});

els.modeSelect.addEventListener('change', async () => {
  settings.mode = els.modeSelect.value;
  await persistAndRender();
  if (settings.mode === 'compact') closeSettings();
});

els.tabs.forEach((tab) => {
  tab.addEventListener('click', () => switchTab(tab.dataset.tab));
});

els.expandBtn.addEventListener('click', switchToFullMode);
els.compactBar.addEventListener('dblclick', switchToFullMode);
els.compactBar.addEventListener('contextmenu', async (event) => {
  event.preventDefault();
  await switchToFullMode();
});

els.addAlertBtn.addEventListener('click', async () => {
  const value = Number(els.alertValue.value);
  const token = settings.tokens.find((item) => item.id === els.alertToken.value);
  if (!token || !Number.isFinite(value) || value <= 0) return;

  settings.alerts.push({
    id: `${token.id}-${Date.now()}`,
    tokenId: token.id,
    tokenSymbol: token.symbol,
    direction: els.alertDirection.value,
    value
  });
  els.alertValue.value = '';
  await persistAndRender();
});

els.soundPreset.addEventListener('change', async () => {
  settings.sound.type = 'preset';
  settings.sound.preset = els.soundPreset.value;
  await persistAndRender();
});

els.soundDuration.addEventListener('change', async () => {
  settings.sound.durationSeconds = clampDuration(els.soundDuration.value);
  await persistAndRender();
});

els.testSoundBtn.addEventListener('click', () => {
  settings.sound.durationSeconds = clampDuration(els.soundDuration.value);
  playAlertSound();
  showMascot();
});

els.stopSoundBtn.addEventListener('click', stopAlertSound);

els.presetSoundBtn.addEventListener('click', async () => {
  settings.sound.type = 'preset';
  await persistAndRender();
});

els.customSoundBtn.addEventListener('click', async () => {
  const filePath = await api.chooseSound();
  if (!filePath) return;
  settings.sound = {
    ...settings.sound,
    type: 'custom',
    filePath
  };
  await persistAndRender();
});

els.mascotSelect.addEventListener('change', async () => {
  settings.mascot = els.mascotSelect.value;
  await persistAndRender();
});

async function boot() {
  settings = normalizeClientSettings(await api.getSettings());
  await updateBoardSyncStatus();
  startCompactRotation();
  render();
  await refreshPrices();
}

boot();
