// ============================================================
// voxel-musou-machao · src/mount.js
// 坐骑：纯逻辑（无 Three.js 依赖，可用 node 直接回归测试）
// 马超配白马，其余武将配色区分（见 voxel.js buildHorse）。
// 骑乘：移速 ×1.6、转向变钝（角速度上限）、攻击范围 ×1.15；
// 空格改为冲刺爆发（0.5 秒 ×2.2，冷却 3 秒）；闪避改为马上短冲（无敌帧保留）。
// 持续移动 2 秒进入冲锋态，撞中小兵造成击飞伤害，每敌每轮冲锋只算一次；
// 受重击（单次 ≥20 伤，如 Boss 冲锋 25.2）或 Boss 冲锋撞中即落马。
// ============================================================
import { MOUNT } from './config.js';

export class MountState {
  constructor() {
    this.mounted = false;
    this.moveTime = 0;      // 本次持续移动时间（秒）
    this.dashT = 0;         // 冲刺剩余时间
    this.dashCd = 0;        // 冲刺冷却
    this.chargeHits = new Set(); // 本轮冲锋已撞过的敌人 id
    this.bossCharged = false;    // 本轮冲锋是否已撞过 Boss
  }

  get chargeReady() { return this.mounted && this.moveTime >= MOUNT.chargeTime; }
  get dashing() { return this.dashT > 0; }

  mount() {
    this.mounted = true;
    this.moveTime = 0;
    this.dashT = 0;
    this.dashCd = 0;
    this.chargeHits.clear();
    this.bossCharged = false;
  }

  dismount() {
    this.mounted = false;
    this.moveTime = 0;
    this.dashT = 0;
    this.chargeHits.clear();
    this.bossCharged = false;
  }

  /** 每模拟步调用：moving 为本帧是否在移动 */
  update(dt, moving) {
    this.dashCd = Math.max(0, this.dashCd - dt);
    if (this.dashT > 0) this.dashT = Math.max(0, this.dashT - dt);
    if (!this.mounted) { this.moveTime = 0; return; }
    if (moving) {
      const wasReady = this.chargeReady;
      this.moveTime += dt;
      if (!wasReady && this.chargeReady) { this.chargeHits.clear(); this.bossCharged = false; }
    } else {
      this.moveTime = 0;
      this.chargeHits.clear();
      this.bossCharged = false;
    }
  }

  /** 空格：骑乘冲刺。返回是否成功触发 */
  tryDash() {
    if (!this.mounted || this.dashCd > 0) return false;
    this.dashT = MOUNT.dashTime;
    this.dashCd = MOUNT.dashCd;
    return true;
  }

  /** 冲锋撞击去重：本轮冲锋每敌只算一次 */
  noteChargeHit(id) {
    if (this.chargeHits.has(id)) return false;
    this.chargeHits.add(id);
    return true;
  }

  /** 当前移速倍率（骑乘 1.6，冲刺再 ×2.2） */
  speedMul() {
    if (!this.mounted) return 1;
    return MOUNT.speedMul * (this.dashing ? MOUNT.dashMul : 1);
  }
}

/** 是否应落马：单次重击 ≥20，或 Boss 冲锋撞中 */
export function shouldFallFromHit(dmg, isBossCharge = false) {
  return isBossCharge || dmg >= MOUNT.fallDamage;
}
