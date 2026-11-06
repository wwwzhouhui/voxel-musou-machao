// 第四阶段验收：玩家远程攻击 / MSAA / DoF
// 用法：先起服务器 cd ~/workspace/voxel-musou-machao && python3 -m http.server 8321
//       再把本文件拷到 /tmp/pwtest 下跑：node /tmp/pwtest/phase4.mjs
//       （playwright-core 在 /tmp/pwtest/node_modules，不在项目内）
// 说明：SwiftShader 下游戏内时间约比真实时间慢 4 倍，等待时间已按此放宽。
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
async function meanLuma(page) {
  return page.evaluate(() => {
    const g = window.__machao;
    g._render();
    const src = g.renderer.domElement;
    const c = document.createElement('canvas');
    c.width = 160; c.height = 100;
    const ctx = c.getContext('2d');
    ctx.drawImage(src, 0, 0, 160, 100);
    const d = ctx.getImageData(0, 0, 160, 100).data;
    let s = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) { s += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; n++; }
    return s / n;
  });
}
// 把玩家摆到最近敌兵面前 3 米并朝向它，敌兵血量置 1（远程一发即死，便于断言击杀）
async function aimAtWeakEnemy(page) {
  await page.evaluate(() => {
    const g = window.__machao;
    const e = g.crowd.nearestEnemy(g.player.x, g.player.z, 200);
    if (!e) return;
    e.hp = 1;
    g.player.x = e.x; g.player.z = e.z + 3;
    g.player.facing = Math.atan2(e.x - g.player.x, e.z - g.player.z);
  });
}

const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('requestfailed', (r) => failedReqs.push(r.url() + ' :: ' + (r.failure()?.errorText || '')));
page.on('response', (r) => { if (r.status() >= 400) failedReqs.push(r.url() + ' :: HTTP ' + r.status()); });

// ---------- 1. 周瑜火矢：Q 发射、命中、灼烧 ----------
await page.goto(`${BASE}?char=zhouyu&mode=endless&enemies=120&skipintro=1`, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(2000);
await page.click('#start-btn');
await page.waitForTimeout(1000);
check('周瑜远程 HUD 显示火矢', await page.evaluate(() => document.getElementById('ranged-line').textContent.includes('火矢')));
await waitFor(page, () => window.__machao.crowd.aliveCount('cao') > 0, 15000, 'enemies spawn');
await aimAtWeakEnemy(page);
const kills0 = await page.evaluate(() => window.__machao.kills);
await page.keyboard.press('KeyQ');
check('按 Q 发射火矢', await page.evaluate(() => window.__machao.shotPool.fired >= 1));
const burned = await waitFor(page, () => window.__machao.kills > 0 || window.__machao.burnZones.length > 0, 15000, 'fire hit or burn');
check('火矢命中或留下灼烧区', burned,
  await page.evaluate(() => `kills=${window.__machao.kills} burn=${window.__machao.burnZones.length}`));
check('火矢命中攒无双', await page.evaluate(() => window.__machao.player.musou > 0));

// ---------- 2. 冷却：连续按 Q 第二发不发射 ----------
await page.evaluate(() => { window.__machao.ranged.cd = 0; });
await aimAtWeakEnemy(page);
const firedBefore = await page.evaluate(() => window.__machao.shotPool.fired);
await page.keyboard.press('KeyQ');
await page.waitForTimeout(200);
await page.keyboard.press('KeyQ');
await page.waitForTimeout(300);
const firedAfter = await page.evaluate(() => window.__machao.shotPool.fired);
check('冷却中按 Q 不发射', firedAfter === firedBefore + 1, `fired ${firedBefore} -> ${firedAfter}`);

// ---------- 3. 孙策飞矛：一次 Q 射 3 发 ----------
await page.goto(`${BASE}?char=sunce&mode=endless&enemies=120&skipintro=1`, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(2000);
await page.click('#start-btn');
await page.waitForTimeout(1000);
await waitFor(page, () => window.__machao.crowd.aliveCount('cao') > 0, 15000, 'enemies spawn');
await aimAtWeakEnemy(page);
const f0 = await page.evaluate(() => window.__machao.shotPool.fired);
await page.keyboard.press('KeyQ');
await page.waitForTimeout(300);
check('孙策一次 Q 射出 3 发飞矛', await page.evaluate(() => window.__machao.shotPool.fired) === f0 + 3,
  await page.evaluate(() => `fired=${window.__machao.shotPool.fired}`));

// ---------- 4. 马超投枪打 Boss + 典韦飞戟 ----------
await page.goto(`${BASE}?char=machao&mode=tongguan&enemies=120&skipintro=1`, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(2000);
await page.click('#start-btn');
await page.waitForTimeout(1000);
await page.evaluate(() => { window.__machao.kills = 59; });
await page.evaluate(() => {
  const g = window.__machao;
  const e = g.crowd.nearestEnemy(g.player.x, g.player.z, 200);
  if (e) { e.hp = 1; g.player.x = e.x; g.player.z = e.z + 2; g.player.facing = Math.atan2(e.x - g.player.x, e.z - g.player.z); }
});
await page.keyboard.press('KeyJ');
await waitFor(page, () => window.__machao.bossSpawned === true, 15000, 'boss spawn');
await page.evaluate(() => window.__machao.skipCutscene());
// 等回到战斗且连招空闲再射（SwiftShader 下游戏时间约慢 4 倍，
// 刚杀完第 60 名敌兵的连招 busy 仍在，立即按 Q 会被 _pressRanged 挡掉）
await waitFor(page, () => window.__machao.state === 'playing' && !window.__machao.player.combo.busy, 15000, 'back to playing, combo free');
await page.evaluate(() => {
  const g = window.__machao;
  // 把周围小兵挪开，避免投枪被挡（小兵会挡弹道是符合设计的身体阻挡）
  for (const s of g.crowd.soldiers) { if (s.alive && s.faction === 'cao') { s.x += 40; s.z += 40; } }
  g.player.x = g.boss.x; g.player.z = g.boss.z + 4;
  g.player.facing = Math.atan2(g.boss.x - g.player.x, g.boss.z - g.player.z);
});
const bossHp0 = await page.evaluate(() => window.__machao.boss.hp);
const fBoss0 = await page.evaluate(() => window.__machao.shotPool.fired);
await page.keyboard.press('KeyQ');
await page.waitForTimeout(300);
check('Boss 战中按 Q 确实发射', await page.evaluate(() => window.__machao.shotPool.fired) > fBoss0);
const bossHit = await waitFor(page, () => window.__machao.boss.hp < 1400, 15000, 'spear hits boss');
check('马超投枪命中 Boss 掉血', bossHit, `bossHp ${bossHp0} -> ${await page.evaluate(() => window.__machao.boss.hp)}`);

// ---------- 5. 骑射：上马后按 Q 也能发射 ----------
await page.evaluate(() => {
  const g = window.__machao;
  g.player.x = g.horse.group.position.x;
  g.player.z = g.horse.group.position.z;
});
await page.keyboard.press('KeyF');
await page.waitForTimeout(300);
check('骑射前已上马', await page.evaluate(() => window.__machao.mount.mounted === true));
await page.evaluate(() => { window.__machao.ranged.cd = 0; });
const f1 = await page.evaluate(() => window.__machao.shotPool.fired);
await page.keyboard.press('KeyQ');
await page.waitForTimeout(300);
check('骑乘时按 Q 也能发射', await page.evaluate(() => window.__machao.shotPool.fired) > f1);

// ---------- 6. MSAA / DoF 档位 ----------
await page.goto(`${BASE}?char=machao&mode=endless&enemies=120&quality=high&skipintro=1`, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(2000);
check('高档 MSAA 4x', await page.evaluate(() => window.__machao.post.msaa === 4 && window.__machao.post.rtScene.samples === 4),
  await page.evaluate(() => `msaa=${window.__machao.post.msaa} samples=${window.__machao.post.rtScene.samples}`));
check('高档 DoF 开', await page.evaluate(() => window.__machao.post.dof === true));
check('DoF 按钮存在', (await page.locator('#dof-btn').count()) === 1);
const lumaDof = await meanLuma(page);
check('DoF 开启画面不黑', lumaDof > 5, `meanLuma=${lumaDof.toFixed(1)}`);
await page.keyboard.press('KeyO');
await page.waitForTimeout(300);
check('按 O 关闭 DoF', await page.evaluate(() => window.__machao.post.dof === false));
const lumaNoDof = await meanLuma(page);
check('DoF 关闭画面仍正常', lumaNoDof > 5, `meanLuma=${lumaNoDof.toFixed(1)}`);

await page.goto(`${BASE}?char=machao&mode=endless&enemies=120&quality=medium&skipintro=1`, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(2000);
check('中档 MSAA 2x 关 DoF', await page.evaluate(() => window.__machao.post.msaa === 2 && window.__machao.post.dof === false),
  await page.evaluate(() => `msaa=${window.__machao.post.msaa} dof=${window.__machao.post.dof}`));

await page.goto(`${BASE}?char=machao&mode=endless&enemies=120&quality=high&dof=off&skipintro=1`, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(2000);
check('?dof=off 覆盖高档', await page.evaluate(() => window.__machao.post.dof === false));
await page.goto(`${BASE}?char=machao&mode=endless&enemies=120&quality=high&msaa=0&skipintro=1`, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(2000);
check('?msaa=0 覆盖高档', await page.evaluate(() => window.__machao.post.msaa === 0 && window.__machao.post.rtScene.samples === 0));

await browser.close();
console.log(`\n--- console errors: ${errors.length ? errors.join(' | ') : 'none'}`);
console.log(`--- failed requests: ${failedReqs.length ? failedReqs.join(' | ') : 'none'}`);
const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length && errors.length === 0 && failedReqs.length === 0 ? 0 : 1);
