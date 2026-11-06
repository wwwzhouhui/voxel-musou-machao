// ============================================================
// voxel-musou-machao · src/player-shots.js
// 玩家远程攻击：纯逻辑（无 Three.js 依赖，可用 node 直接回归测试）
// 按 Q 发射，按武将取 RANGED 配置：马超投枪 / 孙策飞矛扇形 / 周瑜火矢+灼烧 / 典韦飞戟。
// 与敌方箭矢（arrows.js）共用“抛物线瞄准 + 对象池”思路，但用独立的
// PlayerShotPool（32 支），不与敌箭池互相抢池；骑乘时射程 ×0.85、散布 +0.05。
// 弹道：直线初速 + 小重力（火矢几乎平飞、投枪/飞戟略带抛物线），命中即回收。
// ============================================================
import { RANGED, RANGED_POOL_SIZE } from './config.js';

export { RANGED, RANGED_POOL_SIZE };

export function rangedSpec(charId) {
  return RANGED[charId] || RANGED.machao;
}

/** 远程冷却状态机：tryFire 成功才进入冷却 */
export class RangedState {
  constructor(charId = 'machao') {
    this.charId = charId;
    this.spec = rangedSpec(charId);
    this.cd = 0;
  }

  setChar(charId) {
    this.charId = charId;
    this.spec = rangedSpec(charId);
    this.cd = 0;
  }

  update(dt) { this.cd = Math.max(0, this.cd - dt); }

  get ready() { return this.cd <= 0; }
  get cooldown() { return this.spec.cd; }

  /** 骑乘时的有效射程 / 散布 */
  effectiveRange(mounted = false) {
    return this.spec.range * (mounted ? 0.85 : 1);
  }

  /** 发射方向：count>1 时扇形散布（中间一发正中，两侧按 spread 偏转） */
  fireDirections(facing, mounted = false) {
    const spread = this.spec.spread + (mounted ? 0.05 : 0);
    const dirs = [];
    const n = this.spec.count;
    for (let i = 0; i < n; i++) {
      const off = n === 1 ? 0 : (i - (n - 1) / 2) * spread;
      const a = facing + off;
      dirs.push({ x: Math.sin(a), z: Math.cos(a) });
    }
    return dirs;
  }

  tryFire() {
    if (!this.ready) return null;
    this.cd = this.spec.cd;
    return this.spec;
  }
}

export class PlayerShotPool {
  constructor(cap = RANGED_POOL_SIZE) {
    this.cap = cap;
    this.shots = [];
    for (let i = 0; i < cap; i++) {
      this.shots.push({
        active: false, kind: 'spear', x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
        life: 0, dmg: 0, color: 0xffffff, burnDps: 0, burnDur: 0, burnRadius: 0,
        seq: 0, hitBoss: false,
      });
    }
    this._next = 0;
    this.fired = 0;
  }

  get activeCount() { let n = 0; for (const s of this.shots) if (s.active) n++; return n; }

  /** 开火：from {x,y,z}，dir {x,z} 为水平方向，spec 为 RANGED 配置 */
  fire(from, dir, spec, dmg) {
    const s = this.shots[this._next];
    this._next = (this._next + 1) % this.cap;
    const len = Math.hypot(dir.x, dir.z) || 1;
    const nx = dir.x / len, nz = dir.z / len;
    Object.assign(s, {
      active: true, kind: spec.kind,
      x: from.x + nx * 0.8, y: (from.y ?? 1.4), z: from.z + nz * 0.8,
      vx: nx * spec.speed, vy: 0, vz: nz * spec.speed,
      life: spec.range / spec.speed + 0.6,
      dmg, color: spec.color,
      burnDps: spec.burnDps || 0, burnDur: spec.burnDur || 0, burnRadius: spec.burnRadius || 0,
      seq: ++this.fired, hitBoss: false,
    });
    s._gravity = spec.gravity ?? 5;
    return s;
  }

  /**
   * 推进一帧。targets: [{x, z, y0, y1, radius, kind, ref}]
   * 返回命中列表 [{shot, target}]；命中/落地/超时的弹丸自动回收。
   */
  update(dt, targets = []) {
    const hits = [];
    for (const s of this.shots) {
      if (!s.active) continue;
      s.life -= dt;
      s.vy -= (s._gravity ?? 5) * dt;
      s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
      let done = s.life <= 0 || s.y <= 0.02;
      if (!done) {
        for (const t of targets) {
          const dx = s.x - t.x, dz = s.z - t.z;
          if (dx * dx + dz * dz > t.radius * t.radius) continue;
          if (s.y < (t.y0 ?? 0) || s.y > (t.y1 ?? 3.2)) continue;
          hits.push({ shot: s, target: t });
          done = true;
          break;
        }
      }
      if (done) s.active = false;
    }
    return hits;
  }

  clear() { for (const s of this.shots) s.active = false; }
}

/** 灼烧区：火矢落点持续伤害（纯逻辑，游戏层每 0.5 秒 tick 一次） */
export class BurnZone {
  constructor(x, z, radius, dps, dur) {
    this.x = x; this.z = z; this.radius = radius; this.dps = dps;
    this.left = dur; this.tickT = 0;
  }

  /** 返回本帧是否应 tick（每 0.5 秒一次，tick 伤害 = dps*0.5） */
  update(dt) {
    this.left -= dt;
    this.tickT += dt;
    if (this.tickT >= 0.5) { this.tickT -= 0.5; return this.left > -0.5; }
    return false;
  }

  get alive() { return this.left > 0; }
  get tickDamage() { return this.dps * 0.5; }
}
