// ============================================================
// voxel-musou-machao · src/config.js
// 全局配置：武将、数值、关卡、平衡参数（全部原创数值与文案）
// ============================================================

export const VERSION = '0.9.0-mvp';

// ---------- 武将 ----------
export const CHARACTERS = {
  machao: {
    id: 'machao', name: '马超', title: '锦马超', era: '西凉',
    weaponName: '龙骑银枪', weaponType: 'spear',
    musouName: '西凉铁骑 · 破阵', musouDesc: '银枪横扫八方，化作铁骑洪流冲垮敌阵',
    colors: {
      armor: 0xdfe6ea, armorDark: 0x9fb2bd, cloth: 0xb02020, clothDark: 0x7a1414,
      skin: 0xf0c08c, hair: 0x1a1a1a, helmet: 0xe8eef2, plume: 0xc8102e,
      trim: 0xd8a928, boots: 0x4a3226, weapon: 0xc9d4dc, weaponGlow: 0xffffff,
    },
    stats: { hp: 120, atk: 1.0, speed: 9.2, range: 3.4, musouGain: 1.0 },
    desc: '扶风茂陵人，面如冠玉，目如流星。潼关一战杀得曹操割须弃袍。枪法如银龙出海，连段迅捷、范围开阔。',
  },
  sunce: {
    id: 'sunce', name: '孙策', title: '江东小霸王', era: '江东',
    weaponName: '霸王铁枪', weaponType: 'spear',
    musouName: '江东猛虎 · 啸林', musouDesc: '猛虎下山，枪影如林，近身敌军尽数震飞',
    colors: {
      armor: 0x2e6b34, armorDark: 0x1d4a22, cloth: 0xd8a928, clothDark: 0x8a6d1c,
      skin: 0xe8b07e, hair: 0x241a12, helmet: 0x3a7d44, plume: 0xffd23e,
      trim: 0xc8102e, boots: 0x3a2a1a, weapon: 0x8a8f96, weaponGlow: 0xffe9a8,
    },
    stats: { hp: 135, atk: 1.12, speed: 8.6, range: 3.2, musouGain: 0.95 },
    desc: '江东猛虎，十七岁便纵横沙场。枪势大开大合，伤害更高，尤擅以力破巧。',
  },
  zhouyu: {
    id: 'zhouyu', name: '周瑜', title: '美周郎', era: '江东',
    weaponName: '白羽扇 · 业火', weaponType: 'fan',
    musouName: '赤壁业火 · 燎原', musouDesc: '羽扇轻摇引来赤壁业火，灼烧整片战场',
    colors: {
      armor: 0xf2ead8, armorDark: 0xcbbd97, cloth: 0x1e4d6b, clothDark: 0x12334a,
      skin: 0xf0c08c, hair: 0x1a1a1a, helmet: 0x2a2a2a, plume: 0xffffff,
      trim: 0xd8a928, boots: 0x2a2118, weapon: 0xf5f2e8, weaponGlow: 0xff7a1a,
    },
    stats: { hp: 105, atk: 0.9, speed: 8.8, range: 3.8, musouGain: 1.15 },
    desc: '羽扇纶巾，谈笑间樯橹灰飞烟灭。羽扇挥出火浪，攻击范围最远，无双积攒最快。',
  },
  dianwei: {
    id: 'dianwei', name: '典韦', title: '古之恶来', era: '曹营',
    weaponName: '双铁戟', weaponType: 'axes',
    musouName: '恶来咆哮 · 撼地', musouDesc: '双戟撼地，冲击波席卷四方，敌军人仰马翻',
    colors: {
      armor: 0x3a3f4a, armorDark: 0x23262e, cloth: 0x6b1e1e, clothDark: 0x471414,
      skin: 0xd89a6a, hair: 0x0d0d0d, helmet: 0x2c2f38, plume: 0x000000,
      trim: 0xb08d3e, boots: 0x241a12, weapon: 0x5a5f6a, weaponGlow: 0xffd23e,
    },
    stats: { hp: 160, atk: 1.25, speed: 7.6, range: 2.8, musouGain: 0.9 },
    desc: '古之恶来，力大无穷。双戟一击千钧，单发伤害全队最高，唯速度稍逊。',
  },
};

export const CHARACTER_ORDER = ['machao', 'sunce', 'zhouyu', 'dianwei'];

// ---------- 敌军 ----------
export const ENEMY_TYPES = {
  soldier: { name: '曹军士卒', hp: 22, atk: 6, speed: 3.2, scale: 1.0, score: 1, musou: 2.2 },
  spearman: { name: '曹军长枪兵', hp: 30, atk: 8, speed: 2.8, scale: 1.05, score: 1, musou: 2.6 },
  archer: { name: '曹军弓手', hp: 16, atk: 7, speed: 3.0, scale: 0.98, score: 1, musou: 2.4 },
  elite: { name: '曹军精锐', hp: 55, atk: 11, speed: 3.6, scale: 1.12, score: 2, musou: 4 },
  officer: { name: '曹军裨将', hp: 150, atk: 14, speed: 4.2, scale: 1.18, score: 10, musou: 12 },
};

export const BOSS = {
  id: 'caocao', name: '曹操', title: '魏王 · 奸雄',
  hp: 1400, atk: 18, speed: 4.6, scale: 1.35,
  colors: {
    armor: 0x4a2a6b, armorDark: 0x2e1a44, cloth: 0xd8a928, clothDark: 0x8a6d1c,
    skin: 0xe8b07e, hair: 0x8a8a8a, helmet: 0x6b3fa0, plume: 0xffd23e,
    trim: 0xffd23e, boots: 0x2a1a2a, weapon: 0x9fb2bd, weaponGlow: 0xb06bd8,
  },
  desc: '割须弃袍之辱，今日必报！',
};

// ---------- 地图 ----------
// 两张独立地图：tongguan 为南北向峡谷 + 北端关墙；yangping 为开阔营寨平原，
// 东有河流木桥、西有粮仓、南有隘口、中央营寨带缺口木栅，布局与潼关完全不同。
export const MAPS = {
  tongguan: {
    id: 'tongguan', name: '潼关峡谷', label: '潼关峡谷 · 白昼',
    desc: '南北向峡谷，北端关墙 + 箭塔，大道贯穿全场，两侧山体夹峙。',
    variant: 'day', night: false,
  },
  yangping: {
    id: 'yangping', name: '阳平关夜战', label: '阳平关 · 夜战',
    desc: '开阔营寨平原：中央木栅营寨、东侧河流与木桥、西侧粮仓、南侧隘口、北侧山岗。夜战，火把为主要光源。',
    variant: 'night', night: true,
  },
};
export const MAP_ORDER = ['tongguan', 'yangping'];

// ---------- 弓手 ----------
export const ARCHER = {
  rangeMin: 10, rangeMax: 26,   // 射程：太近后退，太远靠近
  aimTime: 0.75,                // 拉弓前摇（秒），期间弓身发光，可被攻击打断
  arrowSpeed: 26,               // 箭初速（米/秒）
  gravity: 9.8,                 // 抛物线重力；瞄准时按落点补偿仰角
  poolSize: 48,                 // 箭矢对象池上限
  damage: 7,                    // 与 ENEMY_TYPES.archer.atk 一致
};
// 每波弓手占比：15% 起，随波次 +2%，上限 25%
export function archerShareForWave(wave) {
  return Math.min(0.25, 0.15 + Math.max(0, wave - 1) * 0.02);
}

// ---------- 玩家远程攻击（Q 键） ----------
// 每名武将一招远程，数值均为绝对伤害（近战一段约 10×atk）：
// 马超投枪单发高伤、孙策飞矛 3 发扇形、周瑜火矢单发 + 落点灼烧、典韦飞戟近距重伤。
// 骑乘时射程 ×0.85、散布 +0.05（骑射精度略降）；冷却与无双联动：命中 +3~4 无双。
export const RANGED = {
  machao: { name: '投枪', kind: 'spear', count: 1, dmg: 28, speed: 34, range: 26, cd: 2.2, spread: 0, gravity: 5, color: 0xd8dee2, burnDps: 0, burnDur: 0, burnRadius: 0, musouGain: 4 },
  sunce: { name: '飞矛', kind: 'fan', count: 3, dmg: 14, speed: 30, range: 20, cd: 1.8, spread: 0.22, gravity: 5, color: 0xd8a928, burnDps: 0, burnDur: 0, burnRadius: 0, musouGain: 3 },
  zhouyu: { name: '火矢', kind: 'fire', count: 1, dmg: 16, speed: 32, range: 30, cd: 1.4, spread: 0, gravity: 2, color: 0xff7a1a, burnDps: 6, burnDur: 3, burnRadius: 2.2, musouGain: 4 },
  dianwei: { name: '飞戟', kind: 'heavy', count: 1, dmg: 40, speed: 24, range: 14, cd: 2.8, spread: 0, gravity: 6, color: 0x8a8f96, burnDps: 0, burnDur: 0, burnRadius: 0, musouGain: 3 },
};
export const RANGED_POOL_SIZE = 32;

// ---------- 坐骑 ----------
export const MOUNT = {
  speedMul: 1.6,      // 骑乘移速倍率
  turnRate: 4.0,      // 骑乘转向角速度上限（弧度/秒，转向变钝）
  chargeTime: 2,      // 持续移动这么多秒后进入冲锋态
  chargeDmg: 25,      // 冲锋撞击伤害
  chargeKb: 14,       // 冲锋撞击击退
  chargeRange: 2.6,   // 冲锋撞击判定半径
  fallDamage: 20,     // 单次受击 ≥ 此伤害即落马（Boss 冲锋 25.2 必落马）
  dashTime: 0.5,      // 骑乘空格冲刺持续
  dashCd: 3,          // 骑乘冲刺冷却
  dashMul: 2.2,       // 冲刺移速倍率（叠加在骑乘倍率上）
  attackRangeMul: 1.15, // 骑乘攻击范围倍率（马上横扫略大）
};

// ---------- 关卡 ----------
export const CHAPTERS = {
  tongguan: {
    id: 'tongguan', name: '第一章 · 潼关之战', year: '建安十六年（211年）',
    desc: '马超联军据潼关，曹操亲率大军来攻。先斩敌军六十，再于关前与曹操决一死战！',
    variant: 'day', killTarget: 60, bossAfterKills: 60,
    waves: [14, 18, 22, 26],
    briefing: '马超：「曹操老贼，今日潼关便是你的葬身之地！」\n庞德：「少将军，末将愿为先锋！」',
  },
  endless: {
    id: 'endless', name: '自由演武 · 无尽波次', year: '演武场',
    desc: '敌军如潮水般涌来，看看你能坚持多少波、斩杀多少人！',
    variant: 'dusk', killTarget: Infinity, bossAfterKills: Infinity,
    waves: null, briefing: '演武开始，敌军无穷无尽——战至最后一刻！',
  },
  trial: {
    id: 'trial', name: '千人斩试炼', year: '演武场 · 限时',
    desc: '三分钟内斩杀一千人？不，先以二百四十斩为目标，冲击你的极限！',
    // 240 斩：第四阶段平衡探针实测，改进后自动战斗机器人（J/K/Q 正常轮换，
    // 不用无双、不会钻人堆）7.5 游戏秒斩 9 人（1.20/秒），3 分钟外推 216 斩；
    // 机器人不用无双（每轮约 4 次无双可多清 ~30 人）且不走位聚怪，真人用蓄力
    // 范围攻击 + 无双可轻松超过 240；原 300 斩在自动战斗下明显不可达，故下调。
    variant: 'night', killTarget: 240, timeLimit: 180, bossAfterKills: Infinity,
    waves: null, briefing: '三分钟，计时开始——让千人斩之名响彻演武场！',
  },
};

// ---------- 平衡 ----------
export const BALANCE = {
  player: { baseHp: 120, dodgeCooldown: 0.9, dodgeIframes: 0.32, dodgeSpeed: 26, dodgeTime: 0.22,
            jumpVel: 9.5, gravity: -26, musouDuration: 6, musouCost: 100 },
  // N1..N6 连段：伤害倍率 / 出招时长(s) / 攻击距离 / 扇形角度 / 击退
  combo: [
    { dmg: 1.0, dur: 0.26, range: 3.2, arc: 1.9, kb: 3.5 },
    { dmg: 1.0, dur: 0.26, range: 3.2, arc: 1.9, kb: 3.5 },
    { dmg: 1.2, dur: 0.30, range: 3.4, arc: 2.1, kb: 5.0 },
    { dmg: 1.2, dur: 0.30, range: 3.4, arc: 2.1, kb: 5.0 },
    { dmg: 1.5, dur: 0.34, range: 3.6, arc: 2.3, kb: 7.0 },
    { dmg: 2.2, dur: 0.42, range: 4.0, arc: 2.6, kb: 12.0 },
  ],
  // C 蓄力终结：按当前连段阶数 C1..C6
  charge: [
    { dmg: 1.8, range: 3.6, arc: 2.4, kb: 10, aoe: 0 },
    { dmg: 2.0, range: 3.8, arc: 2.4, kb: 11, aoe: 0 },
    { dmg: 2.4, range: 4.0, arc: 2.6, kb: 13, aoe: 1 },
    { dmg: 2.8, range: 4.2, arc: 2.6, kb: 14, aoe: 1 },
    { dmg: 3.4, range: 4.6, arc: 2.8, kb: 16, aoe: 1 },
    { dmg: 4.5, range: 5.2, arc: 3.0, kb: 20, aoe: 2 },
  ],
  airAtk: { dmg: 1.4, dur: 0.3, range: 3.2, arc: 2.2, kb: 8 },
  musouAtk: { dmg: 6.0, range: 7.0, arc: 6.29, kb: 22 },
  dropChance: 0.12, dropHeal: 25,
  comboWindow: 0.55,       // 连段可衔接窗口
  hitstop: { light: 0.035, heavy: 0.07, musou: 0.12 },
  camera: { dist: 9.5, height: 4.6, lerp: 8 },
  world: { size: 120, bound: 52 },  // 战场半宽
  spawn: { interval: 0.55, batch: 2, maxAlive: 60 },
};

// ---------- 评级 ----------
export function gradeFor({ kills, damageTaken, timeSec, died }) {
  if (died) return 'C';
  let s = 0;
  if (kills >= 300) s += 2; else if (kills >= 100) s += 1;
  if (damageTaken <= 0) s += 2; else if (damageTaken < 100) s += 1;
  if (timeSec > 0 && timeSec <= 300) s += 1;
  return s >= 4 ? 'S' : s >= 3 ? 'A' : s >= 1 ? 'B' : 'C';
}

export function parseUrlParams(search = location.search) {
  const p = new URLSearchParams(search);
  const enemies = Math.max(20, Math.min(600, parseInt(p.get('enemies') || '220', 10) || 220));
  const char = CHARACTERS[p.get('char')] ? p.get('char') : 'machao';
  const mode = CHAPTERS[p.get('mode')] ? p.get('mode') : 'tongguan';
  // 画质模式：?quality=low|medium|high 为手动固定档，auto 或缺省为自动自适应
  const qRaw = (p.get('quality') || 'auto').toLowerCase();
  const qualityMode = ['low', 'medium', 'high', 'auto'].includes(qRaw) ? qRaw : 'auto';
  const quality = qualityMode === 'low' ? 'low' : 'high';
  const skipIntro = p.get('skipintro') === '1';
  // 景深 / MSAA 手动覆盖：?dof=on|off、?msaa=0|2|4；缺省为 null，跟随画质档位
  const dofRaw = (p.get('dof') || '').toLowerCase();
  const dof = dofRaw === 'on' ? true : dofRaw === 'off' ? false : null;
  const msaaRaw = parseInt(p.get('msaa') || '', 10);
  const msaa = [0, 2, 4].includes(msaaRaw) ? msaaRaw : null;
  const map = MAPS[p.get('map')] ? p.get('map') : 'tongguan';
  // 后期：post=off 关闭；post=pixel 开像素风（Bloom 仍开）；post=bloom 只开 Bloom；默认 on = Bloom
  const postRaw = p.get('post') || 'on';
  const post = postRaw === 'off' ? { enabled: false, bloom: false, pixel: false }
    : postRaw === 'pixel' ? { enabled: true, bloom: true, pixel: true }
    : postRaw === 'bloom' ? { enabled: true, bloom: true, pixel: false }
    : { enabled: true, bloom: true, pixel: false };
  return { enemies, char, mode, quality, qualityMode, skipIntro, map, post, dof, msaa };
}
