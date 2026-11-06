// 第二阶段验收：新地图阳平关 / Bloom+像素风后期 / 弓手抛射物
// 用法：先起服务器 cd ~/workspace/voxel-musou-machao && python3 -m http.server 8321
//       再跑 node tests/phase2.mjs
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
// 在同一 JS 任务内重渲染并读画布平均亮度（验证后期开/关不黑屏、不严重偏色）
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

const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('requestfailed', (r) => failedReqs.push(r.url() + ' :: ' + (r.failure()?.errorText || '')));
page.on('response', (r) => { if (r.status() >= 400) failedReqs.push(r.url() + ' :: HTTP ' + r.status()); });

// ---------- 1. 阳平关夜战：自由演武 ----------
await page.goto(`${BASE}?char=machao&mode=endless&map=yangping&enemies=120`, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(2500);
check('标题界面有 2 张地图卡', (await page.locator('#map-cards .mode-card').count()) === 2);
check('默认选中阳平关', await page.evaluate(() => document.querySelector('#map-cards .mode-card.selected')?.textContent.includes('阳平关')));
await page.click('#start-btn');
await page.waitForTimeout(1500);
check('阳平关开战 playing', await page.evaluate(() => window.__machao.state === 'playing'));
check('当前地图 yangping', await page.evaluate(() => window.__machao.mapId === 'yangping'));
check('玩家出生在营寨南门 (0,30)', await page.evaluate(() => {
  const g = window.__machao;
  return Math.abs(g.player.x - 0) < 1 && Math.abs(g.player.z - 30) < 1;
}));
check('阳平关夜战氛围', await page.evaluate(() => window.__machao.world.variant.label.includes('阳平关')));
check('阳平关有河流/营寨碰撞体', await page.evaluate(() => window.__machao.world.colliders.length > 20),
  await page.evaluate(() => `colliders=${window.__machao.world.colliders.length}`));
await page.waitForTimeout(8000);
check('阳平关已生成敌军', await page.evaluate(() => window.__machao.crowd.aliveCount('cao') > 0));
check('敌军不在碰撞体内', await page.evaluate(() => {
  const g = window.__machao;
  for (const s of g.crowd.soldiers) {
    if (!s.alive) continue;
    for (const c of g.world.colliders) {
      if (c.rect) {
        if (Math.abs(s.x - c.x) < c.rect.hw && Math.abs(s.z - c.z) < c.rect.hd) return false;
      } else if (Math.hypot(s.x - c.x, s.z - c.z) < c.r - 0.3) return false;
    }
  }
  return true;
}));
await page.screenshot({ path: '/tmp/pwtest/shot_yangping.png' });

// ---------- 2. 弓手：拉弓 → 射箭 → 箭命中玩家 ----------
// 先清掉友军并锁住补员计时：否则站在玩家与弓手之间的友军会替玩家挡箭
// （箭撞友军是符合设计的身体格挡，这里为了单独测“箭打玩家”先排除它）
await page.evaluate(() => {
  const g = window.__machao;
  for (const s of g.crowd.soldiers) if (s.alive && s.faction === 'ma') g.crowd.kill(s, true);
  g._allyRespawnT = 9999;
});
await page.evaluate(() => {
  const g = window.__machao;
  const a = g.crowd.spawn('archer', g.player.x, g.player.z - 15, 'cao');
  if (a) { a.atkCd = 0; a.state = 'chase'; }
});
const sawAim = await waitFor(page, () => {
  const g = window.__machao;
  return g.crowd.soldiers.some((s) => s.alive && s.type === 'archer' && s.aiming);
}, 30000, 'archer aiming');
check('弓手进入拉弓前摇（弓身发光）', sawAim);
const fired = await waitFor(page, () => window.__machao.arrowPool.fired > 0, 30000, 'arrow fired');
check('弓手射出箭矢', fired, await page.evaluate(() => `fired=${window.__machao.arrowPool.fired}`));
check('箭矢在对象池内（≤48）', await page.evaluate(() => window.__machao.arrowPool.arrows.length === 48));

// 箭命中：把玩家血量记下，等一支箭打中（弓手持续射，站着不动必中）
await page.evaluate(() => { window.__machao.player.hp = 60; });
const hpBefore = await page.evaluate(() => window.__machao.player.hp);
const wasHit = await waitFor(page, () => window.__machao.player.hp < 60 || window.__machao.player.dead, 60000, 'arrow hit player');
check('站着不动会被箭射中扣血', wasHit, await page.evaluate(() => `hp=${Math.round(window.__machao.player.hp)}`));

// 闪避躲箭：手动放一支瞄准玩家的箭，在命中前一刻闪避
let dodgeOk = false;
for (let attempt = 0; attempt < 2 && !dodgeOk; attempt++) {
  await page.evaluate(() => {
    const g = window.__machao;
    g.player.hp = 60;
    g.player.combo.dodgeCd = 0;
    g.arrowPool.fire(
      { x: g.player.x, y: 1.2, z: g.player.z - 15 },
      { x: g.player.x, y: 1.2, z: g.player.z },
    );
  });
  await page.waitForTimeout(2200); // 箭飞行约 0.6s 游戏时间 ≈ 2.4s 真实时间，接近命中时闪避
  await page.keyboard.press('ShiftLeft');
  await page.waitForTimeout(5000);
  const hp = await page.evaluate(() => Math.round(window.__machao.player.hp));
  dodgeOk = hp >= 60;
  console.log(`  dodge attempt ${attempt + 1}: hp=${hp}`);
}
check('闪避无敌帧可躲开箭矢', dodgeOk);

// 打断拉弓：弓手瞄准时砍一刀，瞄准应取消（不与全局开火计数比较，
// 场上其他弓手同期开火会污染计数；只断言该弓手自身状态）
const interrupted = await page.evaluate(async () => {
  const g = window.__machao;
  const a = g.crowd.spawn('archer', g.player.x + 2, g.player.z, 'cao');
  if (!a) return false;
  a.state = 'aim'; a.stateT = 0.7; a.aiming = true; a.aimTarget = { kind: 'player' };
  g.crowd.damage(a, 10, 1, 0, 5); // 10 伤不致死（弓手 16 血），只看打断
  await new Promise((r) => setTimeout(r, 300));
  return a.state === 'stagger' && !a.aiming;
});
check('攻击可打断弓手拉弓', interrupted);

// ---------- 3. 后期：Bloom / 像素风 ----------
const lumaBloom = await meanLuma(page);
check('Bloom 开启时画面不黑', lumaBloom > 10, `meanLuma=${lumaBloom.toFixed(1)}`);
await page.evaluate(() => { window.__machao.post.setBloom(false); });
await page.waitForTimeout(400);
const lumaNoBloom = await meanLuma(page);
check('关闭 Bloom 后画面仍正常', lumaNoBloom > 10, `meanLuma=${lumaNoBloom.toFixed(1)}`);
check('开/关 Bloom 亮度不跳变', Math.abs(lumaBloom - lumaNoBloom) / Math.max(1, lumaNoBloom) < 0.6,
  `bloom=${lumaBloom.toFixed(1)} noBloom=${lumaNoBloom.toFixed(1)}`);
await page.evaluate(() => { window.__machao.post.setBloom(true); });
await page.evaluate(() => { window.__machao.post.setPixel(true); });
await page.waitForTimeout(600);
check('像素风开启', await page.evaluate(() => window.__machao.post.pixel === true));
const lumaPixel = await meanLuma(page);
check('像素风画面不黑', lumaPixel > 10, `meanLuma=${lumaPixel.toFixed(1)}`);
await page.screenshot({ path: '/tmp/pwtest/shot_pixel.png' });
await page.evaluate(() => { window.__machao.post.setPixel(false); });
check('像素风可关闭', await page.evaluate(() => window.__machao.post.pixel === false));
await page.evaluate(() => { window.__machao.post.setEnabled(false); });
await page.waitForTimeout(300);
check('后期可整体关闭（直出）', await page.evaluate(() => window.__machao.post.enabled === false));
await page.evaluate(() => { window.__machao.post.setEnabled(true); });

// ---------- 4. 阳平关试炼 + 潼关回归 ----------
await page.goto(`${BASE}?char=zhouyu&mode=trial&map=yangping&enemies=120`, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(2000);
await page.click('#start-btn');
await page.waitForTimeout(1500);
check('阳平关试炼可开战', await page.evaluate(() => window.__machao.state === 'playing' && window.__machao.mapId === 'yangping'));
await page.goto(`${BASE}?char=machao&mode=tongguan&enemies=120`, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(2000);
await page.click('#start-btn');
await page.waitForTimeout(1500);
await page.evaluate(() => window.__machao.skipCutscene()); // 潼关开场过场，跳过
await page.waitForTimeout(300);
check('潼关之战仍在潼关图', await page.evaluate(() => window.__machao.state === 'playing' && window.__machao.mapId === 'tongguan'));

console.log('\n--- console errors:', errors.length ? errors : 'none');
console.log('--- failed requests:', failedReqs.length ? failedReqs : 'none');
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
await browser.close();
process.exit(failed || errors.length || failedReqs.length ? 1 : 0);
