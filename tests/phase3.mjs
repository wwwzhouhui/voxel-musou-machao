// 第三阶段验收：剧情过场 / 坐骑 / 自适应画质
// 用法：先起服务器 cd ~/workspace/voxel-musou-machao && python3 -m http.server 8321
//       再把本文件拷到 /tmp/pwtest 下跑：node /tmp/pwtest/phase3.mjs
//       （playwright-core 在 /tmp/pwtest/node_modules，不在项目内）
// 说明：SwiftShader 下游戏内时间约比真实时间慢 4 倍，过场用真实时间推进，不受此影响。
import { chromium } from 'playwright-core';

const BASE = process.argv[2] || 'http://127.0.0.1:8321/index.html';
const exe = '/home/hatch/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome';
const errors = [];
const failedReqs = [];
const results = [];
const check = (name, cond, extra = '') => {
  results.push({ name, ok: !!cond, extra });
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name} ${extra}`);
};
async function waitFor(page, fn, timeoutMs, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await page.evaluate(fn)) return true;
    await page.waitForTimeout(500);
  }
  console.log(`  (timeout waiting: ${label})`);
  return false;
}
async function skipCutscene(page) {
  await page.evaluate(() => window.__machao.skipCutscene());
}

const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('requestfailed', (r) => failedReqs.push(r.url() + ' :: ' + (r.failure()?.errorText || '')));
page.on('response', (r) => { if (r.status() >= 400) failedReqs.push(r.url() + ' :: HTTP ' + r.status()); });

// ---------- 1. 潼关开场过场 ----------
await page.goto(`${BASE}?char=machao&mode=tongguan&enemies=120`, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(2000);
check('标题有 4 个画质按钮', (await page.locator('#quality-row .btn').count()) === 4);
await page.click('#quality-low');
check('点低画质切手动低档', await page.evaluate(() => window.__machao.qualityMode === 'low' && window.__machao.adaptive.tier === 3));
await page.click('#quality-auto');
check('点自动切回自动模式', await page.evaluate(() => window.__machao.qualityMode === 'auto'));
await page.click('#start-btn');
await page.waitForTimeout(1200);
check('开场进入过场态', await page.evaluate(() => window.__machao.state === 'cutscene'));
check('过场遮罩可见', await page.locator('#cutscene:not(.hidden)').count() === 1);
check('过场有台词', await page.evaluate(() => document.getElementById('cutscene-text').textContent.length > 5),
  await page.evaluate(() => document.getElementById('cutscene-text').textContent.slice(0, 20)));
check('过场期间计时冻结', await page.evaluate(() => window.__machao.time === 0));
// 任意键跳过
await page.keyboard.press('KeyJ');
await page.waitForTimeout(500);
check('按 J 跳过开场回战斗', await page.evaluate(() => window.__machao.state === 'playing'));
check('过场遮罩已隐藏', await page.locator('#cutscene.hidden').count() === 1);

// ---------- 2. ?skipintro=1 直接跳开场 ----------
await page.goto(`${BASE}?char=machao&mode=tongguan&enemies=120&skipintro=1`, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(2000);
await page.click('#start-btn');
await page.waitForTimeout(800);
check('skipintro=1 直接开战无过场', await page.evaluate(() => window.__machao.state === 'playing'));

// ---------- 3. 坐骑 ----------
check('马匹已生成在出生点附近', await page.evaluate(() => {
  const g = window.__machao;
  return !!g.horse && Math.hypot(g.horse.group.position.x - g.player.x, g.horse.group.position.z - g.player.z) < 6;
}));
await page.evaluate(() => {
  const g = window.__machao;
  g.player.x = g.horse.group.position.x;
  g.player.z = g.horse.group.position.z;
});
await page.keyboard.press('KeyF');
await page.waitForTimeout(300);
check('靠近按 F 上马', await page.evaluate(() => window.__machao.mount.mounted === true));
check('骑乘移速 ×1.6', await page.evaluate(() => Math.abs(window.__machao.mount.speedMul() - 1.6) < 1e-9));
// 马跟玩家走
await page.evaluate(() => { const g = window.__machao; g.player.x += 5; });
await page.waitForTimeout(600);
check('马匹跟随玩家', await page.evaluate(() => {
  const g = window.__machao;
  return Math.abs(g.horse.group.position.x - g.player.x) < 0.6;
}));
// 冲锋态（原子 evaluate 内完成，避免下一帧 _step 因未移动清零）
check('持续移动 2 秒可进冲锋', await page.evaluate(() => {
  const g = window.__machao;
  g.mount.moveTime = 1.9;
  g.mount.update(0.2, true);
  return g.mount.chargeReady === true;
}));
// 骑乘空格冲刺
await page.keyboard.press('Space');
await page.waitForTimeout(200);
check('骑乘空格触发冲刺', await page.evaluate(() => window.__machao.mount.dashing === true));
await page.keyboard.press('KeyF');
await page.waitForTimeout(300);
check('再按 F 下马', await page.evaluate(() => window.__machao.mount.mounted === false));
check('下马后马留在原地', await page.evaluate(() => {
  const g = window.__machao;
  return Math.hypot(g.horse.group.position.x - g.player.x, g.horse.group.position.z - g.player.z) < 1;
}));

// ---------- 4. Boss 登场过场 ----------
await page.evaluate(() => { window.__machao.kills = 59; });
await page.evaluate(() => {
  const g = window.__machao;
  const e = g.crowd.nearestEnemy(g.player.x, g.player.z, 200);
  if (e) { e.hp = 1; g.player.x = e.x; g.player.z = e.z + 2; g.player.facing = Math.atan2(e.x - g.player.x, e.z - g.player.z); }
});
await page.keyboard.press('KeyJ');
const bossCut = await waitFor(page, () => window.__machao.bossSpawned === true && window.__machao.state === 'cutscene', 15000, 'boss cutscene');
check('60 斩触发 Boss 登场过场', bossCut);
check('Boss 过场遮罩可见', await page.locator('#cutscene:not(.hidden)').count() === 1);
check('Boss 血条已亮起', await page.locator('#boss-bar-wrap:not(.hidden)').count() === 1);
await skipCutscene(page);
await page.waitForTimeout(400);
check('跳过 Boss 过场回战斗', await page.evaluate(() => window.__machao.state === 'playing' && window.__machao.bossSpawned === true));

// ---------- 5. 胜利结尾过场 ----------
await page.evaluate(() => {
  const g = window.__machao;
  g.boss.hp = 1;
  g.player.x = g.boss.x; g.player.z = g.boss.z + 2;
  g.player.facing = Math.atan2(g.boss.x - g.player.x, g.boss.z - g.player.z);
});
await page.keyboard.press('KeyJ');
const vicCut = await waitFor(page, () => window.__machao.state === 'cutscene' || window.__machao.state === 'over', 15000, 'victory cutscene');
check('击败 Boss 进入胜利过场', vicCut && await page.evaluate(() => window.__machao.state === 'cutscene'),
  await page.evaluate(() => `state=${window.__machao.state}`));
check('胜利过场有结尾台词', await page.evaluate(() => document.getElementById('cutscene-text').textContent.length > 3));
await skipCutscene(page);
await page.waitForTimeout(500);
check('跳过胜利过场进结算', await page.evaluate(() => window.__machao.state === 'over'));
check('结算屏可见且为胜利', await page.evaluate(() => {
  const t = document.getElementById('result-title').textContent;
  return !document.getElementById('result-screen').classList.contains('hidden') && t === '胜 利';
}));

// ---------- 6. 自适应画质：自动降档 ----------
await page.goto(`${BASE}?char=machao&mode=endless&quality=auto&enemies=120`, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(2000);
await page.click('#start-btn');
await page.waitForTimeout(1000);
await skipCutscene(page); // 演武无开场，无操作
// 确定性接线检查：直接喂 5fps 给自适应逻辑，3 秒应降一档（不依赖无头帧率）
check('自适应接线：喂 5fps 能降档', await page.evaluate(() => {
  const g = window.__machao; const before = g.adaptive.tier;
  for (let i = 0; i < 40; i++) g.adaptive.update(5, 0.1);
  const moved = g.adaptive.tier > before;
  g.adaptive.tier = before; g._applyQualityTier(before, false); // 复位，不影响后续真实帧率检查
  return moved;
}));
// 真实帧率检查：轮询最多 30 秒等降档（SwiftShader 约 2-4fps，3 秒一档；
// 旧版用 rAF 时间戳指数平滑会虚报上百 fps 而永不降档，已改为真实时间 1 秒窗口 + 开战重计）
const downgraded = await waitFor(page, () => window.__machao.adaptive.tier >= 1, 30000, 'auto downgrade');
check('自动模式低帧降档', downgraded,
  await page.evaluate(() => `tier=${window.__machao.adaptive.tier} fps=${Math.round(window.__machao._fps || 0)}`));
check('降档后敌数上限下调', await page.evaluate(() => window.__machao._maxAliveCap <= 40));
check('画质指示写过档位', await page.evaluate(() => document.getElementById('quality-indicator').textContent.includes('画质')));

// ---------- 7. 自适应画质：手动高档不降 ----------
await page.goto(`${BASE}?char=machao&mode=endless&quality=high&enemies=120`, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(2000);
await page.click('#start-btn');
await page.waitForTimeout(6000);
check('手动高档低帧也不降档', await page.evaluate(() => window.__machao.adaptive.tier === 0 && window.__machao.qualityMode === 'high'));

// ---------- 8. 败北台词过场 ----------
await page.goto(`${BASE}?char=machao&mode=tongguan&enemies=120&skipintro=1`, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(2000);
await page.click('#start-btn');
await page.waitForTimeout(1000);
await page.evaluate(() => {
  const g = window.__machao;
  for (const s of g.crowd.soldiers) if (s.alive && s.faction === 'ma') g.crowd.kill(s, true);
  g._allyRespawnT = 9999;
  g.player.hp = 3;
  const e = g.crowd.nearestEnemy(g.player.x, g.player.z, 200);
  if (e) { e.x = g.player.x + 1; e.z = g.player.z; e.state = 'windup'; e.stateT = 0.01; e.atkCd = 0; }
});
let sawDefeatCut = false;
let over = false;
for (let i = 0; i < 40; i++) {
  await page.waitForTimeout(1000);
  const st = await page.evaluate(() => window.__machao.state);
  if (st === 'cutscene') sawDefeatCut = true;
  if (st === 'over') { over = true; break; }
}
check('败北先播台词过场再结算', sawDefeatCut && over);
check('败北结算标题正确', await page.evaluate(() => document.getElementById('result-title').textContent === '败 北'));

console.log('\n--- console errors:', errors.length ? errors : 'none');
console.log('--- failed requests:', failedReqs.length ? failedReqs : 'none');
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
await browser.close();
process.exit(failed || errors.length || failedReqs.length ? 1 : 0);
