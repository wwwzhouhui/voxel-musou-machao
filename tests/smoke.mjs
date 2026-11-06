// 多模式/多武将冒烟 + 耐久 soak：每个组合跑 20s 自动战斗，检查零报错
import { chromium } from 'playwright-core';
const exe = '/home/hatch/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome';
const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });

async function botFight(page, seconds) {
  const t0 = Date.now();
  let i = 0;
  while (Date.now() - t0 < seconds * 1000) {
    const st = await page.evaluate(() => window.__machao?.state);
    if (st !== 'playing') break;
    await page.evaluate(() => {
      const g = window.__machao;
      const e = g.crowd.nearestEnemy(g.player.x, g.player.z, 200);
      if (e) {
        g.player.x = e.x + 1.5; g.player.z = e.z + 1.5;
        g.player.facing = Math.atan2(e.x - g.player.x, e.z - g.player.z);
      }
      if (g.player.musou >= 100) g.player.musou = 100;
    });
    await page.keyboard.press(i % 4 === 3 ? 'KeyK' : 'KeyJ');
    if (i % 9 === 0) await page.keyboard.press('KeyI');
    i++;
    await page.waitForTimeout(280);
  }
}

const combos = [
  ['sunce', 'tongguan'], ['zhouyu', 'endless'], ['dianwei', 'trial'], ['machao', 'endless'],
];
let allOk = true;
for (const [char, mode] of combos) {
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  await page.goto(`http://127.0.0.1:8321/index.html?char=${char}&mode=${mode}&enemies=150`, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2000);
  await page.click('#start-btn');
  await page.waitForTimeout(1000);
  await page.evaluate(() => window.__machao.skipCutscene()); // 潼关开场过场，跳过；无过场时无操作
  await botFight(page, 20);
  const s = await page.evaluate(() => {
    const g = window.__machao;
    return { state: g.state, kills: g.kills, wave: g.wave, hp: Math.round(g.player.hp), alive: g.crowd.aliveCount('cao'), fps: g._fps || null };
  });
  const ok = errors.length === 0 && s.kills > 0;
  if (!ok) allOk = false;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${char}/${mode} state=${s.state} kills=${s.kills} wave=${s.wave} hp=${s.hp} alive=${s.alive} errors=${errors.length} ${errors[0] || ''}`);
  await page.close();
}

// 败北路径：马超残血被小兵打死
{
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  await page.goto('http://127.0.0.1:8321/index.html?char=machao&mode=tongguan&enemies=120', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await page.click('#start-btn');
  await page.waitForTimeout(1000);
  await page.evaluate(() => window.__machao.skipCutscene()); // 潼关开场过场，跳过；无过场时无操作
  // 过场把 _startWave 推迟了：等第一波敌人刷出再摆败北局（否则 nearestEnemy 为 null）
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(500);
    if (await page.evaluate(() => window.__machao.crowd.aliveCount('cao') > 0)) break;
  }
  await page.evaluate(() => {
    const g = window.__machao;
    // 先清友军并锁住补员：否则前摇士兵的目标是友军而不是玩家，3 秒内打不中玩家
    // （目标选择每帧仅 0.4% 概率切回玩家，旧写法是靠运气；与 defeat.mjs 的确定性做法对齐）
    for (const s of g.crowd.soldiers) if (s.alive && s.faction === 'ma') g.crowd.kill(s, true);
    g._allyRespawnT = 9999;
    g.player.hp = 3;
    const e = g.crowd.nearestEnemy(g.player.x, g.player.z, 200);
    if (e) { e.x = g.player.x + 1; e.z = g.player.z; e.state = 'windup'; e.stateT = 0.01; e.atkCd = 0; }
  });
  // SwiftShader 下游戏时间约慢 4 倍，轮询等结算（与 defeat.mjs 同款做法）
  let st = { state: 'playing', title: '' };
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(1000);
    st = await page.evaluate(() => ({ state: window.__machao.state, title: document.getElementById('result-title').textContent }));
    if (st.state === 'over') break;
  }
  const ok = st.state === 'over' && st.title === '败 北' && errors.length === 0;
  if (!ok) allOk = false;
  console.log(`${ok ? 'PASS' : 'FAIL'} defeat-path state=${st.state} title=${st.title} errors=${errors.length}`);
  await page.close();
}

// 低配模式
{
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  await page.goto('http://127.0.0.1:8321/index.html?char=machao&mode=tongguan&enemies=120&quality=low', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await page.click('#start-btn');
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.__machao.skipCutscene()); // 潼关开场过场，跳过；无过场时无操作
  // 第五阶段：刷新间隔 0.55→0.75 秒、同屏敌人减少后，8 秒实机只够打约 2–3 游戏秒，
  // 机器人伤害刚好卡在 0–1 杀的边界上（跑过一次 kills=0，复核 8 秒两次均为 1 杀），
  // 窗口过短导致结果随敌种/刷新抖动；改为与其它组合一致的 20 秒（20 秒复核 kills=2）。
  await botFight(page, 20);
  const s = await page.evaluate(() => ({ state: window.__machao.state, kills: window.__machao.kills, shadows: window.__machao.renderer.shadowMap.enabled }));
  const ok = errors.length === 0 && s.kills > 0 && s.shadows === false;
  if (!ok) allOk = false;
  console.log(`${ok ? 'PASS' : 'FAIL'} quality=low kills=${s.kills} shadowsOff=${s.shadows === false} errors=${errors.length}`);
  await page.screenshot({ path: '/tmp/pwtest/shot_title.png' });
  await page.close();
}

await browser.close();
console.log(allOk ? '\nALL SMOKE PASSED' : '\nSOME SMOKE FAILED');
process.exit(allOk ? 0 : 1);
