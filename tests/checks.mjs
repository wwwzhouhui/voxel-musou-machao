// Node 回归自检：连招状态机 / 评级 / 配置 / 地图 / 弓手 / 箭矢（不依赖浏览器与 three）
// 用法：node tests/checks.mjs
import { ComboMachine } from '../src/combat.js';
import { gradeFor, parseUrlParams, BALANCE, CHARACTERS, CHAPTERS, MAPS, ARCHER, MOUNT, archerShareForWave } from '../src/config.js';
import { ArrowPool, archerDecision, aimVelocity } from '../src/arrows.js';
import { CUTSCENES, CutsceneRunner, cutsceneTotal } from '../src/cutscene.js';
import { MountState, shouldFallFromHit } from '../src/mount.js';
import { AdaptiveQuality, QUALITY_TIERS, MANUAL_TIER } from '../src/adaptive.js';
import { RANGED, RANGED_POOL_SIZE, rangedSpec, RangedState, PlayerShotPool, BurnZone } from '../src/player-shots.js';

let pass = 0, fail = 0;
function t(name, cond) {
  if (cond) { pass++; console.log(`  PASS ${name}`); }
  else { fail++; console.log(`  FAIL ${name}`); }
}
const step = (cm, n, dt = 1 / 60) => { for (let i = 0; i < n; i++) cm.update(dt); };

console.log('== 连招状态机 ==');
{
  const cm = new ComboMachine();
  t('初始 idle', cm.state === 'idle' && cm.stage === 0);
  const a1 = cm.pressAttack();
  t('N1 出招', a1 && a1.kind === 'normal' && a1.stage === 1);
  t('出招中 busy', cm.busy === true);
  t('出招中再按 J 排队不丢', cm.pressAttack() === null && cm.queuedAttack === true);
  step(cm, 20); // 0.33s > N1 dur 0.26
  const p = cm.consumePending();
  t('排队输入自动接 N2', p && p.stage === 2);
  t('N2 进行中', cm.state === 'attack' && cm.stage === 2);
  step(cm, 20);
  t('招式结束进入衔接窗口', cm.state === 'idle' && cm.windowT > 0 && cm.stage === 2);
  const a3 = cm.pressAttack();
  t('窗口内按 J 接 N3', a3 && a3.stage === 3);
  step(cm, 60);
  t('窗口过期连段清零', cm.stage === 0);
  // 蓄力
  cm.pressAttack(); step(cm, 5);
  const c = cm.pressCharge();
  t('N1 后按 K 出 C1', c && c.kind === 'charge' && c.stage === 1);
  t('蓄力中 busy', cm.busy === true);
  t('蓄力中按 J 被吞', cm.pressAttack() === null);
  step(cm, 40);
  t('蓄力结束回 idle', cm.state === 'idle');
  // 无连段按 K 无效
  t('无连段按 K 无效', cm.pressCharge() === null);
  // 闪避
  t('闪避触发', cm.pressDodge() === true && cm.dodging === true);
  t('闪避中无敌', cm.invulnerable === true);
  t('闪避冷却内不可再闪', cm.pressDodge() === false);
  step(cm, 20);
  t('闪避结束', cm.state === 'idle');
  // 受击硬直
  cm.pressAttack(); step(cm, 3);
  t('受击打断出招进硬直', cm.takeHit(10) === true && cm.state === 'stagger');
  t('硬直中攻击被吞', cm.pressAttack() === null);
  step(cm, 25);
  t('硬直结束', cm.state === 'idle' && cm.stage === 0);
  // 无双
  t('无双开启', cm.tryMusou() === true && cm.musouActive === true);
  t('无双中免疫受击', cm.takeHit(10) === false);
  step(cm, 60 * 7);
  t('无双 6s 后结束', cm.musouActive === false);
  // 空中攻击
  cm.airborne = true;
  const air = cm.pressAttack();
  t('空中 J 出空攻', air && air.kind === 'air');
  cm.airborne = false;
  step(cm, 30);
}

console.log('== 评级 ==');
t('S 级：300斩无伤', gradeFor({ kills: 300, damageTaken: 0, timeSec: 200, died: false }) === 'S');
t('A 级：150斩轻伤', gradeFor({ kills: 150, damageTaken: 30, timeSec: 300, died: false }) === 'A');
t('C 级：阵亡', gradeFor({ kills: 500, damageTaken: 0, timeSec: 100, died: true }) === 'C');
t('B 级：中等', gradeFor({ kills: 150, damageTaken: 100, timeSec: 500, died: false }) === 'B');

console.log('== 配置 ==');
t('4 名武将', Object.keys(CHARACTERS).length === 4);
t('马超默认', CHARACTERS.machao.weaponType === 'spear' && CHARACTERS.machao.stats.hp === 120);
t('周瑜羽扇', CHARACTERS.zhouyu.weaponType === 'fan');
t('典韦双戟', CHARACTERS.dianwei.weaponType === 'axes');
t('3 种模式', Object.keys(CHAPTERS).length === 3);
t('潼关 60 斩触发 Boss', CHAPTERS.tongguan.bossAfterKills === 60);
t('试炼 180 秒', CHAPTERS.trial.timeLimit === 180);
t('试炼目标 240 斩（第四阶段平衡探针后由 300 下调）', CHAPTERS.trial.killTarget === 240);
t('N 连段 6 段', BALANCE.combo.length === 6);
t('C 终结 6 档', BALANCE.charge.length === 6);
t('URL 参数解析', (() => {
  const p = parseUrlParams('?char=zhouyu&mode=trial&enemies=150&quality=low');
  return p.char === 'zhouyu' && p.mode === 'trial' && p.enemies === 150 && p.quality === 'low';
})());
t('URL 参数非法值回退', (() => {
  const p = parseUrlParams('?char=xxx&enemies=99999');
  return p.char === 'machao' && p.enemies === 600;
})());

console.log('== 地图 ==');
t('2 张独立地图', Object.keys(MAPS).length === 2);
t('潼关是峡谷/白昼', MAPS.tongguan.variant === 'day' && MAPS.tongguan.id === 'tongguan');
t('阳平关是夜战', MAPS.yangping.night === true && MAPS.yangping.variant === 'night');
t('两图名不同', MAPS.tongguan.name !== MAPS.yangping.name);
t('URL map 参数解析', (() => {
  const p = parseUrlParams('?map=yangping&mode=endless');
  return p.map === 'yangping' && p.mode === 'endless';
})());
t('URL map 非法值回退潼关', parseUrlParams('?map=xxx').map === 'tongguan');
t('URL post=off 关闭后期', (() => {
  const p = parseUrlParams('?post=off');
  return p.post.enabled === false && p.post.bloom === false && p.post.pixel === false;
})());
t('URL post=pixel 开像素风', (() => {
  const p = parseUrlParams('?post=pixel');
  return p.post.enabled === true && p.post.bloom === true && p.post.pixel === true;
})());
t('URL post 默认开 Bloom 不开像素', (() => {
  const p = parseUrlParams('?mode=endless');
  return p.post.enabled === true && p.post.bloom === true && p.post.pixel === false;
})());

console.log('== 弓手 ==');
t('弓手射程 10-26 米', ARCHER.rangeMin === 10 && ARCHER.rangeMax === 26);
t('拉弓前摇 0.75 秒', ARCHER.aimTime === 0.75);
t('箭速 26', ARCHER.arrowSpeed === 26);
t('箭池 48 支', ARCHER.poolSize === 48);
t('太近后退', archerDecision(5, 0) === 'retreat');
t('太远靠近', archerDecision(30, 0) === 'approach');
t('射程内且冷却好则拉弓', archerDecision(18, 0) === 'aim');
t('射程内冷却中则待命', archerDecision(18, 1.2) === 'hold');
t('第 1 波弓手 15%', Math.abs(archerShareForWave(1) - 0.15) < 1e-9);
t('第 3 波弓手 19%', Math.abs(archerShareForWave(3) - 0.19) < 1e-9);
t('第 6 波弓手封顶 25%', Math.abs(archerShareForWave(6) - 0.25) < 1e-9);
t('第 10 波弓手仍 25%', Math.abs(archerShareForWave(10) - 0.25) < 1e-9);

console.log('== 箭矢抛射物 ==');
{
  // 静止目标：抛物线补偿瞄准，箭应命中
  const pool = new ArrowPool(8);
  pool.fire({ x: 0, y: 1.2, z: 20 }, { x: 0, y: 1.2, z: 0 });
  let hit = null;
  for (let i = 0; i < 120 && !hit; i++) {
    const hits = pool.update(1 / 60, [{ x: 0, z: 0, y0: 0, y1: 2.2, radius: 0.7, kind: 'player', ref: null }]);
    if (hits.length) hit = hits[0];
  }
  t('抛物线箭命中静止目标', !!hit);
  t('命中后箭回收', pool.activeCount === 0);
  // 目标横向跑开：箭打偏（闪避/走位有效）
  const pool2 = new ArrowPool(8);
  pool2.fire({ x: 0, y: 1.2, z: 20 }, { x: 0, y: 1.2, z: 0 });
  let hit2 = false;
  for (let i = 0; i < 120; i++) {
    const tx = i * 0.15; // 目标每帧横移，箭到时已不在原点
    const hits = pool2.update(1 / 60, [{ x: tx, z: 0, y0: 0, y1: 2.2, radius: 0.7, kind: 'player', ref: null }]);
    if (hits.length) hit2 = true;
  }
  t('目标横移后箭打偏', hit2 === false);
  // 箭落地回收
  const pool3 = new ArrowPool(4);
  pool3.fire({ x: 0, y: 1.2, z: 20 }, { x: 0, y: 1.2, z: 0 });
  for (let i = 0; i < 300; i++) pool3.update(1 / 60, []);
  t('箭超时/落地后回收', pool3.activeCount === 0);
  // 对象池复用：开火超过容量也不增长
  const pool4 = new ArrowPool(4);
  for (let i = 0; i < 10; i++) pool4.fire({ x: 0, y: 1.2, z: 20 }, { x: 0, y: 1.2, z: 0 });
  t('对象池满时复用最旧箭', pool4.arrows.length === 4 && pool4.activeCount === 4 && pool4.fired === 10);
  // 瞄准速度：水平分量约等于箭速
  const v = aimVelocity({ x: 0, y: 1.2, z: 20 }, { x: 0, y: 1.2, z: 0 });
  t('瞄准水平速度≈箭速', Math.abs(Math.hypot(v.vx, v.vz) - ARCHER.arrowSpeed) < 0.01);
}

console.log('== 剧情过场 ==');
t('4 段过场齐全', ['intro', 'boss', 'victory', 'defeat'].every((k) => !!CUTSCENES[k]));
t('开场 4 句', CUTSCENES.intro.lines.length === 4);
t('开场总长约 11 秒', Math.abs(cutsceneTotal(CUTSCENES.intro) - 11) < 1e-9);
t('Boss 登场 2 句约 5 秒', CUTSCENES.boss.lines.length === 2 && Math.abs(cutsceneTotal(CUTSCENES.boss) - 5) < 1e-9);
t('胜利结尾 3 句约 7 秒', CUTSCENES.victory.lines.length === 3 && Math.abs(cutsceneTotal(CUTSCENES.victory) - 7) < 1e-9);
t('败北 1 句约 2.5 秒', CUTSCENES.defeat.lines.length === 1 && Math.abs(cutsceneTotal(CUTSCENES.defeat) - 2.5) < 1e-9);
t('过场台词均非空', Object.values(CUTSCENES).every((s) => s.lines.every((l) => l.text && l.text.length > 3)));
t('过场每句都有镜头', Object.values(CUTSCENES).every((s) => s.lines.every((l) => ['gate', 'player', 'boss', 'army', 'wide'].includes(l.cam))));
{
  const r = new CutsceneRunner(CUTSCENES.intro);
  t('过场初始第 1 句', r.line === CUTSCENES.intro.lines[0] && r.done === false);
  r.tick(3.1);
  t('3.1 秒后进入第 2 句', r.index === 1 && r.line.who === '马超');
  r.tick(2.5);
  t('再 2.5 秒进入第 3 句', r.index === 2 && r.line.who === '庞德');
  t('过场进行中未播完', r.done === false);
  r.skip();
  t('跳过即播完', r.done === true && r.skipped === true);
  t('跳过后 tick 不变', (() => { r.tick(10); return r.done === true; })());
  const r2 = new CutsceneRunner(CUTSCENES.boss);
  r2.tick(10);
  t('播完自动 done', r2.done === true);
  t('空脚本直接 done', new CutsceneRunner({ lines: [] }).done === true);
}
t('URL skipintro=1 解析', parseUrlParams('?skipintro=1').skipIntro === true);
t('URL 默认不跳过场', parseUrlParams('?mode=tongguan').skipIntro === false);

console.log('== 坐骑 ==');
t('骑乘移速 ×1.6', MOUNT.speedMul === 1.6);
t('冲锋需持续移动 2 秒', MOUNT.chargeTime === 2);
t('冲锋撞击 25 伤', MOUNT.chargeDmg === 25);
t('落马阈值 20 伤', MOUNT.fallDamage === 20);
{
  const m = new MountState();
  t('初始未骑乘', m.mounted === false && m.speedMul() === 1);
  t('未骑乘不能冲刺', m.tryDash() === false);
  m.mount();
  t('上马后移速 ×1.6', m.mounted === true && m.speedMul() === 1.6);
  m.update(1 / 60, true);
  t('移动 1 帧未进入冲锋', m.chargeReady === false);
  m.update(1.0, true);
  t('移动约 1 秒未进入冲锋', m.chargeReady === false);
  m.update(1.1, true);
  t('持续移动 2 秒进入冲锋', m.chargeReady === true);
  t('冲锋撞击每敌只算一次', m.noteChargeHit(7) === true && m.noteChargeHit(7) === false && m.noteChargeHit(8) === true);
  m.update(1 / 60, false);
  t('停下即退出冲锋并清撞击记录', m.chargeReady === false && m.noteChargeHit(7) === true);
  m.update(2.1, true);
  t('重新移动 2 秒可再冲锋', m.chargeReady === true);
  t('骑乘空格冲刺触发', m.tryDash() === true && m.dashing === true);
  t('冲刺冷却内不可再冲', m.tryDash() === false);
  t('冲刺移速 ×2.2 叠加', Math.abs(m.speedMul() - 1.6 * 2.2) < 1e-9);
  m.update(3.1, true);
  t('冲刺冷却 3 秒后可再冲', m.tryDash() === true);
  m.dismount();
  t('下马后恢复步行', m.mounted === false && m.speedMul() === 1 && m.chargeReady === false);
}
t('19 伤不落马', shouldFallFromHit(19) === false);
t('20 伤落马', shouldFallFromHit(20) === true);
t('Boss 冲锋撞中必落马', shouldFallFromHit(0, true) === true);
t('弓箭 7 伤不落马', shouldFallFromHit(7) === false);

console.log('== 自适应画质 ==');
t('4 档画质', QUALITY_TIERS.length === 4);
t('档位标签高中低极低', QUALITY_TIERS.map((q) => q.label).join('/') === '高/中/低/极低');
t('档位敌数上限递减', QUALITY_TIERS[0].maxAlive === 46 && QUALITY_TIERS[1].maxAlive === 40 && QUALITY_TIERS[2].maxAlive === 32 && QUALITY_TIERS[3].maxAlive === 24);
t('低档关 Bloom', QUALITY_TIERS[2].bloom === false && QUALITY_TIERS[2].shadows === false);
t('仅极低档关后期', QUALITY_TIERS[2].post === true && QUALITY_TIERS[3].post === false);
t('高档像素比 2、阴影开', QUALITY_TIERS[0].pixelRatio === 2 && QUALITY_TIERS[0].shadows === true);
t('手动 low 固定极低档', MANUAL_TIER.low === 3);
t('手动 high 固定高档', MANUAL_TIER.high === 0);
t('手动 medium 固定中档', MANUAL_TIER.medium === 1);
{
  const a = new AdaptiveQuality('auto');
  t('自动模式初始高档', a.tier === 0 && a.isAuto === true);
  t('低帧 1 秒不降档', a.update(20, 1) === null && a.tier === 0);
  t('低帧累计 3 秒降一档', a.update(20, 1) === null && a.update(20, 1) === 1 && a.tier === 1);
  t('继续低帧再降一档', a.update(20, 3) === 2);
  t('低帧到底不越界', a.update(20, 3) === 3 && a.update(20, 3) === null && a.tier === 3);
  t('中帧 40 不升不降', a.update(40, 5) === null && a.tier === 3);
  t('高帧 8 秒升一档', a.update(60, 8) === 2 && a.tier === 2);
  t('高帧不足 8 秒不升档', a.update(60, 4) === null && a.tier === 2);
  const b = new AdaptiveQuality('high');
  t('手动 high 低帧也不降档', b.update(10, 10) === null && b.tier === 0);
  const c = new AdaptiveQuality('auto');
  c.setMode('low');
  t('切手动 low 立即极低档', c.tier === 3 && c.isAuto === false);
  t('手动 low 低帧不动', c.update(10, 10) === null && c.tier === 3);
  c.setMode('auto');
  t('切回自动保留当前档', c.tier === 3 && c.isAuto === true);
  t('切回自动后高帧可升档', c.update(60, 8) === 2);
}
t('URL 默认画质自动', parseUrlParams('?mode=tongguan').qualityMode === 'auto');
t('URL quality=low 解析', parseUrlParams('?quality=low').qualityMode === 'low' && parseUrlParams('?quality=low').quality === 'low');
t('URL quality=medium 解析', parseUrlParams('?quality=medium').qualityMode === 'medium');
t('URL quality=high 解析', parseUrlParams('?quality=high').qualityMode === 'high');
t('URL quality 非法值回退自动', parseUrlParams('?quality=xxx').qualityMode === 'auto');

console.log('== 玩家远程攻击 ==');
t('4 名武将远程各不相同', RANGED.machao.kind !== RANGED.zhouyu.kind && RANGED.sunce.kind !== RANGED.dianwei.kind);
t('周瑜火矢带灼烧', RANGED.zhouyu.kind === 'fire' && RANGED.zhouyu.burnDps === 6 && RANGED.zhouyu.burnDur === 3 && RANGED.zhouyu.burnRadius === 2.2);
t('马超投枪 28 伤 26 米 2.2 秒冷却', RANGED.machao.dmg === 28 && RANGED.machao.range === 26 && RANGED.machao.cd === 2.2);
t('孙策飞矛 3 发扇形', RANGED.sunce.count === 3 && RANGED.sunce.spread === 0.22 && RANGED.sunce.range === 20);
t('典韦飞戟 40 伤 14 米', RANGED.dianwei.dmg === 40 && RANGED.dianwei.range === 14 && RANGED.dianwei.cd === 2.8);
t('周瑜火矢射程最远 30 米冷却最短', RANGED.zhouyu.range === 30 && RANGED.zhouyu.cd === 1.4);
t('远程池 32 支', RANGED_POOL_SIZE === 32);
t('rangedSpec 未知武将回退马超', rangedSpec('xxx').kind === 'spear');
{
  const r = new RangedState('zhouyu');
  t('周瑜远程初始就绪', r.ready === true && r.spec.kind === 'fire');
  t('发射后进入冷却', r.tryFire() !== null && r.ready === false);
  t('冷却中不可再发射', r.tryFire() === null);
  r.update(0.7);
  t('冷却 0.7 秒后仍未就绪', r.ready === false);
  r.update(0.8);
  t('冷却 1.5 秒后就绪', r.ready === true);
  t('骑乘射程 ×0.85', Math.abs(r.effectiveRange(true) - 30 * 0.85) < 1e-9);
  t('步行射程不变', r.effectiveRange(false) === 30);
  const s = new RangedState('sunce');
  t('孙策扇形 3 个方向', s.fireDirections(0).length === 3);
  t('扇形中间一发正中', Math.abs(s.fireDirections(0)[1].x - 0) < 1e-9 && s.fireDirections(0)[1].z === 1);
  t('骑乘散布更大', s.fireDirections(0, true)[0].x < s.fireDirections(0, false)[0].x);
  const m = new RangedState('machao');
  t('马超单发无散布', m.fireDirections(0).length === 1);
  m.setChar('dianwei');
  t('换将后远程配置跟随', m.spec.kind === 'heavy' && m.ready === true);
}
console.log('== 玩家弹丸池 ==');
{
  const pool = new PlayerShotPool(4);
  const spec = RANGED.machao;
  pool.fire({ x: 0, y: 1.4, z: 20 }, { x: 0, z: -1 }, spec, 28);
  let hit = null;
  for (let i = 0; i < 120 && !hit; i++) {
    const hits = pool.update(1 / 60, [{ x: 0, z: 0, y0: 0, y1: 2.2, radius: 0.85, kind: 'soldier', ref: null }]);
    if (hits.length) hit = hits[0];
  }
  t('投枪命中静止敌兵', !!hit && hit.shot.dmg === 28);
  t('命中后弹丸回收', pool.activeCount === 0);
  // 火矢带灼烧字段
  const pool2 = new PlayerShotPool(4);
  const f = pool2.fire({ x: 0, y: 1.4, z: 0 }, { x: 0, z: -1 }, RANGED.zhouyu, 16);
  t('火矢保留灼烧参数', f.burnDps === 6 && f.burnDur === 3 && f.burnRadius === 2.2);
  // 池满复用
  const pool3 = new PlayerShotPool(4);
  for (let i = 0; i < 10; i++) pool3.fire({ x: 0, y: 1.4, z: 0 }, { x: 0, z: -1 }, RANGED.machao, 28);
  t('弹丸池满时复用最旧', pool3.shots.length === 4 && pool3.activeCount === 4 && pool3.fired === 10);
  // 超时回收
  const pool4 = new PlayerShotPool(4);
  pool4.fire({ x: 0, y: 1.4, z: 0 }, { x: 0, z: -1 }, RANGED.machao, 28);
  for (let i = 0; i < 300; i++) pool4.update(1 / 60, []);
  t('弹丸超时后回收', pool4.activeCount === 0);
}
console.log('== 灼烧区 ==');
{
  const z = new BurnZone(0, 0, 2.2, 6, 3);
  t('灼烧初始存活', z.alive === true);
  t('灼烧每 tick 3 伤', z.tickDamage === 3);
  t('0.4 秒不 tick', z.update(0.4) === false);
  t('0.5 秒 tick 一次', z.update(0.1) === true);
  z.update(2.6);
  t('3 秒后灼烧结束', z.alive === false);
}

console.log('== MSAA / DoF 档位 ==');
t('高档 MSAA 4x 且开 DoF', QUALITY_TIERS[0].msaa === 4 && QUALITY_TIERS[0].dof === true);
t('中档 MSAA 2x 关 DoF', QUALITY_TIERS[1].msaa === 2 && QUALITY_TIERS[1].dof === false);
t('低档 MSAA 0 关 DoF', QUALITY_TIERS[2].msaa === 0 && QUALITY_TIERS[2].dof === false);
t('极低档 MSAA 0 关 DoF', QUALITY_TIERS[3].msaa === 0 && QUALITY_TIERS[3].dof === false);
t('URL dof=on 解析', parseUrlParams('?dof=on').dof === true);
t('URL dof=off 解析', parseUrlParams('?dof=off').dof === false);
t('URL 默认 dof 跟随档位', parseUrlParams('?mode=tongguan').dof === null);
t('URL msaa=4 解析', parseUrlParams('?msaa=4').msaa === 4);
t('URL msaa=2 解析', parseUrlParams('?msaa=2').msaa === 2);
t('URL msaa 非法值回退跟随档位', parseUrlParams('?msaa=8').msaa === null && parseUrlParams('?msaa=xxx').msaa === null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
