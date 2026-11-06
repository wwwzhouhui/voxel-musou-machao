import { chromium } from 'playwright-core';
const exe = '/home/hatch/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome';
const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e).slice(0,200)));
page.on('console', m => { if (m.type()==='error') errors.push(m.text().slice(0,200)); });
await page.goto('http://127.0.0.1:8321/index.html?char=machao&mode=tongguan&enemies=120', { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
await page.click('#start-btn');
await page.waitForTimeout(1000);
await page.evaluate(() => window.__machao.skipCutscene()); // 潼关开场过场，跳过
// 过场把 _startWave 推迟了：等第一波敌人刷出再摆败北局（否则 nearestEnemy 为 null）
for (let i = 0; i < 20; i++) {
  await page.waitForTimeout(500);
  if (await page.evaluate(() => window.__machao.crowd.aliveCount('cao') > 0)) break;
}
await page.evaluate(() => {
  const g = window.__machao;
  for (const s of g.crowd.soldiers) if (s.alive && s.faction === 'ma') g.crowd.kill(s, true);
  g.player.hp = 5;
  const e = g.crowd.nearestEnemy(g.player.x, g.player.z, 200);
  if (!e) return;
  e.x = g.player.x + 1; e.z = g.player.z; e.state = 'windup'; e.stateT = 0.01; e.atkCd = 0;
});
let st = 'playing';
for (let i = 0; i < 40; i++) {
  await page.waitForTimeout(1000);
  st = await page.evaluate(() => window.__machao.state);
  if (st === 'over') break;
}
const res = await page.evaluate(() => ({
  state: window.__machao.state,
  title: document.getElementById('result-title').textContent,
  grade: document.getElementById('result-grade').textContent,
  visible: document.getElementById('result-screen').classList.contains('hidden') === false,
}));
console.log('defeat:', JSON.stringify(res), 'errors:', errors.length);
console.log(res.state === 'over' && res.title === '败 北' && res.visible && errors.length === 0 ? 'PASS defeat-path' : 'FAIL defeat-path');
await browser.close();
