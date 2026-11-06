// ============================================================
// voxel-musou-machao · src/main.js
// 启动器：解析 URL 参数、渲染选角/章节界面、接线按钮
// ============================================================
import { Game } from './game.js';
import { CHARACTERS, CHARACTER_ORDER, CHAPTERS, MAPS, MAP_ORDER, parseUrlParams } from './config.js';

const params = parseUrlParams();
let selectedChar = params.char;
let selectedMode = params.mode;
let selectedMap = params.map;

const game = new Game({
  char: selectedChar,
  mode: selectedMode,
  map: selectedMap,
  post: params.post,
  enemies: params.enemies,
  quality: params.quality,
  qualityMode: params.qualityMode,
  skipIntro: params.skipIntro,
  dof: params.dof,
  msaa: params.msaa,
});

function el(id) { return document.getElementById(id); }

function renderCharCards() {
  const wrap = el('char-cards');
  wrap.innerHTML = '';
  for (const id of CHARACTER_ORDER) {
    const c = CHARACTERS[id];
    const card = document.createElement('button');
    card.className = 'char-card' + (id === selectedChar ? ' selected' : '');
    card.innerHTML = `
      <div class="char-swatch" style="background:linear-gradient(135deg,#${c.colors.armor.toString(16).padStart(6, '0')},#${c.colors.cloth.toString(16).padStart(6, '0')})">
        <span class="char-glyph">${c.name[0]}</span>
      </div>
      <div class="char-name">${c.name} <span class="char-title">${c.title}</span></div>
      <div class="char-weapon">${c.weaponName}</div>
      <div class="char-musou">无双：${c.musouName}</div>
      <div class="char-armor">🛡 霸体：${c.superArmor.label}（减伤 ${Math.round((1 - c.superArmor.dmgMul) * 100)}%）</div>
      <div class="char-desc">${c.desc}</div>
      <div class="char-stats">体力 ${c.stats.hp} · 攻击 ×${c.stats.atk} · 速度 ${c.stats.speed}</div>
      <div class="char-best" id="best-char-${id}"></div>`;
    card.onclick = () => {
      selectedChar = id;
      game.sfx.ensure(); game.sfx.click();
      renderCharCards();
      updateBestLabels();
    };
    wrap.appendChild(card);
  }
}

function renderModeCards() {
  const wrap = el('mode-cards');
  wrap.innerHTML = '';
  for (const [id, ch] of Object.entries(CHAPTERS)) {
    const card = document.createElement('button');
    card.className = 'mode-card' + (id === selectedMode ? ' selected' : '');
    card.innerHTML = `
      <div class="mode-name">${ch.name}</div>
      <div class="mode-year">${ch.year}</div>
      <div class="mode-desc">${ch.desc}</div>
      <div class="mode-best" id="best-${id}">暂无纪录</div>`;
    card.onclick = () => {
      selectedMode = id;
      game.sfx.ensure(); game.sfx.click();
      renderModeCards();
    };
    wrap.appendChild(card);
  }
}

function renderMapCards() {
  const wrap = el('map-cards');
  if (!wrap) return;
  wrap.innerHTML = '';
  for (const id of MAP_ORDER) {
    const m = MAPS[id];
    const card = document.createElement('button');
    card.className = 'mode-card' + (id === selectedMap ? ' selected' : '');
    card.innerHTML = `
      <div class="mode-name">${m.name}</div>
      <div class="mode-year">${m.label}</div>
      <div class="mode-desc">${m.desc}</div>
      <div class="mode-best">${selectedMode === 'tongguan' && id === 'yangping' ? '潼关之战固定用潼关图；自由演武 / 试炼可选此图' : ''}</div>`;
    card.onclick = () => {
      selectedMap = id;
      game.sfx.ensure(); game.sfx.click();
      renderMapCards();
      game.previewMap(id);
    };
    wrap.appendChild(card);
  }
}

function updateBestLabels() {
  for (const mode of Object.keys(CHAPTERS)) {
    const rec = JSON.parse(localStorage.getItem(`machao_best_${mode}_${selectedChar}`) || 'null');
    const mEl = document.getElementById(`best-${mode}`);
    if (mEl) mEl.textContent = rec ? `最佳：${rec.kills} 斩 · ${rec.grade}级` : '暂无纪录';
  }
}

function startGame() {
  el('title-screen').classList.add('hidden');
  el('result-screen').classList.add('hidden');
  el('pause-screen').classList.add('hidden');
  const url = new URL(location.href);
  url.searchParams.set('char', selectedChar);
  url.searchParams.set('mode', selectedMode);
  url.searchParams.set('map', selectedMap);
  history.replaceState(null, '', url);
  game.start(selectedMode, selectedChar, selectedMap);
}

window.addEventListener('DOMContentLoaded', () => {
  game.init(el('game-container'));
  renderCharCards();
  renderModeCards();
  renderMapCards();
  updateBestLabels();
  // 后期开关按钮（标题界面；战斗中可用 B / P 键）
  const bloomBtn = el('bloom-btn');
  const pixelBtn = el('pixel-btn');
  const syncPostBtns = () => {
    if (bloomBtn) bloomBtn.textContent = game.post.bloom ? '✨ 泛光开' : '✨ 泛光关';
    if (pixelBtn) pixelBtn.textContent = game.post.pixel ? '▦ 像素风开' : '▦ 像素风关';
  };
  syncPostBtns();
  if (bloomBtn) bloomBtn.onclick = () => { game.sfx.ensure(); game._postUserOverride = true; game.post.setBloom(!game.post.bloom); syncPostBtns(); };
  if (pixelBtn) pixelBtn.onclick = () => { game.sfx.ensure(); game._postUserOverride = true; game.post.setPixel(!game.post.pixel); syncPostBtns(); };
  const dofBtn = el('dof-btn');
  const syncDofBtn = () => { if (dofBtn) dofBtn.textContent = game.post.dof ? '◉ 景深开' : '◉ 景深关'; };
  syncDofBtn();
  if (dofBtn) dofBtn.onclick = () => { game.sfx.ensure(); game._dofOverride = !game.post.dof; game.post.setDof(game._dofOverride); syncDofBtn(); };

  // 画质模式按钮：自动 / 高 / 中 / 低（URL ?quality= 优先于本地记忆）
  const syncQualityBtns = () => {
    for (const m of ['auto', 'high', 'medium', 'low']) {
      const b = el(`quality-${m}`);
      if (b) b.classList.toggle('selected', game.qualityMode === m);
    }
  };
  if (!new URLSearchParams(location.search).has('quality')) {
    try {
      const stored = localStorage.getItem('machao_quality_mode');
      if (stored && ['auto', 'high', 'medium', 'low'].includes(stored)) game.setQualityMode(stored);
    } catch (e) { /* 忽略 */ }
  }
  for (const m of ['auto', 'high', 'medium', 'low']) {
    const b = el(`quality-${m}`);
    if (b) b.onclick = () => { game.sfx.ensure(); game.sfx.click(); game.setQualityMode(m); syncQualityBtns(); };
  }
  syncQualityBtns();

  // 过场遮罩点击跳过
  const cutEl = el('cutscene');
  if (cutEl) cutEl.addEventListener('click', () => game.skipCutscene());

  el('start-btn').onclick = startGame;
  el('help-btn').onclick = () => { game.sfx.ensure(); el('help-screen').classList.remove('hidden'); };
  el('help-close').onclick = () => el('help-screen').classList.add('hidden');
  el('mute-btn').onclick = () => {
    game.sfx.ensure();
    game.sfx.setMuted(!game.sfx.muted);
    el('mute-btn').textContent = game.sfx.muted ? '🔇 已静音' : '🔊 音效开';
  };
  el('mute-btn').textContent = game.sfx.muted ? '🔇 已静音' : '🔊 音效开';
  el('resume-btn').onclick = () => game.resume();
  el('restart-btn').onclick = () => { el('pause-screen').classList.add('hidden'); startGame(); };
  el('quit-btn').onclick = () => game.quitToMenu();
  el('again-btn').onclick = () => { el('result-screen').classList.add('hidden'); startGame(); };
  el('result-menu-btn').onclick = () => game.quitToMenu();
  el('help-close-2').onclick = () => {
    el('help-screen').classList.add('hidden');
    if (game.state === 'paused') game.resume();
  };

  // 低配检测：弱设备提示降质
  const lowMem = navigator.deviceMemory && navigator.deviceMemory <= 4;
  const lowCores = navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 2;
  if ((lowMem || lowCores) && params.quality !== 'low') {
    const tip = el('perf-tip');
    tip.classList.remove('hidden');
    tip.innerHTML = '检测到设备配置较低，建议在地址栏加 <code>?quality=low</code> 或减少敌军 <code>?enemies=120</code> 以获得流畅体验。';
  }
  if (params.quality === 'low') el('perf-tip').classList.remove('hidden');

  // 标题界面也渲染一帧背景（走后期管线，与战斗一致）
  game.renderFrame();
});
