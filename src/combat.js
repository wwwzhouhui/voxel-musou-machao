// ============================================================
// voxel-musou-machao · src/combat.js
// 纯逻辑连招状态机（无 Three.js 依赖，可用 node 直接回归测试）
// N1-N6 普攻连段 / C1-C6 蓄力终结 / 空中攻击 / 闪避 / 无双
// ============================================================
import { BALANCE } from './config.js';

export const COMBO_WINDOW = BALANCE.comboWindow;

/** 霸体窗口判定（纯函数，可 node 自检）：当前出招种类/阶数是否落在配置窗口内 */
export function inSuperArmorWindow(armor, kind, stage) {
  if (!armor || !Array.isArray(armor.windows)) return false;
  return armor.windows.some((w) => w.kind === kind && w.stages.includes(stage));
}

/**
 * 状态：
 *  idle      可行动
 *  attack    出招中（stageT 倒计时，结束 → recovery 窗口）
 *  charge    蓄力终结出招中
 *  air       空中攻击
 *  dodge     闪避（无敌帧）
 *  musou     无双爆发（持续状态，攻击强化）
 *  stagger   受击硬直
 *
 * 霸体（第五阶段）：构造时传入武将 superArmor 配置；出招窗口内受击不打断、
 * 不硬直（takeHit 返回 'armor'，伤害照常扣、按配置 dmgMul 减伤）；无双期间
 * 本就全免疫（invulnerable），等同霸体且更强。霸体只在窗口内生效，非全程。
 * 受击无敌帧（第五阶段）：一次受击命中后 hurtT 秒内不再受击，防多敌同帧
 * 连打造成无限硬直锁死；hurtT 长于硬直 0.28 秒，覆盖受击后摇。
 */
export class ComboMachine {
  constructor(armor = null) {
    this.armor = armor || null;
    this.reset();
  }

  reset() {
    this.state = 'idle';
    this.stage = 0;        // 当前连段阶数 0..6
    this.stageT = 0;       // 当前招式剩余时间
    this.windowT = 0;      // 招式结束后的衔接窗口
    this.dodgeT = 0;
    this.dodgeCd = 0;
    this.musouT = 0;       // 无双剩余时间
    this.staggerT = 0;
    this.hurtT = 0;        // 受击后无敌帧剩余时间
    this.airborne = false;
    this.queuedAttack = false;
    this.queuedCharge = false;
  }

  get busy() { return this.state === 'attack' || this.state === 'charge' || this.state === 'air' || this.state === 'stagger'; }
  get dodging() { return this.state === 'dodge'; }
  get musouActive() { return this.musouT > 0; }
  get invulnerable() { return this.state === 'dodge' || this.musouT > 0; }
  /** 当前是否处于霸体窗口：出招中且种类/阶数落在配置窗口内 */
  get isArmored() {
    if (this.state !== 'attack' && this.state !== 'charge' && this.state !== 'air') return false;
    return inSuperArmorWindow(this.armor, this.state === 'attack' ? 'normal' : this.state, this.stage);
  }

  /** 按 J：返回出招描述或 null（被吞输入） */
  pressAttack() {
    if (this.state === 'stagger') return null;
    if (this.airborne) {
      if (this.state === 'air') return null;
      this.state = 'air';
      this.stageT = BALANCE.airAtk.dur;
      return { kind: 'air', stage: 0 };
    }
    if (this.state === 'attack') { this.queuedAttack = true; return null; }
    if (this.state === 'charge' || this.state === 'dodge') return null;
    // idle 或衔接窗口内
    if (this.state === 'idle' || this.windowT > 0) {
      const next = this.stage >= 6 ? 1 : this.stage + 1;
      this.stage = next;
      this.state = 'attack';
      this.stageT = BALANCE.combo[this.stage - 1].dur;
      this.windowT = 0;
      return { kind: 'normal', stage: this.stage };
    }
    return null;
  }

  /** 按 K：按当前连段阶数打出 C 蓄力终结 */
  pressCharge() {
    if (this.state === 'stagger' || this.state === 'charge' || this.state === 'dodge') return null;
    if (this.stage === 0 && this.state !== 'attack') return null;
    const stage = Math.max(1, Math.min(6, this.stage || 1));
    this.state = 'charge';
    this.stageT = 0.34 + stage * 0.03;
    this.windowT = 0;
    this.queuedAttack = false;
    return { kind: 'charge', stage };
  }

  /** 闪避：返回是否成功触发 */
  pressDodge() {
    if (this.dodgeCd > 0 || this.state === 'stagger' || this.state === 'charge') return false;
    this.state = 'dodge';
    this.dodgeT = BALANCE.player.dodgeTime;
    this.dodgeCd = BALANCE.player.dodgeCooldown;
    this.queuedAttack = false;
    return true;
  }

  /** 开无双：gauge 满才可 */
  tryMusou() {
    if (this.musouT > 0 || this.state === 'stagger') return false;
    this.musouT = BALANCE.player.musouDuration;
    return true;
  }

  /**
   * 受击：返回 false（免疫：闪避/无双/受击无敌帧内，不扣血）、
   * 'armor'（霸体窗口内：扣血但不打断、不硬直、不清连段），
   * true（命中：打断出招，进入 0.28 秒硬直，并挂 0.5 秒受击无敌帧）。
   */
  takeHit(dmg) {
    if (this.invulnerable) return false;
    if (this.hurtT > 0) return false;
    if (this.isArmored) return 'armor';
    this.state = 'stagger';
    this.staggerT = 0.28;
    this.hurtT = BALANCE.player.hurtIframes;
    this.stage = 0;
    this.queuedAttack = false;
    return true;
  }

  update(dt) {
    this.dodgeCd = Math.max(0, this.dodgeCd - dt);
    this.hurtT = Math.max(0, this.hurtT - dt);
    if (this.musouT > 0) this.musouT = Math.max(0, this.musouT - dt);
    switch (this.state) {
      case 'attack':
      case 'charge':
      case 'air': {
        this.stageT -= dt;
        if (this.stageT <= 0) {
          if (this.state === 'attack' && this.queuedAttack) {
            this.queuedAttack = false;
            const next = this.stage >= 6 ? 1 : this.stage + 1;
            this.stage = next;
            this.stageT = BALANCE.combo[this.stage - 1].dur;
            this._pending = { kind: 'normal', stage: this.stage };
          } else {
            // 蓄力/空攻是终结招：连段清零；普攻结束则保留衔接窗口
            const wasAttack = this.state === 'attack';
            this.state = 'idle';
            this.windowT = wasAttack ? COMBO_WINDOW : 0;
            if (!wasAttack) this.stage = 0;
            this._pending = null;
          }
        }
        break;
      }
      case 'dodge':
        this.dodgeT -= dt;
        if (this.dodgeT <= 0) { this.state = 'idle'; this.windowT = 0; }
        break;
      case 'stagger':
        this.staggerT -= dt;
        if (this.staggerT <= 0) { this.state = 'idle'; this.stage = 0; this.windowT = 0; }
        break;
      case 'idle':
        if (this.windowT > 0) {
          this.windowT -= dt;
          if (this.windowT <= 0) this.stage = 0;
        }
        break;
      default: break;
    }
    // 衔接窗口过期则连段清零（idle 分支已处理）
  }

  /** update 期间由排队输入触发的下一段，game 循环取走 */
  consumePending() {
    const p = this._pending || null;
    this._pending = null;
    return p;
  }
}
