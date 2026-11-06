// 第五阶段验收：霸体 / 指针锁定 / 敌数血量 / 受击修复 / 出生分散
// 用法：先起服务器 cd ~/workspace/voxel-musou-machao && python3 -m http.server 8321
//       再把本文件拷到 /tmp/pwtest 下跑：node /tmp/pwtest/phase5.mjs
//       （playwright-core 在 /tmp/pwtest/node_modules，不在项目内）
// 说明：SwiftShader 下游戏内时间约比真实时间慢 12–15 倍，等待时间已按此放宽；
//       需要直接驱动内部状态的断言都用 evaluate 一次做完，避免与主循环竞态。
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
// 清场：杀光曹军（静默，不触发掉落/结算），供受击类断言使用
const CLEAR = `(() => { const g = window.__machao; for (const s of g.crowd.soldiers) if (s.alive) g.crowd.kill(s, true); })()`;

const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('requestfailed', (r) => failedReqs.push(r.url() + ' :: ' + (r.failure()?.errorText || '')));
page.on('response', (r) => { if (r.status() >= 400) failedReqs.push(r.url() + ' :: HTTP ' + r.status()); });

// ---------- 1. 开战与数值 ----------
await page.goto(`${BASE}?char=machao&mode=tongguan&enemies=120&skipintro=1`, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(2000);
check('标题界面可见', await page.locator('#title-screen:not(.hidden)').count() === 1);
check('选角卡显示霸体说明', await page.evaluate(() => document.body.textContent.includes('霸体')));
await page.click('#start-btn');
await page.waitForTimeout(1000);
check('开战后状态 playing', await page.evaluate(() => window.__machao.state === 'playing'));
check('马超血量 140', await page.evaluate(() => window.__machao.player.hp === 140 && window.__machao.player.maxHp === 140),
  await page.evaluate(() => `hp=${window.__machao.player.hp}/${window.__machao.player.maxHp}`));
check('高档在场敌数上限 32', await page.evaluate(() => window.__machao._maxAliveCap === 32),
  await page.evaluate(() => `cap=${window.__machao._maxAliveCap}`));
check('潼关波次 [10,13,16,19]', await page.evaluate(() => JSON.stringify(window.__machao.chapter.waves) === '[10,13,16,19]'));
check('Boss 触发线仍为 60', await page.evaluate(() => window.__machao.chapter.bossAfterKills === 60));

// ---------- 2. 霸体：马超 N5 窗口内受击不打断、减伤 20% ----------
const armorMachao = await page.evaluate(() => {
  const g = window.__machao;
  for (const s of g.crowd.soldiers) if (s.alive) g.crowd.kill(s, true);
  const p = g.player;
  const c = p.combo;
  c.state = 'attack'; c.stage = 5; c.stageT = 0.5; // N5 霸体窗口
  const hp0 = p.hp;
  g._onPlayerHit(10, p.x, p.z);
  const armored = { hp: p.hp, state: c.state, stage: c.stage, lost: hp0 - p.hp };
  // 窗口外 N4：应进硬直、足额扣血
  c.state = 'attack'; c.stage = 4; c.stageT = 0.5;
  const hp1 = p.hp;
  g._onPlayerHit(10, p.x, p.z);
  const plain = { hp: p.hp, state: c.state, lost: hp1 - p.hp };
  // 硬直中立即再受击：受击无敌帧应挡掉
  const hp2 = p.hp;
  g._onPlayerHit(10, p.x, p.z);
  const blocked = p.hp === hp2;
  // 推进 0.67 游戏秒：硬直结束、无敌帧过期，可再受击
  for (let i = 0; i < 40; i++) c.update(1 / 60);
  const hp3 = p.hp;
  g._onPlayerHit(10, p.x, p.z);
  const again = { lost: hp3 - p.hp, state: c.state };
  // 0.33 秒后脱离硬直
  for (let i = 0; i < 20; i++) c.update(1 / 60);
  return { armored, plain, blocked, again, idleAfter: c.state === 'idle' };
});
check('马超 N5 霸体：受击只扣 8 血（减伤 20%）', armorMachao.armored.lost === 8, `lost=${armorMachao.armored.lost}`);
check('马超 N5 霸体：出招不被打断', armorMachao.armored.state === 'attack' && armorMachao.armored.stage === 5);
check('N4 窗口外受击进硬直、足额扣 10 血', armorMachao.plain.state === 'stagger' && armorMachao.plain.lost === 10,
  `state=${armorMachao.plain.state} lost=${armorMachao.plain.lost}`);
check('硬直中再受击被无敌帧挡掉', armorMachao.blocked === true);
check('无敌帧过期后可再受击', armorMachao.again.lost === 10 && armorMachao.again.state === 'stagger');
check('0.33 秒后脱离硬直', armorMachao.idleAfter === true);
check('霸体 HUD 图标与脚下金圈显示', await waitFor(page, () => {
  const g = window.__machao;
  g.player.combo.state = 'attack'; g.player.combo.stage = 5; g.player.combo.stageT = 0.5;
  return !document.getElementById('armor-indicator').classList.contains('hidden') && g.armorRing.visible;
}, 8000, 'armor indicator + ring'));

// ---------- 3. 霸体：其余三将（换将重开，测各自窗口） ----------
async function armorFor(charId, kind, stage, expectArmor) {
  return page.evaluate(({ charId, kind, stage }) => {
    const g = window.__machao;
    g.start('tongguan', charId, 'tongguan'); // skipintro=1，直接开战
    for (const s of g.crowd.soldiers) if (s.alive) g.crowd.kill(s, true);
    const p = g.player;
    const c = p.combo;
    c.state = kind === 'normal' ? 'attack' : 'charge';
    c.stage = stage; c.stageT = 0.5;
    const hp0 = p.hp;
    g._onPlayerHit(10, p.x, p.z);
    return { lost: hp0 - p.hp, state: c.state, stage: c.stage, hp: p.hp };
  }, { charId, kind, stage });
}
const sunce = await armorFor('sunce', 'charge', 3);
check('孙策 C3 霸体：扣 7.5 血、出招不断', Math.abs(sunce.lost - 7.5) < 0.01 && sunce.state === 'charge' && sunce.stage === 3, `lost=${sunce.lost}`);
const sunce2 = await armorFor('sunce', 'charge', 2);
check('孙策 C2 不霸体：扣满 10 血进硬直', sunce2.lost === 10 && sunce2.state === 'stagger', `lost=${sunce2.lost}`);
const zhouyu = await armorFor('zhouyu', 'charge', 1);
check('周瑜 C1 霸体：扣 8.5 血', Math.abs(zhouyu.lost - 8.5) < 0.01 && zhouyu.state === 'charge', `lost=${zhouyu.lost}`);
const dianwei = await armorFor('dianwei', 'charge', 6);
check('典韦 C6 霸体：扣 6 血（减伤 40%）', Math.abs(dianwei.lost - 6) < 0.01 && dianwei.state === 'charge', `lost=${dianwei.lost}`);
const dianwei2 = await armorFor('dianwei', 'normal', 5);
check('典韦 N5 不霸体', dianwei2.lost === 10 && dianwei2.state === 'stagger', `lost=${dianwei2.lost}`);
check('典韦血量 190', await page.evaluate(() => window.__machao.player.maxHp === 190));
// 回到马超继续
await page.evaluate(() => window.__machao.start('tongguan', 'machao', 'tongguan'));
await page.waitForTimeout(500);
check('换回马超后仍可战斗', await page.evaluate(() => window.__machao.state === 'playing'));

// ---------- 4. 指针锁定 ----------
check('指针锁定方法存在', await page.evaluate(() => typeof window.__machao._requestPointerLock === 'function'));
check('直接请求锁定不抛错（无头下拒绝也被接住）', await page.evaluate(() => {
  try { window.__machao._requestPointerLock(); return true; } catch (e) { return false; }
}));
await page.evaluate(() => { window.__machao.pointerLocked = true; });
await page.mouse.move(640, 400); // 定位，不计
const yawBefore = await page.evaluate(() => window.__machao.camYaw);
await page.mouse.move(740, 400); // +100px，应转 -0.28 rad
const yawAfter = await page.evaluate(() => window.__machao.camYaw);
check('锁定下滑鼠标转视角（yaw 跟随 movementX）', Math.abs((yawBefore - yawAfter) - 100 * 0.0028) < 0.05,
  `yaw ${yawBefore.toFixed(3)} -> ${yawAfter.toFixed(3)}`);
await page.evaluate(() => { window.__machao.pointerLocked = false; });
// 模拟 Esc 退出锁定：先真退出（若无头下锁定真的成功了，退出会触发真实事件），
// 若未锁定则补发合成事件；两种路径都应自动暂停。
await page.evaluate(() => { if (document.pointerLockElement) document.exitPointerLock(); });
await page.waitForTimeout(300);
if (await page.evaluate(() => window.__machao.state === 'playing')) {
  await page.evaluate(() => document.dispatchEvent(new Event('pointerlockchange')));
  await page.waitForTimeout(300);
}
check('退出锁定后自动暂停', await page.evaluate(() => window.__machao.state === 'paused'));
await page.click('#resume-btn');
await page.waitForTimeout(300);
check('点“继续战斗”恢复战斗', await page.evaluate(() => window.__machao.state === 'playing'));

// ---------- 5. 波次配额 ----------
await page.evaluate(() => window.__machao.start('trial', 'machao', 'tongguan'));
await page.waitForTimeout(500);
check('试炼首波 28 人', await page.evaluate(() => window.__machao.waveQuota === 28),
  await page.evaluate(() => `quota=${window.__machao.waveQuota}`));
check('试炼目标仍为 240', await page.evaluate(() => window.__machao.chapter.killTarget === 240));
await page.evaluate(() => window.__machao.start('endless', 'machao', 'tongguan'));
await page.waitForTimeout(500);
check('演武首波 11 人', await page.evaluate(() => window.__machao.waveQuota === 11),
  await page.evaluate(() => `quota=${window.__machao.waveQuota}`));
await page.evaluate(() => window.__machao.start('tongguan', 'machao', 'tongguan'));
await page.waitForTimeout(500);

// ---------- 6. 受击修复 ----------
const aoe = await page.evaluate(() => {
  const g = window.__machao;
  for (const s of g.crowd.soldiers) if (s.alive) g.crowd.kill(s, true);
  const p = g.player;
  const mk = (x, z) => { const s = g.crowd.spawn('elite', x, z, 'cao'); s.hp = 55; s.maxHp = 55; return s; };
  const fx = Math.sin(p.facing), fz = Math.cos(p.facing);
  const a = mk(p.x + fx * 3, p.z + fz * 3);       // 正前方 3 米：主扇形内
  const b = mk(p.x - fx * 4.5, p.z - fz * 4.5);   // 正后方 4.5 米：扇形外、AoE 圈内
  g._resolveHit({ t: 0, kind: 'charge', stage: 3, range: 4.0, arc: 2.6, dmg: 2.4, kb: 13, aoe: 1 });
  return { aHp: a.hp, bHp: b.hp };
});
check('蓄力 AoE 单次判定：扇形内只吃主伤害 24', Math.abs(aoe.aHp - 31) < 0.01, `aHp=${aoe.aHp}`);
check('蓄力 AoE 单次判定：扇形外只吃冲击圈 14.4', Math.abs(aoe.bHp - 40.6) < 0.01, `bHp=${aoe.bHp}`);
const dmgNum = await page.evaluate(() => {
  const g = window.__machao;
  g._dmgNum(0, 2, -20, 'TEST', '#fff');
  const n = g.dmgNums[g.dmgNums.length - 1];
  const v = g._v3.clone().set(0, 2, -20).project(g.camera);
  const sx = (v.x * 0.5 + 0.5) * g.container.clientWidth;
  const sy = (-v.y * 0.5 + 0.5) * g.container.clientHeight;
  return { dx: Math.abs(n.x - sx), dy: Math.abs(n.y - sy) };
});
check('飘字落在正确世界坐标（z 不再取玩家 z）', dmgNum.dx < 2 && dmgNum.dy < 2, `dx=${dmgNum.dx.toFixed(1)} dy=${dmgNum.dy.toFixed(1)}`);
const flash = await page.evaluate(() => {
  const g = window.__machao;
  const s = g.crowd.spawn('soldier', g.player.x + 5, g.player.z, 'cao');
  const col = g.crowd._c;
  g.crowd.damage(s, 5, 1, 0, 3);
  g.crowd.meshes.body.getColorAt(s.id, col);
  const whiteNow = col.r > 0.9 && col.g > 0.9 && col.b > 0.9;
  for (let i = 0; i < 15; i++) g.crowd.update(1 / 60, g.player, () => null);
  g.crowd.meshes.body.getColorAt(s.id, col);
  return { whiteNow, restoredHex: col.getHex() };
});
check('敌人受击变白闪', flash.whiteNow === true);
check('白闪结束还原本体色 0x33415e', flash.restoredHex === 0x33415e, `hex=0x${flash.restoredHex.toString(16)}`);
const warn = await page.evaluate(() => {
  const g = window.__machao;
  g.bossSpawned = true;
  const b = g.boss;
  b.group.visible = true;
  b.hp = 1400; b.dead = false;
  b.x = g.player.x; b.z = g.player.z - 10;
  b.state = 'windup'; b.telegraph = 'sweep'; b.stateT = 0.01; b.atkCd = 5;
  g._updateBoss(0.05); // 前摇结束 → 横扫，警告应仍在
  const duringSweep = !document.getElementById('boss-warning').classList.contains('hidden');
  g._updateBoss(0.35); // 横扫结算 → 警告消失
  const afterSweep = document.getElementById('boss-warning').classList.contains('hidden');
  return { duringSweep, afterSweep, state: b.state };
});
check('Boss 横扫蓄势期警告仍在', warn.duringSweep === true);
check('Boss 横扫结算后警告消失', warn.afterSweep === true && warn.state === 'recover', `state=${warn.state}`);

// ---------- 7. 出生分散 ----------
const spread = await page.evaluate(() => {
  const g = window.__machao;
  for (const s of g.crowd.soldiers) if (s.alive) g.crowd.kill(s, true);
  g.waveQuota = 99; g.waveSpawned = 0;
  g._spawnBatch(8);
  const alive = g.crowd.soldiers.filter((s) => s.alive && s.faction === 'cao');
  const pos = alive.map((s) => ({ x: s.x, z: s.z }));
  const ds = [];
  for (let i = 0; i < pos.length; i++) {
    for (let j = i + 1; j < pos.length; j++) {
      ds.push(Math.hypot(pos[i].x - pos[j].x, pos[i].z - pos[j].z));
    }
  }
  ds.sort((a, b) => a - b);
  const median = ds.length ? ds[Math.floor(ds.length / 2)] : 0;
  let maxCluster = 0;
  for (const p of pos) {
    let c = 0;
    for (const q of pos) if (Math.hypot(p.x - q.x, p.z - q.z) <= 3) c++;
    maxCluster = Math.max(maxCluster, c);
  }
  // 8 人来自几个不同出生点
  const pts = g.world.spawns.spawnPoints;
  const used = new Set(pos.map((p) => {
    let best = 0, bd = 1e9;
    pts.forEach((pt, i) => { const d = Math.hypot(p.x - pt.x, p.z - pt.z); if (d < bd) { bd = d; best = i; } });
    return best;
  })).size;
  return { n: pos.length, median, maxCluster, used };
});
check('一批 8 人刷出', spread.n === 8, `n=${spread.n}`);
check('出生间距中位数 > 4 米', spread.median > 4, `median=${spread.median.toFixed(1)}`);
check('半径 3 米圈内至多 3 人', spread.maxCluster <= 3, `maxCluster=${spread.maxCluster}`);
check('8 人来自 ≥5 个不同出生点', spread.used >= 5, `used=${spread.used}`);
const sep = await page.evaluate(() => {
  const g = window.__machao;
  for (const s of g.crowd.soldiers) if (s.alive) g.crowd.kill(s, true);
  const a = g.crowd.spawn('soldier', 0, 0, 'cao');
  const b = g.crowd.spawn('soldier', 0.5, 0, 'cao');
  a.atkCd = 99; b.atkCd = 99;
  const d0 = Math.hypot(a.x - b.x, a.z - b.z);
  for (let i = 0; i < 60; i++) g.crowd.update(1 / 60, { x: 100, z: 100 }, () => null);
  return { d0, d1: Math.hypot(a.x - b.x, a.z - b.z) };
});
check('贴身两敌 1 秒后被推开 ≥1.5 米', sep.d1 >= 1.5, `d ${sep.d0} -> ${sep.d1.toFixed(2)}`);
const chase = await page.evaluate(() => {
  const g = window.__machao;
  for (const s of g.crowd.soldiers) if (s.alive) g.crowd.kill(s, true);
  const s = g.crowd.spawn('soldier', 0, 0, 'cao');
  s.approachAngle = Math.PI / 2; // 偏移点在玩家北侧
  s.approachR = 8;               // 放大偏移以便确定性断言（机制与 1.5–3.5 米相同）
  s.atkCd = 99;
  g.player.x = 30; g.player.z = 0;
  for (let i = 0; i < 90; i++) g.crowd.update(1 / 60, g.player, () => null);
  return { x: s.x, z: s.z };
});
check('追击不走直线：朝偏移点偏北', chase.z > 0.5, `pos=(${chase.x.toFixed(1)}, ${chase.z.toFixed(1)})`);

// ---------- 8. 30 秒实战 soak ----------
await page.evaluate(() => window.__machao.start('tongguan', 'machao', 'tongguan'));
await page.waitForTimeout(500);
{
  const t0 = Date.now();
  let i = 0;
  while (Date.now() - t0 < 30000) {
    const st = await page.evaluate(() => window.__machao?.state);
    if (st !== 'playing') break;
    await page.evaluate(() => {
      const g = window.__machao;
      const e = g.crowd.nearestEnemy(g.player.x, g.player.z, 200);
      if (e) {
        g.player.x = e.x + 1.5; g.player.z = e.z + 1.5;
        g.player.facing = Math.atan2(e.x - g.player.x, e.z - g.player.z);
      }
    });
    await page.keyboard.press(i % 4 === 3 ? 'KeyK' : 'KeyJ');
    i++;
    await page.waitForTimeout(280);
  }
  const s = await page.evaluate(() => {
    const g = window.__machao;
    return { state: g.state, kills: g.kills, hp: Math.round(g.player.hp), alive: g.crowd.aliveCount('cao') };
  });
  check('30 秒实战无崩溃、仍在战斗', s.state === 'playing' && s.kills > 0,
    `state=${s.state} kills=${s.kills} hp=${s.hp} alive=${s.alive}`);
}

await page.screenshot({ path: '/tmp/pwtest/shot_phase5.png' });
console.log('\n--- console errors:', errors.length ? errors : 'none');
console.log('--- failed requests:', failedReqs.length ? failedReqs : 'none');
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
await browser.close();
process.exit(failed || errors.length || failedReqs.length ? 1 : 0);
