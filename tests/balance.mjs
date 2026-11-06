// 数值平衡探针（第四阶段）：自动化战斗测数值，不凭感觉改
// 用法：先起服务器 cd ~/workspace/voxel-musou-machao && python3 -m http.server 8321
//       再把本文件拷到 /tmp/pwtest 下跑：node /tmp/pwtest/balance-run.mjs [hero]
//       hero 省略则跑全部四名武将。每名武将 45 秒真实时间自动战斗。
// 说明：SwiftShader 下游戏内时间约比真实时间慢 4 倍，45 秒真实 ≈ 11 秒游戏时间，
//       通关时间/试炼斩数按“游戏内时间”换算外推，并在结果里同时给出原始值。
// 机器人：每 200ms 瞬移到最近敌兵附近 2 米并朝向它，轮流按 J（普攻）/ Q（远程，
//       冷却好就用）；Boss 出场后同样打 Boss。被箭命中、掉血、坐骑冲锋数据单独记。
import { chromium } from 'playwright-core';

const BASE = process.argv[2] || 'http://127.0.0.1:8321/index.html';
const onlyHero = process.argv[3] || null;
const exe = '/home/hatch/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome';
const HEROES = ['machao', 'sunce', 'zhouyu', 'dianwei'];
// 真实时间（毫秒），可用第 4 个参数覆盖；SwiftShader 下游戏时间约慢 12-15 倍，
// 45 秒真实 ≈ 3-4 游戏秒，数据只是下限参考，不是真人水平。
const REAL_MS = parseInt(process.argv[4] || '45000', 10);
const ARCHER_MS = parseInt(process.argv[5] || '30000', 10);

const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

async function probeTongguan(hero) {
  await page.goto(`${BASE}?char=${hero}&mode=tongguan&enemies=120&skipintro=1`, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2000);
  await page.click('#start-btn');
  await page.waitForTimeout(1000);
  const t0 = Date.now();
  let bossT0 = null, bossKilledAt = null, arrowsTaken = 0, hpMin = 999, freeAttacks = 0;
  while (Date.now() - t0 < REAL_MS) {
    const s = await page.evaluate(() => {
      const g = window.__machao;
      const p = g.player;
      // Boss 优先
      let tgt = null;
      if (g.bossSpawned && !g.boss.dead) tgt = { x: g.boss.x, z: g.boss.z, isBoss: true };
      else {
        const e = g.crowd.nearestEnemy(p.x, p.z, 200);
        if (e) tgt = { x: e.x, z: e.z, isBoss: false };
      }
      if (tgt) {
        p.x = tgt.x; p.z = tgt.z + 2;
        p.facing = Math.atan2(tgt.x - p.x, tgt.z - p.z);
      }
      return {
        state: g.state, kills: g.kills, hp: p.hp, maxHp: p.maxHp,
        bossSpawned: g.bossSpawned, bossDead: g.bossDead, bossHp: g.boss.hp,
        time: g.time, arrows: g._arrowHitsTaken || 0, shots: g.shotPool.fired,
        busy: p.combo.busy, rangedReady: g.ranged.ready,
      };
    });
    if (s.state === 'over') break;
    if (s.bossSpawned && bossT0 === null) bossT0 = s.time;
    if (s.bossDead && bossKilledAt === null) bossKilledAt = s.time;
    arrowsTaken = Math.max(arrowsTaken, s.arrows);
    hpMin = Math.min(hpMin, s.hp);
    // 只在连招空闲时出招（狂按 J 会让 Q 永远被 busy 挡掉，那是机器人伪影）；
    // Q 就绪就发射，其余每 3 次空闲攻击用一次 K 蓄力（范围攻击，真人打法）。
    if (s.rangedReady) {
      await page.keyboard.press('KeyQ');
    } else if (!s.busy) {
      freeAttacks++;
      await page.keyboard.press(freeAttacks % 3 === 0 ? 'KeyK' : 'KeyJ');
    }
    await page.waitForTimeout(150);
  }
  const end = await page.evaluate(() => {
    const g = window.__machao;
    return { state: g.state, kills: g.kills, hp: g.player.hp, time: g.time, bossSpawned: g.bossSpawned, bossDead: g.bossDead, bossHp: g.boss.hp, shots: g.shotPool.fired, arrows: g._arrowHitsTaken || 0 };
  });
  const gameSec = end.time;
  const killsPerGameSec = gameSec > 0 ? end.kills / gameSec : 0;
  // 试炼外推：3 分钟（180 游戏秒）按当前斩速
  const trialEst = Math.round(killsPerGameSec * 180);
  console.log(`\n[${hero}] 潼关自动战斗 ${Math.round(REAL_MS / 1000)}s 真实时间`);
  console.log(`  状态=${end.state} 斩数=${end.kills} 剩余HP=${end.hp} 游戏内时间=${gameSec.toFixed(1)}s`);
  console.log(`  斩速=${killsPerGameSec.toFixed(2)}/游戏秒 → 试炼 3 分钟外推 ≈ ${trialEst} 斩（目标 300）`);
  console.log(`  Boss 出场=${end.bossSpawned} Boss 已败=${end.bossDead} Boss 剩余HP=${end.bossHp}` +
    (bossT0 !== null && bossKilledAt !== null ? ` Boss 战用时=${(bossKilledAt - bossT0).toFixed(1)} 游戏秒` : ''));
  console.log(`  远程发射=${end.shots} 次 被箭命中=${end.arrows} 次 最低HP=${hpMin}`);
  return { hero, ...end, killsPerGameSec, trialEst };
}

// 弓手命中频率：站桩 30 秒不动，记被箭命中次数（弓手占比 15-25% 下）
async function probeArcher(hero) {
  await page.goto(`${BASE}?char=${hero}&mode=endless&enemies=120&skipintro=1`, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2000);
  await page.click('#start-btn');
  await page.waitForTimeout(1000);
  const t0 = Date.now();
  while (Date.now() - t0 < ARCHER_MS) await page.waitForTimeout(1000);
  const s = await page.evaluate(() => {
    const g = window.__machao;
    const archers = g.crowd.soldiers.filter((x) => x.alive && x.type === 'archer').length;
    const alive = g.crowd.aliveCount('cao');
    return { arrows: g._arrowHitsTaken || 0, hp: g.player.hp, time: g.time, archers, alive };
  });
  const perMin = s.time > 0 ? (s.arrows / s.time * 60).toFixed(1) : '?';
  console.log(`\n[${hero}] 站桩 ${Math.round(ARCHER_MS / 1000)}s：被箭命中 ${s.arrows} 次（≈ ${perMin} 次/游戏分钟），弓手 ${s.archers}/${s.alive} 存活，HP ${s.hp}，游戏内时间 ${s.time.toFixed(1)}s`);
  return s;
}

for (const hero of HEROES) {
  if (onlyHero && hero !== onlyHero) continue;
  await probeTongguan(hero);
}
await probeArcher('machao');
await browser.close();
console.log('\n探针完成。注意：SwiftShader 下游戏时间约慢 12-15 倍（~4fps 时每真实秒只推进约 1/15 游戏秒），通关时间/斩速以外推值为准；机器人是下限（不用无双、不会钻人堆聚怪），真人用蓄力范围攻击 + 无双会更快；真实设备帧率未测。');
