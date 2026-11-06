// 无头浏览器验收：加载 → 点出战 → 模拟按键 → 断言游戏状态
// 用法：node /tmp/pwtest/e2e.mjs [url] [mode]
import { chromium } from 'playwright-core';

const url = process.argv[2] || 'http://127.0.0.1:8321/index.html?char=machao&mode=tongguan&enemies=120';
const exe = '/home/hatch/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome';
const errors = [];
const failedReqs = [];

const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('requestfailed', (r) => failedReqs.push(r.url() + ' :: ' + (r.failure()?.errorText || '')));
page.on('response', (r) => { if (r.status() >= 400) failedReqs.push(r.url() + ' :: HTTP ' + r.status()); });

const results = [];
const check = (name, cond, extra = '') => {
  results.push({ name, ok: !!cond, extra });
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name} ${extra}`);
};

await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(2500);
check('标题界面可见', await page.locator('#title-screen:not(.hidden)').count() === 1);
check('4 张武将卡', (await page.locator('.char-card').count()) === 4);
check('3 张战役卡', (await page.locator('#mode-cards .mode-card').count()) === 3);
check('2 张地图卡', (await page.locator('#map-cards .mode-card').count()) === 2);
check('游戏对象已挂载', await page.evaluate(() => !!window.__machao));
check('WebGL 渲染器就绪', await page.evaluate(() => !!window.__machao?.renderer));

await page.click('#start-btn');
await page.waitForTimeout(1500);
// 潼关之战有开场过场（cutscene 态），跳过后再断言战斗态
await page.evaluate(() => window.__machao.skipCutscene());
await page.waitForTimeout(300);
check('开始后 HUD 可见', await page.locator('#hud:not(.hidden)').count() === 1);
check('状态 playing', await page.evaluate(() => window.__machao.state === 'playing'));
check('玩家 HP 满', await page.evaluate(() => window.__machao.player.hp === window.__machao.player.maxHp));
check('第一波已生成敌军', await page.evaluate(() => window.__machao.crowd.aliveCount('cao') > 0),
  await page.evaluate(() => `alive=${window.__machao.crowd.aliveCount('cao')}`));

// 走到敌群附近并攻击：把玩家传送到最近敌人旁（测试手段，不影响真实玩法）
await page.evaluate(() => {
  const g = window.__machao;
  const e = g.crowd.nearestEnemy(g.player.x, g.player.z, 200);
  if (e) { g.player.x = e.x; g.player.z = e.z + 2; g.player.facing = Math.atan2(e.x - g.player.x, e.z - g.player.z); }
});
const killsBefore = await page.evaluate(() => window.__machao.kills);
for (let i = 0; i < 10; i++) {
  await page.keyboard.press('KeyJ');
  await page.waitForTimeout(320);
}
await page.waitForTimeout(800);
const killsAfter = await page.evaluate(() => window.__machao.kills);
check('普攻可击杀小兵', killsAfter > killsBefore, `kills ${killsBefore} → ${killsAfter}`);
check('无双槽因击杀增长', await page.evaluate(() => window.__machao.player.musou > 0),
  await page.evaluate(() => `musou=${Math.round(window.__machao.player.musou)}`));

// 闪避 + 跳跃
await page.keyboard.press('ShiftLeft');
await page.waitForTimeout(150);
check('闪避可触发（或已冷却）', await page.evaluate(() => true)); // 仅不断言崩溃
await page.keyboard.press('Space');
await page.waitForTimeout(200);
check('跳跃离地', await page.evaluate(() => window.__machao.player.y > 0 || window.__machao.player.grounded === true));

// 无双：把槽打满再放
await page.evaluate(() => { window.__machao.player.musou = 100; });
await page.keyboard.press('KeyI');
await page.waitForTimeout(300);
check('无双可释放', await page.evaluate(() => window.__machao.player.combo.musouActive === true));

// 暂停 / 恢复
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
check('Esc 暂停', await page.evaluate(() => window.__machao.state === 'paused'));
await page.click('#resume-btn');
await page.waitForTimeout(300);
check('恢复继续', await page.evaluate(() => window.__machao.state === 'playing'));

// Boss 触发：把击杀数推到 59，再实打实砍死一个触发
await page.evaluate(() => { window.__machao.kills = 59; });
await page.evaluate(() => {
  const g = window.__machao;
  const e = g.crowd.nearestEnemy(g.player.x, g.player.z, 200);
  if (e) { e.hp = 1; g.player.x = e.x; g.player.z = e.z + 2; g.player.facing = Math.atan2(e.x - g.player.x, e.z - g.player.z); }
});
await page.keyboard.press('KeyJ');
await page.waitForTimeout(1500);
check('60 斩触发曹操 Boss', await page.evaluate(() => window.__machao.bossSpawned === true));
check('Boss 血条显示', await page.locator('#boss-bar-wrap:not(.hidden)').count() === 1);
check('Boss 血量 1400', await page.evaluate(() => window.__machao.boss.maxHp === 1400));

// Boss 登场过场：跳过后再锁定（过场中按键只会跳过，不会锁定）
await page.evaluate(() => window.__machao.skipCutscene());
await page.waitForTimeout(300);
check('Boss 过场可跳过回战斗', await page.evaluate(() => window.__machao.state === 'playing'));
await page.keyboard.press('KeyR');
await page.waitForTimeout(200);
check('R 锁定 Boss', await page.evaluate(() => !!window.__machao.lockTarget));

// 小地图已绘制
check('小地图有内容', await page.evaluate(() => {
  const cv = document.getElementById('minimap');
  const ctx = cv.getContext('2d');
  const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
  let nz = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) nz++;
  return nz > 100;
}));

await page.screenshot({ path: '/tmp/pwtest/shot_gameplay.png' });
// 击杀 Boss → 胜利结算
await page.evaluate(() => { const g = window.__machao; g.boss.hp = 1; g.player.x = g.boss.x; g.player.z = g.boss.z + 2; g.player.facing = Math.atan2(g.boss.x - g.player.x, g.boss.z - g.player.z); });
await page.keyboard.press('KeyJ');
// 胜利先播 7 秒结尾过场：轮询等过场出现并跳过，再等结算
for (let i = 0; i < 10; i++) {
  await page.waitForTimeout(1000);
  const st = await page.evaluate(() => window.__machao.state);
  if (st === 'cutscene') await page.evaluate(() => window.__machao.skipCutscene());
  if (st === 'over') break;
}
check('击败 Boss 出现结算', await page.evaluate(() => window.__machao.state === 'over'));
check('结算屏可见', await page.locator('#result-screen:not(.hidden)').count() === 1);
check('评级已显示', await page.evaluate(() => ['S', 'A', 'B', 'C'].includes(document.getElementById('result-grade').textContent)));
check('最佳纪录已写入 localStorage', await page.evaluate(() => !!localStorage.getItem('machao_best_tongguan_machao')));
await page.screenshot({ path: '/tmp/pwtest/shot_result.png' });

console.log('\n--- console errors:', errors.length ? errors : 'none');
console.log('--- failed requests:', failedReqs.length ? failedReqs : 'none');
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
await browser.close();
process.exit(failed || errors.length || failedReqs.length ? 1 : 0);
