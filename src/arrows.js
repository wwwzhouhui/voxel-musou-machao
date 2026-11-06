// ============================================================
// voxel-musou-machao · src/arrows.js
// 弓手抛射物：纯逻辑（无 Three.js 依赖，可用 node 直接回归测试）
// 弹道：直线初速 + 重力抛物线；开火时按落点补偿仰角（瞄准静止目标必中，
// 移动目标会打偏——这正是闪避/走位的意义）。箭矢用固定对象池复用。
// ============================================================
import { ARCHER } from './config.js';

/** 弓手 AI 决策（纯函数）：按与目标距离返回行为 */
export function archerDecision(dist, atkCd) {
  if (dist < ARCHER.rangeMin) return 'retreat';
  if (dist > ARCHER.rangeMax) return 'approach';
  if (atkCd <= 0) return 'aim';
  return 'hold';
}

/** 计算命中静止目标所需的初速度（含重力补偿） */
export function aimVelocity(from, to, speed = ARCHER.arrowSpeed, g = ARCHER.gravity) {
  const dx = to.x - from.x, dy = (to.y ?? 1.2) - (from.y ?? 1.2), dz = to.z - from.z;
  const horiz = Math.hypot(dx, dz);
  const t = Math.max(0.05, horiz / speed); // 水平分量按全速飞，飞行时间由此定
  const vx = horiz > 0.001 ? (dx / horiz) * speed : 0;
  const vz = horiz > 0.001 ? (dz / horiz) * speed : 0;
  const vy = (dy + 0.5 * g * t * t) / t;
  return { vx, vy, vz, flightTime: t };
}

export class ArrowPool {
  constructor(cap = ARCHER.poolSize) {
    this.cap = cap;
    this.arrows = [];
    for (let i = 0; i < cap; i++) {
      this.arrows.push({
        active: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
        life: 0, dmg: ARCHER.damage, kind: 'player', seq: 0,
      });
    }
    this._next = 0; // 循环复用指针：池满时复用最旧的箭
    this.fired = 0;
  }

  get activeCount() { let n = 0; for (const a of this.arrows) if (a.active) n++; return n; }

  /** 开火：from {x,y,z}，to {x,y,z} 为瞄准点；返回箭对象或 null */
  fire(from, to, dmg = ARCHER.damage) {
    const a = this.arrows[this._next];
    this._next = (this._next + 1) % this.cap;
    const v = aimVelocity(from, to);
    Object.assign(a, {
      active: true, x: from.x, y: from.y ?? 1.2, z: from.z,
      vx: v.vx, vy: v.vy, vz: v.vz, life: 3, dmg, seq: ++this.fired,
    });
    return a;
  }

  /**
   * 推进一帧。targets: [{x, z, y0, y1, radius, kind, ref}]
   * 返回命中列表 [{arrow, target}]；命中/落地/超时的箭自动回收。
   */
  update(dt, targets = []) {
    const hits = [];
    for (const a of this.arrows) {
      if (!a.active) continue;
      a.life -= dt;
      a.vy -= ARCHER.gravity * dt;
      a.x += a.vx * dt; a.y += a.vy * dt; a.z += a.vz * dt;
      let done = a.life <= 0 || a.y <= 0.02;
      if (!done) {
        for (const t of targets) {
          const dx = a.x - t.x, dz = a.z - t.z;
          if (dx * dx + dz * dz > t.radius * t.radius) continue;
          if (a.y < (t.y0 ?? 0) || a.y > (t.y1 ?? 2.2)) continue;
          hits.push({ arrow: a, target: t });
          done = true;
          break;
        }
      }
      if (done) a.active = false;
    }
    return hits;
  }

  clear() { for (const a of this.arrows) a.active = false; }
}
