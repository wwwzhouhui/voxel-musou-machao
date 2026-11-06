// ============================================================
// voxel-musou-machao · src/enemies.js
// 士兵群：InstancedMesh 分部位渲染（身体/头/腿/武器/盔缨），数百人同屏
// 含敌军 AI（追击/包围/前摇攻击/击飞/硬直）与少量友军 AI
// ============================================================
import * as THREE from 'three';
import { ENEMY_TYPES, ARCHER } from './config.js';
import { archerDecision } from './arrows.js';
import { resolveCollisions } from './world.js';

const PART_DEFS = [
  { key: 'body',   w: 0.56, h: 0.62, d: 0.34, y: 1.02, color: 0x2e3a4a },
  { key: 'head',   w: 0.32, h: 0.3,  d: 0.3,  y: 1.52, color: 0xe8b07e },
  { key: 'legs',   w: 0.42, h: 0.55, d: 0.28, y: 0.42, color: 0x23262e },
  { key: 'weapon', w: 0.07, h: 0.07, d: 1.7,  y: 1.05, color: 0x8a8f96 },
  { key: 'plume',  w: 0.1,  h: 0.22, d: 0.1,  y: 1.78, color: 0xb02020 },
];

// 阵营配色
const FACTION_COLORS = {
  cao: { body: 0x33415e, head: 0xe8b07e, legs: 0x23262e, weapon: 0x8a8f96, plume: 0xb02020 },
  ma:  { body: 0xdfe6ea, head: 0xf0c08c, legs: 0x4a3226, weapon: 0xc9d4dc, plume: 0xc8102e },
};

// 兵种配色覆盖：弓手墨绿甲 + 绿缨 + 木弓，战场上一眼可辨
const TYPE_COLORS = {
  archer: { body: 0x3a4a3a, weapon: 0x8a5a2a, plume: 0x7dff8a },
  spearman: { body: 0x3a3a4a, plume: 0xd8a928 },
  elite: { body: 0x4a2a3a, plume: 0xffd23e },
  officer: { body: 0x4a2a6b, plume: 0xc07dff },
};
const AIM_GLOW = 0xffa030; // 拉弓前摇时弓身发光色

export class Crowd {
  constructor(scene, max = 300) {
    this.scene = scene;
    this.max = max;
    this.meshes = {};
    for (const p of PART_DEFS) {
      const im = new THREE.InstancedMesh(
        new THREE.BoxGeometry(p.w, p.h, p.d),
        new THREE.MeshLambertMaterial({ color: 0xffffff }),
        max,
      );
      im.castShadow = true;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.count = max;
      im.frustumCulled = false;
      // 初始全部缩到 0（隐藏）
      const zero = new THREE.Matrix4().makeScale(0, 0, 0);
      for (let i = 0; i < max; i++) im.setMatrixAt(i, zero);
      scene.add(im);
      this.meshes[p.key] = im;
    }
    this.soldiers = [];
    for (let i = 0; i < max; i++) {
      this.soldiers.push({
        id: i, alive: false, type: 'soldier', faction: 'cao',
        x: 0, z: 0, y: 0, vy: 0, hp: 1, maxHp: 1,
        facing: 0, speed: 3, state: 'idle', stateT: 0,
        atkCd: 0, kbx: 0, kbz: 0, bob: Math.random() * 6.28,
        swing: 0, flash: 0, scale: 1, elite: false,
        aimTarget: null, aiming: false,
      });
    }
    this.freeList = [...this.soldiers];
    this.onDeath = null;   // (soldier) => void
    this.onPlayerHit = null; // (dmg, x, z) => void
    this.onArcherShot = null; // (sx, sy, sz, tx, ty, tz, kind) => void
    this.colliders = [];
    this.bounds = 52;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._v = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._c = new THREE.Color();
  }

  spawn(typeName, x, z, faction = 'cao') {
    const s = this.freeList.pop();
    if (!s) return null;
    const t = ENEMY_TYPES[typeName] || ENEMY_TYPES.soldier;
    Object.assign(s, {
      alive: true, type: typeName, faction, x, z, y: 0, vy: 0,
      hp: t.hp, maxHp: t.hp, facing: Math.random() * Math.PI * 2,
      speed: t.speed * (0.9 + Math.random() * 0.2), state: 'chase', stateT: 0,
      atkCd: 0.5 + Math.random(), kbx: 0, kbz: 0, scale: t.scale,
      elite: typeName === 'elite' || typeName === 'officer', swing: 0, flash: 0,
      aimTarget: null, aiming: false,
    });
    const fc = { ...FACTION_COLORS[faction], ...(TYPE_COLORS[typeName] || {}) };
    for (const p of PART_DEFS) {
      this.meshes[p.key].setColorAt(s.id, this._c.setHex(fc[p.key] ?? p.color));
    }
    for (const p of PART_DEFS) this.meshes[p.key].instanceColor.needsUpdate = true;
    // 第五阶段：受击变白闪的还原色；追击偏移（每人固定一个绕玩家的接近角与半径，
    // 远处朝“玩家+偏移点”走、不走同一条直线，近处再直扑玩家）
    s.baseColors = fc;
    s.flashColored = false;
    s.approachAngle = Math.random() * Math.PI * 2;
    s.approachR = 1.5 + Math.random() * 2;
    return s;
  }

  aliveCount(faction = 'cao') {
    let n = 0;
    for (const s of this.soldiers) if (s.alive && s.faction === faction) n++;
    return n;
  }
  totalAlive() { let n = 0; for (const s of this.soldiers) if (s.alive) n++; return n; }

  kill(s, silent = false) {
    if (!s.alive) return;
    s.alive = false;
    this.freeList.push(s);
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (const p of PART_DEFS) this.meshes[p.key].setMatrixAt(s.id, zero);
    for (const p of PART_DEFS) this.meshes[p.key].instanceMatrix.needsUpdate = true;
    if (!silent && this.onDeath) this.onDeath(s);
  }

  /** 玩家/武将的近战命中判定：扇形范围。返回命中列表。
   * opts.exclude：Set<士兵 id>，命中时跳过（第五阶段：蓄力终结 AoE 圈排除主扇形
   * 已命中者，单次攻击不双重计伤）。 */
  applyMelee(cx, cz, facing, range, arc, dmg, kb, opts = {}) {
    const hits = [];
    const isMusou = !!opts.musou;
    for (const s of this.soldiers) {
      if (!s.alive || s.faction !== 'cao') continue;
      if (opts.exclude && opts.exclude.has(s.id)) continue;
      const dx = s.x - cx, dz = s.z - cz;
      const d = Math.hypot(dx, dz);
      if (d > range + 0.5) continue;
      const ang = Math.atan2(dx, dz); // 注意：朝向以 +Z 为前
      let diff = ang - facing;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      if (Math.abs(diff) > arc / 2 && d > 1.2) continue;
      const dirx = d > 0.01 ? dx / d : Math.sin(facing);
      const dirz = d > 0.01 ? dz / d : Math.cos(facing);
      this.damage(s, dmg * (isMusou ? 1 : 1), dirx, dirz, kb);
      hits.push(s);
    }
    return hits;
  }

  damage(s, dmg, dirx, dirz, kb) {
    if (!s.alive) return false;
    s.hp -= dmg;
    s.flash = 0.12;
    // 第五阶段：受击变白闪（此前只有 6% 放大、无变色，打上去像木桩）；
    // 闪结束时 update 里按 baseColors 还原（拉弓中的弓身还原为橙光，见 update）。
    if (!s.flashColored) {
      s.flashColored = true;
      for (const p of PART_DEFS) this.meshes[p.key].setColorAt(s.id, this._c.setHex(0xffffff));
      for (const p of PART_DEFS) this.meshes[p.key].instanceColor.needsUpdate = true;
    }
    // 弓手拉弓被命中 → 打断瞄准（弓光熄灭）
    if (s.aiming) { s.aiming = false; s.aimTarget = null; this._setWeaponColor(s, null); }
    const k = kb * (s.elite ? 0.35 : 1);
    s.kbx += dirx * k; s.kbz += dirz * k;
    s.state = 'stagger'; s.stateT = 0.22;
    if (s.hp <= 0) { this.kill(s); return true; }
    return false;
  }

  /** 弓身颜色：aiming 发光橙，平时恢复兵种色 */
  _setWeaponColor(s, hex) {
    const fc = { ...FACTION_COLORS[s.faction], ...(TYPE_COLORS[s.type] || {}) };
    this.meshes.weapon.setColorAt(s.id, this._c.setHex(hex ?? fc.weapon ?? 0x8a8f96));
    this.meshes.weapon.instanceColor.needsUpdate = true;
  }

  nearestEnemy(x, z, maxD = 60) {
    let best = null, bd = maxD;
    for (const s of this.soldiers) {
      if (!s.alive || s.faction !== 'cao') continue;
      const d = Math.hypot(s.x - x, s.z - z);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  update(dt, player, alliesTarget) {
    const px = player.x, pz = player.z;
    // 第五阶段：全员互斥推开（此前只对弓手做 2.2 米互斥，近战兵会叠成一坨）。
    // 任意两名敌军太近则互相推开：弓手参与的按 2.2 米，其余按 1.6 米；
    // 在场 ≤32 人时约 500 对/帧，开销可忽略。
    const foes = [];
    for (const s of this.soldiers) if (s.alive && s.faction === 'cao') foes.push(s);
    for (let i = 0; i < foes.length; i++) {
      for (let j = i + 1; j < foes.length; j++) {
        const a = foes[i], b = foes[j];
        const minD = (a.type === 'archer' || b.type === 'archer') ? 2.2 : 1.6;
        const dx = b.x - a.x, dz = b.z - a.z;
        const d = Math.hypot(dx, dz);
        if (d > 0.01 && d < minD) {
          const push = (minD - d) * 0.5;
          const nx = dx / d, nz = dz / d;
          a.x -= nx * push; a.z -= nz * push;
          b.x += nx * push; b.z += nz * push;
        }
      }
    }
    for (const s of this.soldiers) {
      if (!s.alive) continue;
      s.stateT -= dt;
      s.atkCd -= dt;
      s.flash = Math.max(0, s.flash - dt);
      // 第五阶段：受击白闪结束时按出生配色还原（拉弓中的弓身还原为橙光）
      if (s.flashColored && s.flash <= 0) {
        s.flashColored = false;
        const fc = s.baseColors || {};
        for (const p of PART_DEFS) this.meshes[p.key].setColorAt(s.id, this._c.setHex(fc[p.key] ?? p.color));
        if (s.aiming) this._setWeaponColor(s, AIM_GLOW);
        for (const p of PART_DEFS) this.meshes[p.key].instanceColor.needsUpdate = true;
      }
      s.bob += dt * 9;

      // 击退衰减
      s.x += s.kbx * dt; s.z += s.kbz * dt;
      s.kbx *= Math.pow(0.02, dt); s.kbz *= Math.pow(0.02, dt);

      // 目标选择
      let tx, tz, isPlayer = false, allyRef = null;
      if (s.faction === 'cao') {
        // 70% 追玩家，否则追最近友军
        let ally = null;
        if (alliesTarget) ally = alliesTarget(s.x, s.z);
        if (!ally || Math.random() < 0.004) { tx = px; tz = pz; isPlayer = true; }
        else { tx = ally.x; tz = ally.z; allyRef = ally; }
      } else {
        const e = this.nearestEnemy(s.x, s.z, 70);
        if (e) { tx = e.x; tz = e.z; } else { tx = s.x; tz = s.z - 10; }
      }

      const dx = tx - s.x, dz = tz - s.z;
      const d = Math.hypot(dx, dz);
      const attackRange = s.type === 'spearman' ? 2.1 : 1.7;

      if (s.state === 'stagger') {
        if (s.stateT <= 0) s.state = 'chase';
      } else if (s.state === 'aim') {
        // 弓手拉弓前摇：面向目标，弓身发光；结束时射箭（目标取开火瞬间位置）
        s.facing = Math.atan2(dx, dz);
        if (s.stateT <= 0) {
          s.aiming = false;
          this._setWeaponColor(s, null);
          s.state = 'chase'; s.atkCd = 1.6 + Math.random() * 0.8;
          const tgt = s.aimTarget;
          let gx = tx, gz = tz, gy = 1.2;
          if (tgt) {
            if (tgt.kind === 'player') { gx = player.x; gz = player.z; gy = (player.y || 0) + 1.2; }
            else if (tgt.ref && tgt.ref.alive) { gx = tgt.ref.x; gz = tgt.ref.z; gy = 1.2; }
          }
          s.aimTarget = null;
          if (this.onArcherShot) this.onArcherShot(s.x, s.y + 1.2, s.z, gx, gy, gz, isPlayer ? 'player' : 'ally');
        }
      } else if (s.state === 'windup') {
        // 前摇：面向目标，结束时出招
        s.facing = Math.atan2(dx, dz);
        if (s.stateT <= 0) {
          s.state = 'chase'; s.atkCd = 0.9 + Math.random() * 0.5; s.swing = 0.3;
          if (d < attackRange + 0.6) {
            if (isPlayer && this.onPlayerHit) {
              const t = ENEMY_TYPES[s.type];
              this.onPlayerHit(t.atk, s.x, s.z);
            } else if (!isPlayer && alliesTarget) {
              // 友军受击：由 game 侧通过回调处理，这里简化为直接扣友军血在 game 里
              if (this.onAllyHit) this.onAllyHit(s, ENEMY_TYPES[s.type].atk);
            }
          }
        }
      } else if (s.type === 'archer' && s.faction === 'cao' && d >= 2) {
        // 弓手：保持距离——太近后退、太远靠近、射程内拉弓
        const decision = archerDecision(d, s.atkCd);
        const nx = dx / (d || 1), nz = dz / (d || 1);
        if (decision === 'retreat') {
          s.x -= nx * s.speed * 0.85 * dt;
          s.z -= nz * s.speed * 0.85 * dt;
          s.facing = Math.atan2(dx, dz);
        } else if (decision === 'approach') {
          s.x += nx * s.speed * dt;
          s.z += nz * s.speed * dt;
          s.facing = Math.atan2(dx, dz);
        } else if (decision === 'aim') {
          s.state = 'aim'; s.stateT = ARCHER.aimTime;
          s.aiming = true;
          s.aimTarget = isPlayer ? { kind: 'player' } : { kind: 'ally', ref: allyRef };
          this._setWeaponColor(s, AIM_GLOW);
          s.facing = Math.atan2(dx, dz);
        }
        // hold：原地待命，微摆
      } else {
        // chase
        if (d > attackRange) {
          // 第五阶段：远处朝“目标 + 个人偏移点”走（每人固定接近角/半径），
          // 不走同一条直线围向玩家；6 米内直扑目标，保证能接敌出招。
          // 原有的正弦包围摆动保留，与偏移叠加。
          let mx = dx, mz = dz, md = d;
          if (isPlayer && d > 6) {
            mx = tx + Math.cos(s.approachAngle) * s.approachR - s.x;
            mz = tz + Math.sin(s.approachAngle) * s.approachR - s.z;
            md = Math.hypot(mx, mz) || 1;
          }
          const wob = Math.sin(s.id * 2.39 + s.bob * 0.1) * 0.6;
          const nx = mx / md, nz = mz / md;
          const ox = -nz * wob, oz = nx * wob;
          s.x += (nx * s.speed + ox) * dt;
          s.z += (nz * s.speed + oz) * dt;
          s.facing = Math.atan2(dx, dz);
        } else if (s.atkCd <= 0) {
          s.state = 'windup'; s.stateT = 0.38;
          s.facing = Math.atan2(dx, dz);
        }
      }

      // 落地/弹跳
      if (s.y > 0 || s.vy !== 0) {
        s.vy -= 26 * dt; s.y += s.vy * dt;
        if (s.y <= 0) { s.y = 0; s.vy = 0; }
      }
      // 击飞时抛起
      if (s.state === 'stagger' && (Math.abs(s.kbx) > 6 || Math.abs(s.kbz) > 6) && s.y === 0) {
        s.vy = 3.5;
      }

      resolveCollisions(s, 0.45, this.colliders, this.bounds);
      this._writeInstance(s, dt);
    }
    for (const p of PART_DEFS) this.meshes[p.key].instanceMatrix.needsUpdate = true;
  }

  _writeInstance(s, dt) {
    const walking = s.state === 'chase';
    const bobY = walking ? Math.abs(Math.sin(s.bob)) * 0.09 : 0;
    const lean = s.state === 'windup' ? -0.25 : (s.state === 'stagger' ? 0.3 : 0);
    const sc = s.scale * (s.flash > 0 ? 1.06 : 1);
    const swing = s.swing > 0 ? (s.swing -= dt, Math.sin((0.3 - s.swing) / 0.3 * Math.PI) * 1.2) : 0;

    // body
    this._e.set(lean, s.facing, 0);
    this._q.setFromEuler(this._e);
    this._v.set(s.x, s.y + (1.02 + bobY) * sc, s.z);
    this._s.set(sc, sc, sc);
    this._m.compose(this._v, this._q, this._s);
    this.meshes.body.setMatrixAt(s.id, this._m);
    // head
    this._v.set(s.x, s.y + (1.52 + bobY) * sc, s.z);
    this._m.compose(this._v, this._q, this._s);
    this.meshes.head.setMatrixAt(s.id, this._m);
    // legs（走路摆动：用绕 X 的小旋转近似）
    this._e.set(walking ? Math.sin(s.bob) * 0.35 : 0, s.facing, 0);
    this._q.setFromEuler(this._e);
    this._v.set(s.x, s.y + (0.42 + bobY * 0.5) * sc, s.z);
    this._m.compose(this._v, this._q, this._s);
    this.meshes.legs.setMatrixAt(s.id, this._m);
    // weapon：持于身前，攻击时横扫；弓手竖持木弓，拉弓时弓身前推
    const wx = s.x + Math.sin(s.facing) * 0.45;
    const wz = s.z + Math.cos(s.facing) * 0.45;
    if (s.type === 'archer') {
      this._e.set(0.15, s.facing, s.aiming ? 1.35 : 1.1);
    } else {
      this._e.set(Math.PI / 2 - 0.5 + (s.state === 'windup' ? -0.9 : 0), s.facing + swing, 0);
    }
    this._q.setFromEuler(this._e);
    this._v.set(wx, s.y + (1.05 + bobY) * sc, wz);
    this._m.compose(this._v, this._q, this._s);
    this.meshes.weapon.setMatrixAt(s.id, this._m);
    // plume
    this._e.set(lean, s.facing, 0);
    this._q.setFromEuler(this._e);
    this._v.set(s.x, s.y + (1.78 + bobY) * sc, s.z);
    this._m.compose(this._v, this._q, this._s);
    this.meshes.plume.setMatrixAt(s.id, this._m);
  }
}
