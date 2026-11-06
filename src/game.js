// ============================================================
// voxel-musou-machao · src/game.js
// 主游戏：固定 60Hz 模拟 / 玩家操控 / 连招结算 / 波次 / Boss / HUD
// ============================================================
import * as THREE from 'three';
import { CHARACTERS, CHAPTERS, MAPS, BOSS, BALANCE, ENEMY_TYPES, ARCHER, MOUNT, RANGED, POINTER_LOCK, archerShareForWave, gradeFor } from './config.js';
import { pickSpawnPositions } from './spawns.js';
import { buildHero, buildHorse, box } from './voxel.js';
import { CUTSCENES, CutsceneRunner } from './cutscene.js';
import { MountState, shouldFallFromHit } from './mount.js';
import { AdaptiveQuality, QUALITY_TIERS } from './adaptive.js';
import { buildWorld, resolveCollisions } from './world.js';
import { Crowd } from './enemies.js';
import { ComboMachine } from './combat.js';
import { Sfx } from './audio.js';
import { ArrowPool } from './arrows.js';
import { PlayerShotPool, RangedState, BurnZone } from './player-shots.js';
import { PostFX } from './post.js';

const STEP = 1 / 60;
const $ = (id) => document.getElementById(id);

export class Game {
  constructor(opts = {}) {
    this.opts = opts;
    this.charId = opts.char || 'machao';
    this.charSpec = CHARACTERS[this.charId];
    this.modeId = opts.mode || 'tongguan';
    this.chapter = CHAPTERS[this.modeId];
    // 潼关之战固定在潼关；自由演武 / 试炼可用两张图
    this.mapId = this.modeId === 'tongguan' ? 'tongguan' : (MAPS[opts.map] ? opts.map : 'tongguan');
    this.postCfg = opts.post || { enabled: true, bloom: true, pixel: false };
    if (opts.quality === 'low') this.postCfg = { enabled: false, bloom: false, pixel: false };
    this.maxEnemies = opts.enemies || 220;
    this.quality = opts.quality || 'high';
    this.qualityMode = opts.qualityMode || (this.quality === 'low' ? 'low' : 'auto');
    this.skipIntro = !!opts.skipIntro;
    // 自适应画质：手动 low 固定极低档；其余模式下 adaptive 管档位
    this.adaptive = new AdaptiveQuality(this.qualityMode, 0);
    this._maxAliveCap = this.adaptive.tierDef.maxAlive;
    this._postUserOverride = false; // 用户手动按过 B/P 后，自适应不再动后期开关
    this._qualityTipT = 0;
    // 剧情过场 / 坐骑
    this.cutscene = null;      // CutsceneRunner | null
    this.cutsceneAfter = null; // 'start' | 'boss' | 'victory' | 'defeat'
    this._pendingEnd = null;   // 过场结束后再结算：{ won, reason }
    this.mount = new MountState();
    this.horse = null;         // { group, legs... } 体素马
    this.horseHome = { x: 3, z: 40 };
    this._mountDustT = 0;
    this.sfx = new Sfx();
    this.arrowPool = new ArrowPool(ARCHER.poolSize);
    // 玩家远程：Q 键，按武将取 RANGED 配置；独立弹丸池，不抢敌箭池
    this.ranged = new RangedState(this.charId);
    this.shotPool = new PlayerShotPool();
    this.burnZones = [];
    // MSAA / DoF 手动覆盖：?dof=on|off、?msaa=0|2|4；缺省跟随画质档位
    this._dofOverride = opts.dof ?? null;
    this._msaaOverride = opts.msaa ?? null;
    this._fps = 0;
    this._fpsTimes = []; // 最近 1 秒内真实时间的帧时间戳（performance.now），用于自适应画质
    this.state = 'menu'; // menu | playing | paused | over
    this.time = 0;
    this.kills = 0;
    this.combo = 0;
    this.comboT = 0;
    this.maxCombo = 0;
    this.damageTaken = 0;
    this.damageDealt = 0;
    this.bossSpawned = false;
    this.bossDead = false;
    this.victory = false;
    this.hitstopT = 0;
    this.wave = 0;
    this.waveSpawned = 0;
    this.waveQuota = 0;
    this.spawnT = 0;
    this._spawnPtIdx = 0; // 出生点轮询下标（第五阶段：跨批次连续轮询，分散出生）
    // 指针锁定（第五阶段）：开战自动请求 Pointer Lock，滑鼠标转视角
    this.pointerLocked = false;
    this._lockHintShown = false;
    this.trialLeft = this.chapter.timeLimit || 0;
    this.lockTarget = null;
    this.camYaw = Math.PI;      // 相机绕玩家角度
    this.camPitch = 0.32;
    this.camDist = BALANCE.camera.dist;
    this.pointerDown = false;
    this._acc = 0;
    this._last = 0;
    this._hudT = 0;
    this._miniT = 0;
    this._allyRespawnT = 0;
    this._musouNotified = false;
    this.drops = [];
    this.debris = [];
    this.dmgNums = [];
    this.pendingHit = null;
    this.keys = {};
    this._v3 = new THREE.Vector3();
  }

  // ---------------- 初始化 ----------------
  init(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: this.quality !== 'low', powerPreference: 'high-performance' });
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, this.quality === 'low' ? 1 : 2));
    this.renderer.shadowMap.enabled = this.quality !== 'low';
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, container.clientWidth / container.clientHeight, 0.1, 400);
    this.camera.position.set(0, 8, 46);

    this.world = buildWorld(this.scene, this._worldVariant(), this.mapId);

    // 后期：Bloom + 像素风（低配强制关闭，见构造）
    this.post = new PostFX(this.renderer, this.postCfg);
    this.post.resize(container.clientWidth, container.clientHeight);

    // 敌群
    this.crowd = new Crowd(this.scene, Math.max(this.maxEnemies, 320));
    this.crowd.colliders = this.world.colliders;
    this.crowd.bounds = this.world.bounds;
    this.crowd.onDeath = (s) => this._onSoldierDeath(s);
    this.crowd.onPlayerHit = (dmg, x, z) => this._onPlayerHit(dmg, x, z);
    this.crowd.onAllyHit = (s, dmg) => this._onAllyHit(s, dmg);
    this.crowd.onArcherShot = (sx, sy, sz, tx, ty, tz) => {
      this.arrowPool.fire({ x: sx, y: sy, z: sz }, { x: tx, y: ty, z: tz }, ARCHER.damage);
      this.sfx.arrowShoot();
    };

    // 箭矢渲染：InstancedMesh 对象池（与逻辑池一一对应）
    this.arrowMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.07, 0.07, 1.0),
      new THREE.MeshLambertMaterial({ color: 0xd8c090 }),
      ARCHER.poolSize,
    );
    this.arrowMesh.frustumCulled = false;
    this.arrowMesh.castShadow = false;
    {
      const zero = new THREE.Matrix4().makeScale(0, 0, 0);
      for (let i = 0; i < ARCHER.poolSize; i++) this.arrowMesh.setMatrixAt(i, zero);
    }
    this.scene.add(this.arrowMesh);

    // 玩家远程弹丸渲染：独立 InstancedMesh（与敌箭池一一对应，按 kind 上色）
    this.shotMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.09, 0.09, 1.15),
      new THREE.MeshLambertMaterial({ color: 0xffffff }),
      this.shotPool.cap,
    );
    this.shotMesh.frustumCulled = false;
    this.shotMesh.castShadow = false;
    {
      const zero = new THREE.Matrix4().makeScale(0, 0, 0);
      for (let i = 0; i < this.shotPool.cap; i++) {
        this.shotMesh.setMatrixAt(i, zero);
        this.shotMesh.setColorAt(i, new THREE.Color(0xffffff));
      }
    }
    this.scene.add(this.shotMesh);

    // 火矢灼烧区地面标记：4 个橙色扁平半透明方块，随灼烧区显示/闪烁
    this.burnMeshes = [];
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(1, 0.1, 1),
        new THREE.MeshBasicMaterial({ color: 0xff7a1a, transparent: true, opacity: 0.35 }),
      );
      m.visible = false;
      this.scene.add(m);
      this.burnMeshes.push(m);
    }

    // 玩家
    this.player = this._makePlayer();
    this.scene.add(this.player.group);

    // 霸体光圈（第五阶段）：脚下金色圆环，霸体窗口内显示；复用灼烧区地面标记的
    // 手法（扁平 Mesh），不用共享材质的 emissive，避免武将/Boss 共用材质串色。
    this.armorRing = new THREE.Mesh(
      new THREE.RingGeometry(0.9, 1.15, 32),
      new THREE.MeshBasicMaterial({ color: 0xffd23e, transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
    );
    this.armorRing.rotation.x = -Math.PI / 2;
    this.armorRing.visible = false;
    this.scene.add(this.armorRing);

    // 坐骑：体素马停在出生点附近（玩家出生点 +3, +2），可按 F 上马
    this.horse = buildHorse(this.charId);
    this._horseCharId = this.charId;
    this.horseHome = { x: this.world.spawns.player.x + 3, z: this.world.spawns.player.z + 2 };
    this.horse.group.position.set(this.horseHome.x, 0, this.horseHome.z);
    this.scene.add(this.horse.group);
    // 初始画质档位（手动 low 时 post 已在构造里关掉，这里再补阴影/像素比/敌数上限）
    this._applyQualityTier(this.adaptive.tier, false);

    // 友军：庞德 + 两名西凉兵
    this.allies = [];
    this._spawnAllies();

    // Boss（先建好藏起来，触发时现身）
    this.boss = this._makeBoss();
    this.boss.group.visible = false;
    this.scene.add(this.boss.group);

    // 碎块池
    this._initDebris();
    this._initDrops();
    this._bindInput();
    this._bindResize();
    window.__machao = this; // 供无头测试与调试
    this._updateBestLabels();
  }

  // ---------------- 自适应画质 ----------------
  /** 应用一档画质（announce 为 true 时在 HUD 提示档位变化） */
  _applyQualityTier(tier, announce = true) {
    const def = QUALITY_TIERS[tier];
    if (!def) return;
    this.adaptive.tier = tier;
    this._maxAliveCap = def.maxAlive;
    if (this.renderer) {
      this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, def.pixelRatio));
      this.renderer.shadowMap.enabled = def.shadows;
    }
    // 后期开关：用户手动按过 B/P 后不再被自适应改动
    if (this.post && !this._postUserOverride) {
      this.post.setEnabled(def.post);
      if (def.post) this.post.setBloom(def.bloom);
    }
    // MSAA / DoF 跟随档位；?msaa / ?dof / O 键手动覆盖优先于档位
    if (this.post) {
      this.post.setMsaa(this._msaaOverride ?? def.msaa);
      this.post.setDof(this._dofOverride ?? def.dof);
    }
    if (announce && this.state === 'playing') {
      const el = $('quality-indicator');
      if (el) {
        el.textContent = `画质：${def.label}${this.adaptive.isAuto ? '（自动）' : ''}`;
        el.classList.remove('hidden');
        clearTimeout(this._qualityTipT);
        this._qualityTipT = setTimeout(() => el.classList.add('hidden'), 3000);
      }
    }
  }

  /** 切换画质模式：auto 自动 / high / medium / low 手动固定档 */
  setQualityMode(mode) {
    if (!['auto', 'high', 'medium', 'low'].includes(mode)) return;
    this.qualityMode = mode;
    this.adaptive.setMode(mode);
    this._applyQualityTier(this.adaptive.tier, true);
    try { localStorage.setItem('machao_quality_mode', mode); } catch (e) { /* 忽略 */ }
  }

  _updateAdaptive(dt) {
    if (!this.adaptive.isAuto || !this._fps) return;
    const next = this.adaptive.update(this._fps, dt);
    if (next !== null) this._applyQualityTier(next, true);
  }

  /** 地图氛围：阳平关固定夜战，潼关跟随章节（白昼/黄昏/夜战） */
  _worldVariant() {
    return this.mapId === 'yangping' ? 'yangpingNight' : this.chapter.variant;
  }

  /** 换图：移除旧世界 group 并重建（标题界面预览与开战前调用） */
  _rebuildWorld(mapId) {
    const id = MAPS[mapId] ? mapId : 'tongguan';
    if (this.world && this.world.group) {
      this.scene.remove(this.world.group);
      this.world.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    }
    this.mapId = id;
    this.world = buildWorld(this.scene, this._worldVariant(), id);
    this.crowd.colliders = this.world.colliders;
    this.crowd.bounds = this.world.bounds;
    this.arrowPool.clear();
    this.shotPool.clear();
    this._clearBurnZones();
    // 玩家 / Boss / 友军按新图出生点复位
    if (this.player) {
      this.player.x = this.world.spawns.player.x;
      this.player.z = this.world.spawns.player.z;
      this.player.group.position.set(this.player.x, 0, this.player.z);
    }
    if (this.boss) {
      this.boss.x = this.world.spawns.boss.x;
      this.boss.z = this.world.spawns.boss.z;
      this.boss.group.position.set(this.boss.x, 0, this.boss.z);
    }
    // 坐骑跟随换图：下马回出生点附近，骑乘中则跟玩家走
    if (this.horse) {
      this.horseHome = { x: this.world.spawns.player.x + 3, z: this.world.spawns.player.z + 2 };
      if (!this.mount.mounted) this.horse.group.position.set(this.horseHome.x, 0, this.horseHome.z);
    }
    this.camera.position.set(this.world.spawns.player.x, 8, this.world.spawns.player.z + 8);
    this.camYaw = Math.PI;
  }

  /** 标题界面选图预览（仅菜单态） */
  previewMap(mapId) {
    if (this.state !== 'menu' || !this.world) return;
    if (mapId === this.mapId) return;
    this._rebuildWorld(mapId);
    this._render();
  }

  /** 统一渲染入口：后期开则走 PostFX，否则直出 */
  _render() {
    // DoF 焦点：锁定目标取其距离，否则取相机到玩家的距离（约 9.5 米）
    if (this.post) {
      let focus = 12;
      if (this.lockTarget) {
        const t = this.lockTarget;
        focus = Math.hypot((t.x ?? 0) - this.player.x, (t.z ?? 0) - this.player.z);
      } else if (this.player) {
        focus = Math.hypot(this.camera.position.x - this.player.x, this.camera.position.z - this.player.z);
      }
      this.post.setFocusDepth(focus);
    }
    if (this.post) this.post.render(this.scene, this.camera);
    else this.renderer.render(this.scene, this.camera);
  }
  renderFrame() { this._render(); }

  _makePlayer() {
    const spec = this.charSpec;
    const rig = buildHero(spec, 1);
    const st = spec.stats;
    return {
      rig, group: rig.group,
      x: this.world.spawns.player.x, z: this.world.spawns.player.z, y: 0, vy: 0,
      facing: Math.PI, // 面向北（关门）
      hp: st.hp, maxHp: st.hp, musou: 0,
      speed: st.speed, atk: st.atk, range: st.range,
      combo: new ComboMachine(spec.superArmor), // 第五阶段：武将霸体配置进连招状态机
      moveMag: 0, walkPhase: 0, grounded: true,
      dodgeDir: { x: 0, z: -1 }, dodgeT: 0,
      hurtFlash: 0, attackAnimT: 0, attackKind: null, attackStage: 0,
      dead: false,
    };
  }

  _makeBoss() {
    const spec = { ...BOSS, weaponType: 'sword', colors: BOSS.colors };
    const rig = buildHero(spec, BOSS.scale);
    return {
      rig, group: rig.group, name: BOSS.name, title: BOSS.title,
      x: 0, z: -40, y: 0, facing: 0,
      hp: BOSS.hp, maxHp: BOSS.hp, atk: BOSS.atk, speed: BOSS.speed,
      state: 'idle', stateT: 0, atkCd: 1.2, flash: 0, swingT: 0,
      walkPhase: 0, dead: false, telegraph: null,
    };
  }

  _spawnAllies() {
    const spots = this.world.spawns.allies || [{ x: -3, z: 34 }, { x: 3, z: 36 }, { x: 0, z: 32 }];
    for (const p of spots) {
      const s = this.crowd.spawn('elite', p.x, p.z, 'ma');
      if (s) this.allies.push(s);
    }
  }

  _initDebris() {
    const geo = new THREE.BoxGeometry(0.16, 0.16, 0.16);
    for (let i = 0; i < 160; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: 0xffffff }));
      m.visible = false; m.castShadow = false;
      this.scene.add(m);
      this.debris.push({ mesh: m, vx: 0, vy: 0, vz: 0, life: 0, spin: 0 });
    }
  }

  _initDrops() {
    // 包子：白面团 + 褶（两个小方块）
    for (let i = 0; i < 12; i++) {
      const g = new THREE.Group();
      const b = box(0.42, 0.3, 0.42, 0xf5ead0, 0, 0.15, 0, g);
      b.castShadow = false;
      box(0.16, 0.1, 0.16, 0xe8d8b0, 0, 0.34, 0, g).castShadow = false;
      g.visible = false;
      this.scene.add(g);
      this.drops.push({ group: g, active: false, x: 0, z: 0, life: 0, bob: 0 });
    }
  }

  // ---------------- 输入 ----------------
  _bindInput() {
    const el = this.renderer.domElement;
    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys[e.code] = true;
      if (e.code === 'KeyM') { this._toggleMute(); return; }
      if (e.code === 'KeyB') { // B：Bloom 开关（手动，后期不再被自适应改动）
        this._postUserOverride = true;
        this.post.setBloom(!this.post.bloom);
        this._announce(this.post.bloom ? '泛光 Bloom 已开启（B 关闭）' : '泛光 Bloom 已关闭（B 开启）');
        return;
      }
      if (e.code === 'KeyP') { // P：像素风开关（手动，后期不再被自适应改动）
        this._postUserOverride = true;
        this.post.setPixel(!this.post.pixel);
        this._announce(this.post.pixel ? '像素风已开启（P 关闭）' : '像素风已关闭（P 开启）');
        return;
      }
      if (e.code === 'KeyO') { // O：景深 DoF 手动开关（覆盖画质档位）
        this._dofOverride = !this.post.dof;
        this.post.setDof(this._dofOverride);
        this._announce(this.post.dof ? '景深 DoF 已开启（O 关闭）' : '景深 DoF 已关闭（O 开启）');
        return;
      }
      // 过场中：除 M/B/P 外任意键跳过（Esc 也跳过，不进暂停）
      if (this.state === 'cutscene') { this.skipCutscene(); return; }
      if (this.state === 'paused' && e.code === 'Escape') { this.resume(); return; }
      if (this.state !== 'playing') {
        return;
      }
      switch (e.code) {
        case 'KeyJ': this._pressAttack(); break;
        case 'KeyK': this._pressCharge(); break;
        case 'KeyI': this._tryMusou(); break;
        case 'KeyR': this._toggleLock(); break;
        case 'KeyF': this._toggleMount(); break;
        case 'KeyQ': this._pressRanged(); break;
        case 'KeyH': this._showHelp(true); break;
        case 'KeyL': case 'ShiftLeft': case 'ShiftRight': this._pressDodge(); break;
        case 'Space': this._pressJump(); e.preventDefault(); break;
        case 'Escape': this.pause(); break;
      }
    });
    addEventListener('keyup', (e) => { this.keys[e.code] = false; });
    el.addEventListener('mousedown', (e) => {
      this.pointerDown = true;
      this._px = e.clientX; this._py = e.clientY;
      if (this.state === 'cutscene') { this.skipCutscene(); return; }
      if (this.state === 'playing') {
        // 第五阶段：未锁定时点画面即请求锁定（点击是手势，浏览器允许）；已锁定则跳过
        this._requestPointerLock();
        if (e.button === 0) this._pressAttack();
        if (e.button === 2) this._pressCharge();
      }
    });
    addEventListener('mouseup', () => { this.pointerDown = false; });
    addEventListener('mousemove', (e) => {
      if (this.state !== 'playing') return;
      if (this.pointerLocked) {
        // 第五阶段：指针锁定中，滑动鼠标直接转视角（movementX/Y 为相对位移，
        // 不受屏幕边缘限制；灵敏度见 config.POINTER_LOCK）
        this.camYaw -= (e.movementX || 0) * POINTER_LOCK.sensitivity;
        this.camPitch = Math.max(POINTER_LOCK.pitchMin, Math.min(POINTER_LOCK.pitchMax,
          this.camPitch + (e.movementY || 0) * POINTER_LOCK.sensitivity));
        return;
      }
      // 未锁定时的拖拽视角（锁定失败 / 触屏的兜底，不替代指针锁定）
      if (!this.pointerDown) return;
      this.camYaw -= (e.clientX - this._px) * 0.005;
      this.camPitch = Math.max(0.08, Math.min(1.0, this.camPitch + (e.clientY - this._py) * 0.003));
      this._px = e.clientX; this._py = e.clientY;
    });
    // 第五阶段：指针锁定状态变化。锁定中浏览器会吞掉 Esc 按键（用来退出锁定），
    // 所以“Esc 退出锁定即暂停”靠 pointerlockchange 实现，而不是 keydown；
    // 切出窗口/失焦同样先丢锁定再暂停，状态不丢（pause 只改 state，不清进度）。
    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === this.renderer.domElement;
      this.pointerLocked = locked;
      if (!locked && this.state === 'playing') this.pause();
    });
    document.addEventListener('pointerlockerror', () => { this.pointerLocked = false; });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('wheel', (e) => {
      this.camDist = Math.max(6, Math.min(14, this.camDist + e.deltaY * 0.01));
    }, { passive: true });
    addEventListener('blur', () => { if (this.state === 'playing') this.pause(); });
  }

  _bindResize() {
    addEventListener('resize', () => {
      if (!this.renderer) return;
      const w = this.container.clientWidth, h = this.container.clientHeight;
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
      if (this.post) this.post.resize(w, h);
    });
  }

  // ---------------- 对外流程 ----------------
  start(modeId, charId, mapId) {
    if (modeId) { this.modeId = modeId; this.chapter = CHAPTERS[modeId]; }
    if (charId) { this.charId = charId; this.charSpec = CHARACTERS[charId]; }
    // 潼关之战固定潼关图；其他模式按所选地图
    const wantMap = this.modeId === 'tongguan' ? 'tongguan' : (MAPS[mapId] ? mapId : this.mapId);
    if (wantMap !== this.mapId) this._rebuildWorld(wantMap);
    else if (this.world.mapId !== wantMap) this._rebuildWorld(wantMap);
    // 换将后远程配置跟随新武将
    this.ranged.setChar(this.charId);
    // 换将后马匹毛色跟随新武将（马超白马 / 孙策枣红 / 周瑜乌马 / 典韦黑骝）
    if (this.horse && this._horseCharId !== this.charId) {
      this.scene.remove(this.horse.group);
      this.horse = buildHorse(this.charId);
      this._horseCharId = this.charId;
      this.horse.group.position.set(this.horseHome.x, 0, this.horseHome.z);
      this.scene.add(this.horse.group);
    }
    this.sfx.ensure();
    this._resetRun();
    this._showHud(true);
    this._loop = this._loop.bind(this);
    cancelAnimationFrame(this._raf || 0);
    this._raf = requestAnimationFrame(this._loop);
    // 潼关之战开场过场（自由演武/试炼只有一行播报；?skipintro=1 直接跳过）
    if (this.modeId === 'tongguan' && !this.skipIntro) this._startCutscene('intro', 'start');
    else this._beginPlay();
  }

  /** 过场结束后真正开战：状态 playing、号角、第一波 */
  _beginPlay() {
    this.state = 'playing';
    this._fps = 0; // 开战重计帧率：不沿用标题界面的高帧率，否则自适应降档会被平滑拖慢
    this._fpsTimes = [];
    this._last = performance.now();
    this._announce(`${this.chapter.name} —— ${this.chapter.briefing.split('\n')[0]}`);
    this.sfx.waveHorn();
    this._startWave();
    // 第五阶段：开战自动请求指针锁定（过场后可能已无手势，失败则静默走点击锁定兜底）
    this._requestPointerLock();
  }

  // ---------------- 剧情过场 ----------------
  _startCutscene(kind, after) {
    const script = CUTSCENES[kind];
    if (!script) { this._beginPlay(); return; }
    this.cutscene = new CutsceneRunner(script);
    this.cutsceneAfter = after;
    this.state = 'cutscene';
    this._last = performance.now();
    const el = $('cutscene');
    if (el) el.classList.remove('hidden');
    this._showCutsceneLine();
    this._updateCameraForCutscene(1); // 立刻切到第一镜，避免闪一下战斗视角
  }

  skipCutscene() {
    if (!this.cutscene || this.state !== 'cutscene') return;
    this.cutscene.skip();
    this._finishCutscene();
  }

  _showCutsceneLine() {
    const line = this.cutscene ? this.cutscene.line : null;
    if (!line) return;
    const sp = $('cutscene-speaker');
    const tx = $('cutscene-text');
    const pg = $('cutscene-progress');
    if (sp) { sp.textContent = line.who || '旁白'; sp.style.visibility = line.who ? 'visible' : 'hidden'; }
    if (tx) tx.textContent = line.text;
    if (pg) pg.textContent = `${this.cutscene.index + 1} / ${this.cutscene.script.lines.length} · 按任意键跳过`;
  }

  /** 按镜头模式算出相机目标位姿（world.spawns 驱动，两张图通用） */
  _cutsceneCam(line) {
    const sp = this.world.spawns;
    const p = this.player, b = this.boss;
    switch (line?.cam) {
      case 'gate': return { pos: [sp.north.x, 13, sp.north.z + 20], look: [sp.north.x, 2, sp.north.z] };
      case 'boss': return { pos: [b.x + 8, 5, b.z + 10], look: [b.x, 2, b.z] };
      case 'army': return { pos: [0, 16, 30], look: [0, 1, -40] };
      case 'wide': return { pos: [0, 20, 46], look: [0, 2, 0] };
      case 'player':
      default: return { pos: [p.x + 6, 4.5, p.z + 9], look: [p.x, 1.6, p.z] };
    }
  }

  _updateCameraForCutscene(dt) {
    if (!this.cutscene) return;
    const c = this._cutsceneCam(this.cutscene.line);
    const k = dt >= 1 ? 1 : 1 - Math.exp(-2.5 * dt);
    this.camera.position.x += (c.pos[0] - this.camera.position.x) * k;
    this.camera.position.y += (c.pos[1] - this.camera.position.y) * k;
    this.camera.position.z += (c.pos[2] - this.camera.position.z) * k;
    this._v3.set(c.look[0], c.look[1], c.look[2]);
    this.camera.lookAt(this._v3);
  }

  _tickCutscene(dt) {
    if (!this.cutscene) return;
    const prev = this.cutscene.index;
    this.cutscene.tick(dt);
    if (this.cutscene.index !== prev) this._showCutsceneLine();
    this._updateCameraForCutscene(dt);
    if (this.cutscene.done) this._finishCutscene();
  }

  _finishCutscene() {
    const after = this.cutsceneAfter;
    this.cutscene = null;
    this.cutsceneAfter = null;
    const el = $('cutscene');
    if (el) el.classList.add('hidden');
    this._last = performance.now();
    if (after === 'start') this._beginPlay();
    else if (after === 'boss') {
      this.state = 'playing';
      this._announce('曹操亲临战场，击败他！');
    } else if (after === 'victory' || after === 'defeat') {
      this.state = 'playing';
      const p = this._pendingEnd;
      this._pendingEnd = null;
      if (p) this._endRun(p.won, p.reason);
    } else {
      this.state = 'playing';
    }
  }

  // ---------------- 指针锁定（第五阶段） ----------------
  /** 请求指针锁定：开战/继续/点画面时调用。无手势、刚 Esc 退出冷却期内或
   * 无头环境下会被浏览器拒绝——必须接住 Promise rejection，否则控制台报错；
   * 失败不抛错，保留拖拽视角兜底，并提示一次点击画面重试。 */
  _requestPointerLock() {
    if (!this.renderer || this.pointerLocked) return;
    // 触屏设备没有鼠标，不请求锁定（触屏不受影响）
    if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) return;
    try {
      const r = this.renderer.domElement.requestPointerLock();
      if (r && typeof r.catch === 'function') r.catch(() => this._onLockFailed());
    } catch (e) { this._onLockFailed(); }
  }

  _onLockFailed() {
    if (this.state !== 'playing' || this._lockHintShown) return;
    this._lockHintShown = true;
    this._announce('鼠标未锁定：点击画面可锁定视角（滑动鼠标转视角）');
  }

  /** 退出指针锁定（暂停/结算/回标题时恢复光标） */
  _exitPointerLock() {
    try { if (document.pointerLockElement) document.exitPointerLock(); } catch (e) { /* 忽略 */ }
    this.pointerLocked = false;
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this._exitPointerLock();
    $('pause-screen').classList.remove('hidden');
    $('pause-title').textContent = '暂停';
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    $('pause-screen').classList.add('hidden');
    this._last = performance.now();
    // 继续战斗即重新请求锁定（点击/按键是手势，浏览器允许）
    this._requestPointerLock();
  }

  quitToMenu() {
    this.state = 'menu';
    this._exitPointerLock();
    this.cutscene = null;
    this.cutsceneAfter = null;
    const cutEl = $('cutscene');
    if (cutEl) cutEl.classList.add('hidden');
    $('pause-screen').classList.add('hidden');
    $('result-screen').classList.add('hidden');
    $('title-screen').classList.remove('hidden');
    this._showHud(false);
  }

  // ---------------- 主循环（固定 60Hz 模拟） ----------------
  _loop(now) {
    this._raf = requestAnimationFrame(this._loop);
    let dt = (now - this._last) / 1000;
    this._last = now;
    if (dt > 0.25) dt = 0.25;
    // 帧率用真实时间（performance.now）按 1 秒窗口计数，不用 rAF 时间戳的
    // 指数平滑：无头 Chromium 下 rAF 时间戳会走虚拟时间，1/dt 会虚报上百 fps，
    // 导致自适应永远不降档；真实时间窗口在真机与无头下都如实反映渲染快慢。
    const realNow = performance.now();
    this._fpsTimes.push(realNow);
    while (this._fpsTimes.length > 2 && realNow - this._fpsTimes[0] > 1000) this._fpsTimes.shift();
    if (this._fpsTimes.length >= 2 && realNow - this._fpsTimes[0] >= 500) {
      this._fps = (this._fpsTimes.length - 1) * 1000 / (realNow - this._fpsTimes[0]);
    }
    // 过场：真实时间推进，模拟冻结（敌军 AI 与计时都不走）
    if (this.state === 'cutscene') { this._tickCutscene(dt); this._render(); return; }
    // 自适应画质：只在战斗中按真实帧率升降
    if (this.state === 'playing') this._updateAdaptive(dt);
    if (this.state !== 'playing') { this._render(); return; }
    if (this.hitstopT > 0) { this.hitstopT -= dt; this._render(); return; }
    this._acc += dt;
    let steps = 0;
    while (this._acc >= STEP && steps < 5) {
      this._step(STEP);
      this._acc -= STEP;
      steps++;
    }
    if (steps === 5) this._acc = 0;
    this._updateCamera(dt);
    this._updateFx(dt);
    this._updateHudThrottled(dt);
    this._render();
  }

  _step(dt) {
    this.time += dt;
    const p = this.player;
    if (p.dead) return;
    p.combo.airborne = !p.grounded;
    p.combo.update(dt);
    const pending = p.combo.consumePending();
    if (pending) this._doAttack(pending);

    // ---- 移动（相机相对） ----
    let ix = 0, iz = 0;
    if (this.keys.KeyW || this.keys.ArrowUp) iz -= 1;
    if (this.keys.KeyS || this.keys.ArrowDown) iz += 1;
    if (this.keys.KeyA || this.keys.ArrowLeft) ix -= 1;
    if (this.keys.KeyD || this.keys.ArrowRight) ix += 1;
    const mag = Math.hypot(ix, iz);
    p.moveMag = mag > 0 ? 1 : 0;
    const busy = p.combo.busy;
    const mounted = this.mount.mounted;
    this.mount.update(dt, mag > 0 && !busy && !p.combo.dodging);
    if (p.combo.dodging) {
      // 闪避冲刺（骑乘时为马上短冲，速度更快）
      const ds = BALANCE.player.dodgeSpeed * (mounted ? 1.4 : 1);
      p.x += p.dodgeDir.x * ds * dt;
      p.z += p.dodgeDir.z * ds * dt;
    } else if (mag > 0 && !busy) {
      const sin = Math.sin(this.camYaw), cos = Math.cos(this.camYaw);
      // 相机在玩家身后：W = 远离相机方向
      const fx = -sin, fz = -cos;
      const rx = -cos, rz = sin;
      let mx = fx * -iz + rx * ix;
      let mz = fz * -iz + rz * ix;
      const ml = Math.hypot(mx, mz) || 1;
      mx /= ml; mz /= ml;
      const sp = p.speed * (p.combo.musouActive ? 1.25 : 1) * this.mount.speedMul();
      p.x += mx * sp * dt;
      p.z += mz * sp * dt;
      const targetFacing = Math.atan2(mx, mz);
      if (mounted) {
        // 骑乘转向变钝：角速度上限 MOUNT.turnRate
        let diff = targetFacing - p.facing;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        const maxStep = MOUNT.turnRate * dt;
        p.facing += Math.max(-maxStep, Math.min(maxStep, diff));
      } else {
        p.facing = targetFacing;
      }
      p.walkPhase += dt * (mounted ? 14 : 11);
    }
    // 骑乘冲锋：持续移动 2 秒后撞中小兵造成击飞伤害（每敌每轮只算一次）
    if (mounted && this.mount.chargeReady && mag > 0) {
      this._mountChargeHits();
      this._mountDustT -= dt;
      if (this._mountDustT <= 0) {
        this._mountDustT = 0.3;
        this._burstDebris(p.x - Math.sin(p.facing) * 1.5, p.z - Math.cos(p.facing) * 1.5, 0xc8b078, 3);
      }
    }
    // 跳跃 / 重力
    if (!p.grounded) {
      p.vy += BALANCE.player.gravity * dt;
      p.y += p.vy * dt;
      if (p.y <= 0) { p.y = 0; p.vy = 0; p.grounded = true; }
    }
    resolveCollisions(p, 0.5, this.world.colliders, this.world.bounds);
    // 骑乘时骑手坐在马鞍上（y≈1.05），马匹跟随玩家位置与朝向
    p.group.position.set(p.x, mounted ? 1.05 : p.y, p.z);
    p.group.rotation.y = p.facing;
    if (mounted && this.horse) {
      this.horse.group.position.set(p.x, 0, p.z);
      this.horse.group.rotation.y = p.facing;
    }

    // ---- 锁定 ----
    // 士兵用 alive，Boss 用 hp（Boss 没有 alive 字段）
    if (this.lockTarget) {
      const t = this.lockTarget;
      const dead = t.hp !== undefined ? t.hp <= 0 : !t.alive;
      if (dead) this.lockTarget = null;
    }
    if (this.lockTarget) {
      const t = this.lockTarget;
      const tx = t.x ?? t.group?.position.x, tz = t.z ?? t.group?.position.z;
      p.facing = Math.atan2(tx - p.x, tz - p.z);
      p.group.rotation.y = p.facing;
    }

    // ---- 待结算的出招命中 ----
    if (this.pendingHit) {
      this.pendingHit.t -= dt;
      if (this.pendingHit.t <= 0) {
        this._resolveHit(this.pendingHit);
        this.pendingHit = null;
      }
    }

    // ---- 敌人 / Boss / 波次 ----
    this.crowd.update(dt, p, (x, z) => this._nearestAlly(x, z));
    // ---- 箭矢模拟：玩家 + 友军为可命中目标 ----
    {
      const targets = [{ x: p.x, z: p.z, y0: p.y, y1: p.y + 2.0, radius: 0.7, kind: 'player', ref: p }];
      for (const s of this.crowd.soldiers) {
        if (s.alive && s.faction === 'ma') {
          targets.push({ x: s.x, z: s.z, y0: 0, y1: 2.0, radius: 0.85, kind: 'ally', ref: s });
        }
      }
      const hits = this.arrowPool.update(dt, targets);
      for (const h of hits) {
        this.sfx.arrowHit();
        if (h.target.kind === 'player') {
          this._arrowHitsTaken = (this._arrowHitsTaken || 0) + 1; // 平衡探针用：被箭命中次数
          this._onPlayerHit(h.arrow.dmg, p.x, p.z);
        } else this._onAllyHit(h.target.ref, h.arrow.dmg);
      }
    }
    // ---- 玩家远程弹丸模拟：敌兵 + Boss 为可命中目标；骑乘时也能远程（骑射） ----
    this.ranged.update(dt);
    {
      const shotTargets = [];
      for (const s of this.crowd.soldiers) {
        if (s.alive && s.faction === 'cao') {
          shotTargets.push({ x: s.x, z: s.z, y0: 0, y1: 2.2, radius: 0.85, kind: 'soldier', ref: s });
        }
      }
      if (this.bossSpawned && !this.boss.dead && this.boss.group.visible) {
        shotTargets.push({ x: this.boss.x, z: this.boss.z, y0: 0, y1: 3.4, radius: 1.6, kind: 'boss', ref: this.boss });
      }
      const shotHits = this.shotPool.update(dt, shotTargets);
      for (const h of shotHits) this._onShotHit(h);
    }
    // ---- 火矢灼烧区：每 0.5 秒 tick 一次，范围内的敌兵持续掉血 ----
    this._updateBurnZones(dt);
    this._updateBoss(dt);
    this._updateSpawner(dt);
    this._checkBossTrigger(); // 兜底：任何途径达成斩数都触发 Boss
    this._updateDrops(dt);
    this._updateComboTimer(dt);
    this._updateTrial(dt);

    // ---- 无双槽满提示 ----
    if (p.musou >= 100 && !this._musouNotified) {
      this._musouNotified = true;
      this._announce('无双已满！按 I 释放「' + this.charSpec.musouName + '」');
      this.sfx.musouReady();
      $('musou-bar').parentElement.classList.add('musou-ready');
    }
    if (p.musou < 100) { this._musouNotified = false; $('musou-bar').parentElement.classList.remove('musou-ready'); }

    // ---- 胜负（潼关胜利先播 7 秒结尾过场，可跳过，再进结算；试炼直接结算） ----
    if (this.modeId === 'tongguan' && this.bossDead && !this.victory) {
      this.victory = true; // 防重入：_endRun 里还会再设一次
      this._pendingEnd = { won: true, reason: '曹操败走，潼关大捷！' };
      this._startCutscene('victory', 'victory');
    }
    if (this.modeId === 'trial' && this.kills >= this.chapter.killTarget && !this.victory) {
      this._endRun(true, `千人斩达成！${this.kills} 斩`);
    }

    // ---- 动画 ----
    this._animatePlayer(dt);
    // ---- 霸体光圈：跟随玩家脚下，窗口内显示（HUD 图标在 _updateHudThrottled 里同步） ----
    if (this.armorRing) {
      const armored = p.combo.isArmored;
      this.armorRing.visible = armored;
      if (armored) {
        this.armorRing.position.set(p.x, 0.06, p.z);
        this.armorRing.material.opacity = 0.6 + 0.25 * Math.abs(Math.sin(this.time * 8));
      }
    }
  }

  // ---------------- 战斗输入 ----------------
  _pressAttack() {
    const p = this.player;
    if (p.dead) return;
    const act = p.combo.pressAttack();
    if (act) this._doAttack(act);
  }

  _pressCharge() {
    const p = this.player;
    if (p.dead) return;
    const act = p.combo.pressCharge();
    if (act) this._doAttack(act);
  }

  // ---------------- 玩家远程攻击（Q 键） ----------------
  /** Q：按武将发射远程（马超投枪 / 孙策飞矛×3 / 周瑜火矢 / 典韦飞戟） */
  _pressRanged() {
    const p = this.player;
    if (p.dead || p.combo.busy || p.combo.dodging) return;
    const spec = this.ranged.tryFire();
    if (!spec) return; // 冷却中：静默忽略（HUD 有冷却显示）
    // 瞄准：锁定目标优先，否则取射程内最近敌兵，否则朝当前面朝方向
    const target = this._rangedTarget(spec);
    if (target) {
      p.facing = Math.atan2(target.x - p.x, target.z - p.z);
      p.group.rotation.y = p.facing;
    }
    const mounted = this.mount.mounted;
    const dmg = spec.dmg * p.atk;
    for (const dir of this.ranged.fireDirections(p.facing, mounted)) {
      this.shotPool.fire({ x: p.x, y: p.y + 1.4, z: p.z }, dir, spec, dmg);
    }
    this.sfx.ranged(spec.kind);
    if (spec.kind === 'fire') this._announce('火矢！落点灼烧 3 秒');
  }

  _rangedTarget(spec) {
    const p = this.player;
    const range = this.ranged.effectiveRange(this.mount.mounted);
    if (this.lockTarget && this.lockTarget.hp > 0) {
      const t = this.lockTarget;
      if (Math.hypot(t.x - p.x, t.z - p.z) <= range + 10) return t;
    }
    if (this.bossSpawned && !this.boss.dead) {
      const b = this.boss;
      if (Math.hypot(b.x - p.x, b.z - p.z) <= range + 10) return b;
    }
    return this.crowd.nearestEnemy(p.x, p.z, range);
  }

  /** 远程弹丸命中：士兵扣血（击杀计入斩数/连击/无双），Boss 走 _damageBoss，火矢留灼烧区 */
  _onShotHit(h) {
    const p = this.player;
    const shot = h.shot;
    const dmg = shot.dmg;
    if (h.target.kind === 'boss') {
      this._damageBoss(dmg);
      this.sfx.hit(true);
    } else {
      const s = h.target.ref;
      if (!s || !s.alive) return;
      const dx = s.x - p.x, dz = s.z - p.z;
      const d = Math.hypot(dx, dz) || 1;
      const killed = this.crowd.damage(s, dmg, dx / d, dz / d, 6);
      this._dmgNum(s.x, (s.y || 0) + 2.1, s.z, Math.round(dmg), '#ffb36b');
      p.musou = Math.min(100, p.musou + (this.ranged.spec.musouGain || 3) * this.charSpec.stats.musouGain);
      this.sfx.hit(false);
      if (killed) this._registerKill(s);
    }
    if (shot.kind === 'fire' && shot.burnDps > 0) {
      this._addBurnZone(h.target.x, h.target.z, shot.burnRadius, shot.burnDps, shot.burnDur);
      this._burstDebris(h.target.x, h.target.z, 0xff7a1a, 8);
    }
  }

  _addBurnZone(x, z, radius, dps, dur) {
    if (this.burnZones.length >= 4) this.burnZones.shift();
    this.burnZones.push({ zone: new BurnZone(x, z, radius, dps, dur), mesh: null });
  }

  _clearBurnZones() {
    this.burnZones = [];
    if (this.burnMeshes) for (const m of this.burnMeshes) m.visible = false;
  }

  /** 灼烧区 tick：每 0.5 秒对区内敌兵造成伤害，击杀计入斩数 */
  _updateBurnZones(dt) {
    for (let i = this.burnZones.length - 1; i >= 0; i--) {
      const entry = this.burnZones[i];
      const zone = entry.zone;
      const shouldTick = zone.update(dt);
      if (!zone.alive) {
        if (entry.mesh) entry.mesh.visible = false;
        this.burnZones.splice(i, 1);
        continue;
      }
      if (shouldTick) {
        for (const s of this.crowd.soldiers) {
          if (!s.alive || s.faction !== 'cao') continue;
          if (Math.hypot(s.x - zone.x, s.z - zone.z) > zone.radius) continue;
          const killed = this.crowd.damage(s, zone.tickDamage, 0, 0, 0);
          this._dmgNum(s.x, (s.y || 0) + 2.1, s.z, Math.round(zone.tickDamage), '#ff7a1a');
          if (killed) this._registerKill(s);
        }
      }
    }
    // 地面标记：按灼烧区数量点亮对应 mesh，闪烁表示剩余时间
    if (this.burnMeshes) {
      this.burnMeshes.forEach((m, idx) => {
        const entry = this.burnZones[idx];
        if (!entry) { m.visible = false; return; }
        const zone = entry.zone;
        entry.mesh = m;
        m.visible = true;
        m.position.set(zone.x, 0.06, zone.z);
        const r = zone.radius * 2;
        m.scale.set(r, 1, r);
        m.material.opacity = 0.22 + 0.18 * Math.abs(Math.sin(this.time * 9 + idx));
      });
    }
  }

  /** 击杀记账（近战 _afterHits 与远程/灼烧共用）：斩数、连击、无双已在调用处加 */
  _registerKill(s) {
    this.kills++;
    this.combo++;
    this.comboT = 3;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    this.sfx.kill();
    this._burstDebris(s.x, s.z, 0x33415e, 10);
    this._maybeDrop(s.x, s.z);
    this._checkBossTrigger();
  }

  _pressDodge() {
    const p = this.player;
    if (p.dead || !p.combo.pressDodge()) return;
    // 闪避方向 = 当前移动方向，否则面朝方向
    let ix = 0, iz = 0;
    if (this.keys.KeyW) iz -= 1;
    if (this.keys.KeyS) iz += 1;
    if (this.keys.KeyA) ix -= 1;
    if (this.keys.KeyD) ix += 1;
    if (ix || iz) {
      const sin = Math.sin(this.camYaw), cos = Math.cos(this.camYaw);
      const mx = -sin * -iz + -cos * ix;
      const mz = -cos * -iz + sin * ix;
      const l = Math.hypot(mx, mz) || 1;
      p.dodgeDir = { x: mx / l, z: mz / l };
    } else {
      p.dodgeDir = { x: Math.sin(p.facing), z: Math.cos(p.facing) };
    }
    this.sfx.dodge();
  }

  _pressJump() {
    const p = this.player;
    if (p.dead || p.combo.busy) return;
    // 骑乘时空格不是跳跃，而是冲刺爆发（0.5 秒 ×2.2，冷却 3 秒）
    if (this.mount.mounted) {
      if (this.mount.tryDash()) { this.sfx.charge(); this._announce('冲刺！'); }
      return;
    }
    if (!p.grounded) return;
    p.vy = BALANCE.player.jumpVel;
    p.grounded = false;
    this.sfx.jump();
  }

  // ---------------- 坐骑 ----------------
  /** F：上马 / 下马（须靠近马匹 2.5 米内；骑乘中随时可下马） */
  _toggleMount() {
    const p = this.player;
    if (p.dead || this.mount.mounted) { this._dismount('下马'); return; }
    if (!this.horse) return;
    const d = Math.hypot(this.horse.group.position.x - p.x, this.horse.group.position.z - p.z);
    if (d > 2.5) { this._announce('离马太远了，靠近马匹按 F 上马'); return; }
    this.mount.mount();
    this.sfx.mount();
    this._announce('已上马！移速提升，持续移动 2 秒进入冲锋，空格冲刺');
  }

  _dismount(reason = '下马') {
    if (!this.mount.mounted) return;
    this.mount.dismount();
    const p = this.player;
    p.group.position.y = p.y;
    // 马匹留在原地，可再上
    if (this.horse) this.horse.group.position.set(p.x, 0, p.z);
    if (reason) this._announce(reason);
  }

  /** 冲锋撞击：前方 2.6 米、±75° 内的敌军每轮只撞一次；Boss 同理 */
  _mountChargeHits() {
    const p = this.player;
    const dmg = MOUNT.chargeDmg * p.atk;
    const hits = [];
    for (const s of this.crowd.soldiers) {
      if (!s.alive || s.faction !== 'cao') continue;
      const dx = s.x - p.x, dz = s.z - p.z;
      if (Math.hypot(dx, dz) > MOUNT.chargeRange + 0.5) continue;
      const ang = Math.atan2(dx, dz);
      let diff = ang - p.facing;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      if (Math.abs(diff) > 1.3) continue;
      if (!this.mount.noteChargeHit(s.id)) continue;
      this.crowd.damage(s, dmg, dx / (Math.hypot(dx, dz) || 1), dz / (Math.hypot(dx, dz) || 1), MOUNT.chargeKb);
      hits.push(s);
    }
    if (this.bossSpawned && !this.boss.dead && !this.mount.bossCharged) {
      const b = this.boss;
      if (Math.hypot(b.x - p.x, b.z - p.z) < MOUNT.chargeRange + 1.2) {
        this.mount.bossCharged = true;
        this._bossMeleeCheck(MOUNT.chargeRange + 1.2, dmg, MOUNT.chargeKb);
      }
    }
    if (hits.length) {
      this._afterHits(hits, true);
      this.sfx.hit(true);
      this._burstDebris(p.x + Math.sin(p.facing) * 2, p.z + Math.cos(p.facing) * 2, 0xffd23e, 8);
    }
  }

  _tryMusou() {
    const p = this.player;
    if (p.dead || p.musou < 100) return;
    if (!p.combo.tryMusou()) return;
    p.musou = 0;
    document.body.classList.add('musou-mode');
    setTimeout(() => document.body.classList.remove('musou-mode'), BALANCE.player.musouDuration * 1000);
    this._announce(`${this.charSpec.name} · ${this.charSpec.musouName}！`);
    this.sfx.musou();
    // 无双开场冲击：周围敌人全部击飞
    const hits = this.crowd.applyMelee(p.x, p.z, p.facing, BALANCE.musouAtk.range, Math.PI * 2, 30 * p.atk, 18);
    this._bossMeleeCheck(BALANCE.musouAtk.range, 30 * p.atk, 10);
    this._afterHits(hits, true);
    this.hitstopT = BALANCE.hitstop.musou;
    this._burstDebris(p.x, p.z, 0xd8a928, 24);
  }

  _toggleLock() {
    if (this.lockTarget) { this.lockTarget = null; $('lock-indicator').classList.add('hidden'); return; }
    // 优先 Boss，其次最近武将/精锐
    if (this.bossSpawned && !this.boss.dead) { this.lockTarget = this.boss; }
    else {
      let best = null, bd = 40;
      for (const s of this.crowd.soldiers) {
        if (!s.alive || s.faction !== 'cao' || !s.elite) continue;
        const d = Math.hypot(s.x - this.player.x, s.z - this.player.z);
        if (d < bd) { bd = d; best = s; }
      }
      this.lockTarget = best || this.crowd.nearestEnemy(this.player.x, this.player.z, 40);
    }
    if (this.lockTarget) $('lock-indicator').classList.remove('hidden');
  }

  _toggleMute() {
    this.sfx.ensure();
    this.sfx.setMuted(!this.sfx.muted);
    this._announce(this.sfx.muted ? '已静音（M 恢复）' : '音效已开启');
  }

  _showHelp(show) {
    $('help-screen').classList.toggle('hidden', !show);
    if (show) this.pause();
  }

  // ---------------- 出招与命中结算 ----------------
  _doAttack(act) {
    const p = this.player;
    // 第五阶段：上一招的待结算命中若还在（J 后 0.09 秒内按 K），先立即结算再出新招，
    // 否则 pendingHit 会被覆盖丢掉一次命中（旧行为：J→K 极快连按会吞掉 J 的伤害）。
    if (this.pendingHit) {
      this._resolveHit(this.pendingHit);
      this.pendingHit = null;
    }
    p.attackKind = act.kind;
    p.attackStage = act.stage;
    p.attackAnimT = 0;
    this.sfx.swing(act.stage || 1);
    // 命中发生在挥舞中段
    const spec = act.kind === 'normal' ? BALANCE.combo[act.stage - 1]
      : act.kind === 'charge' ? BALANCE.charge[act.stage - 1]
      : BALANCE.airAtk;
    const delay = act.kind === 'charge' ? 0.16 : 0.09;
    this.pendingHit = {
      t: delay, kind: act.kind, stage: act.stage,
      range: spec.range * (p.combo.musouActive ? 1.25 : 1) * (this.charSpec.stats.range / 3.4) * (this.mount.mounted ? MOUNT.attackRangeMul : 1),
      arc: spec.arc, dmg: spec.dmg, kb: spec.kb, aoe: spec.aoe || 0,
    };
    // 蓄力终结带小跳步前冲
    if (act.kind === 'charge') {
      p.x += Math.sin(p.facing) * 0.8;
      p.z += Math.cos(p.facing) * 0.8;
    }
  }

  _resolveHit(h) {
    const p = this.player;
    const musou = p.combo.musouActive;
    let dmg = 10 * h.dmg * p.atk * (musou ? 1.6 : 1);
    // 主扇形先结算；范围冲击圈只打扇形外的人（第五阶段修：旧版两圈各算一次，
    // 重叠区同一敌人一次蓄力吃两次伤害 1.0 + 0.6 倍，见 PROGRESS 第五阶段缺陷 3）。
    const hits = this.crowd.applyMelee(p.x, p.z, p.facing, h.range, h.arc, dmg, h.kb, { musou });
    if (h.kind === 'charge' && h.aoe > 0) {
      const extra = this.crowd.applyMelee(p.x, p.z, p.facing, h.range + 1.5, Math.PI * 2, dmg * 0.6, h.kb * 0.7,
        { exclude: new Set(hits.map((s) => s.id)) });
      this._afterHits(extra, false);
    }
    this._bossMeleeCheck(h.range, dmg, h.kb);
    this._afterHits(hits, h.kind === 'charge' || h.stage === 6);
    if (hits.length > 0) {
      this.sfx.hit(h.kind === 'charge' || h.stage >= 5);
      this.hitstopT = h.kind === 'charge' ? BALANCE.hitstop.heavy : BALANCE.hitstop.light;
      this._burstDebris(
        p.x + Math.sin(p.facing) * 2, p.z + Math.cos(p.facing) * 2,
        0xffd23e, 6 + hits.length * 2,
      );
    }
    this.damageDealt += hits.length * dmg;
  }

  _afterHits(hits, heavy) {
    const p = this.player;
    for (const s of hits) {
      this._dmgNum(s.x, s.y + 2.1, s.z, Math.round(10 * p.atk * (heavy ? 1.5 : 1)), '#ffd23e');
      p.musou = Math.min(100, p.musou + (ENEMY_TYPES[s.type]?.musou || 2) * this.charSpec.stats.musouGain);
      if (!s.alive) this._registerKill(s);
    }
  }

  /** Boss 受击（近战与远程共用）：扣血、飘字、无双 +6，死则结算 Boss */
  _damageBoss(dmg) {
    const b = this.boss;
    if (!this.bossSpawned || b.dead || !b.group.visible) return false;
    const p = this.player;
    b.hp -= dmg;
    b.flash = 0.15;
    this._dmgNum(b.x, 3.2, b.z, Math.round(dmg), '#ff9a5a');
    p.musou = Math.min(100, p.musou + 6);
    this.sfx.bossHit();
    if (b.hp <= 0) {
      b.hp = 0; b.dead = true;
      this.bossDead = true;
      this._clearBossTelegraph(); // 死时清掉前摇警告与闪红（否则警告残留在结算前）
      this._burstDebris(b.x, b.z, 0x6b3fa0, 40);
      this.kills += 10;
      this._announce('曹操已败！');
      this.sfx.victory();
    }
    return true;
  }

  _bossMeleeCheck(range, dmg, kb) {
    const b = this.boss;
    if (!this.bossSpawned || b.dead || !b.group.visible) return;
    const p = this.player;
    const d = Math.hypot(b.x - p.x, b.z - p.z);
    if (d > range + 1.2) return;
    const ang = Math.atan2(b.x - p.x, b.z - p.z);
    let diff = ang - p.facing;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    if (Math.abs(diff) > 1.6 && d > 1.5) return;
    this._damageBoss(dmg);
  }

  _onSoldierDeath(s) { /* 结算已在 _afterHits 处理 */ }

  /**
   * 玩家受击（第五阶段重写，见 PROGRESS 缺陷 1/2）：
   * takeHit 返回 false → 免疫（闪避/无双/受击无敌帧内），不扣血、不硬直；
   * 返回 'armor' → 霸体窗口内：扣血（按武将 dmgMul 减伤），不打断、不硬直、
   * 不清连段、不取消待结算出招，落马按减伤后伤害判定；
   * 返回 true → 命中：扣血、0.28 秒硬直、取消待结算出招，并挂 0.5 秒受击无敌帧。
   */
  _onPlayerHit(dmg, x, z, isBossCharge = false) {
    const p = this.player;
    if (p.dead) return;
    const res = p.combo.takeHit(dmg);
    if (res === false) return; // 免疫：不扣血
    const armored = res === 'armor';
    const effDmg = armored ? dmg * (p.combo.armor?.dmgMul ?? 1) : dmg;
    if (!armored) this.pendingHit = null; // 硬直取消待结算出招（霸体则保留，出招继续）
    // 落马：单次重击 ≥20，或 Boss 冲锋撞中（霸体按减伤后伤害判定，Boss 冲锋撞中仍必落马）
    if (this.mount.mounted && shouldFallFromHit(effDmg, isBossCharge)) {
      this._dismount('被撞落马！');
    }
    p.hp -= effDmg;
    // 霸体受击不闪红（脚下金圈 + HUD 图标已是反馈）；普通受击才闪红
    if (!armored) p.hurtFlash = 0.3;
    this.damageTaken += effDmg;
    this.combo = 0;
    this.sfx.hurt();
    this._dmgNum(p.x, p.y + 2.2, p.z, `-${Math.round(effDmg)}`, '#ff5a4a');
    this._shake(0.25);
    if (p.hp <= 0) {
      p.hp = 0; p.dead = true;
      // 败北先播一句台词（2.5 秒，可跳过），再进结算
      this._pendingEnd = { won: false, reason: '马超力战而亡……' };
      this._startCutscene('defeat', 'defeat');
    }
  }

  _onAllyHit(s, dmg) {
    // 友军血量简化：精锐友军被打 3 下倒下
    s.hp -= dmg;
    if (s.hp <= 0) this.crowd.kill(s);
  }

  _nearestAlly(x, z) {
    let best = null, bd = 1e9;
    for (const s of this.crowd.soldiers) {
      if (!s.alive || s.faction !== 'ma') continue;
      const d = Math.hypot(s.x - x, s.z - z);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  /** 第五阶段：清掉 Boss 前摇预告（屏幕警告 + 全身闪红），在伤害落点调用 */
  _clearBossTelegraph() {
    $('boss-warning').classList.add('hidden');
    if (this.boss) {
      this.boss.rig.group.traverse((o) => { if (o.isMesh) o.material.emissive?.setRGB?.(0, 0, 0); });
    }
  }

  // ---------------- Boss AI ----------------
  _updateBoss(dt) {
    const b = this.boss;
    if (!this.bossSpawned || b.dead) return;
    const p = this.player;
    b.stateT -= dt;
    b.atkCd -= dt;
    b.flash = Math.max(0, b.flash - dt);
    const dx = p.x - b.x, dz = p.z - b.z;
    const d = Math.hypot(dx, dz);
    const g = b.group;

    if (b.state === 'windup') {
      b.facing = Math.atan2(dx, dz);
      // 前摇预告：全身闪红 + 感叹号
      const f = 0.5 + 0.5 * Math.sin(this.time * 22);
      b.rig.group.traverse((o) => {
        if (o.isMesh) o.material.emissive?.setRGB?.(f * 0.9, f * 0.1, f * 0.1);
      });
      $('boss-warning').classList.remove('hidden');
      if (b.stateT <= 0) {
        // 第五阶段修：旧版前摇一结束就熄警告、清闪红，但伤害落在 0.3–0.55 秒后
        // （横扫结算 / 冲锋撞线），警告消失时伤害还没来，玩家会误判安全；
        // 现改为警告与闪红持续到伤害落点（横扫结算 / 冲锋结束）才清。
        if (b.telegraph === 'charge') { b.state = 'charging'; b.stateT = 0.55; this.sfx.bossRoar(); }
        else { b.state = 'sweep'; b.stateT = 0.3; }
      }
    } else if (b.state === 'charging') {
      b.x += Math.sin(b.facing) * 17 * dt;
      b.z += Math.cos(b.facing) * 17 * dt;
      b.walkPhase += dt * 16;
      if (d < 2.2 && !p.combo.invulnerable && !p.dead) this._onPlayerHit(BOSS.atk * 1.4, b.x, b.z, true); // Boss 冲锋撞中必落马
      if (b.stateT <= 0) { this._clearBossTelegraph(); b.state = 'recover'; b.stateT = 0.9; }
    } else if (b.state === 'sweep') {
      if (b.stateT <= 0) {
        if (d < 4.2) this._onPlayerHit(BOSS.atk, b.x, b.z);
        this._burstDebris(b.x + Math.sin(b.facing) * 2, b.z + Math.cos(b.facing) * 2, 0xb06bd8, 14);
        this._clearBossTelegraph();
        b.state = 'recover'; b.stateT = 1.0;
      }
    } else if (b.state === 'recover') {
      if (b.stateT <= 0) b.state = 'chase';
    } else {
      // chase
      if (d > 2.4) {
        b.x += (dx / d) * b.speed * dt;
        b.z += (dz / d) * b.speed * dt;
        b.facing = Math.atan2(dx, dz);
        b.walkPhase += dt * 9;
      } else if (b.atkCd <= 0) {
        b.state = 'windup';
        b.telegraph = Math.random() < 0.45 ? 'charge' : 'sweep';
        b.stateT = b.telegraph === 'charge' ? 0.7 : 0.55;
        b.atkCd = 2.2 + Math.random();
      }
    }
    resolveCollisions(b, 0.7, this.world.colliders, this.world.bounds);
    g.position.set(b.x, b.y, b.z);
    g.rotation.y = b.facing;
    // 走路摆腿
    const swing = Math.sin(b.walkPhase) * (b.state === 'chase' || b.state === 'charging' ? 0.5 : 0.08);
    b.rig.legL.rotation.x = swing;
    b.rig.legR.rotation.x = -swing;
    b.rig.armR.rotation.x = b.state === 'windup' ? -2.2 : (b.state === 'sweep' ? 1.4 : -0.3);
    if (b.flash > 0) {
      b.rig.group.traverse((o) => { if (o.isMesh) o.material.emissive?.setRGB?.(0.5, 0.5, 0.5); });
      if (b.flash < 0.05) b.rig.group.traverse((o) => { if (o.isMesh) o.material.emissive?.setRGB?.(0, 0, 0); });
    }
  }

  _checkBossTrigger() {
    if (this.modeId !== 'tongguan' || this.bossSpawned) return;
    if (this.kills >= this.chapter.bossAfterKills) {
      this.bossSpawned = true;
      const b = this.boss;
      b.group.visible = true;
      b.x = this.world.spawns.boss.x; b.z = this.world.spawns.boss.z;
      b.group.position.set(b.x, 0, b.z);
      $('boss-bar-wrap').classList.remove('hidden');
      this.sfx.bossRoar();
      // 余敌清场一半，聚焦 Boss 战
      let n = 0;
      for (const s of this.crowd.soldiers) {
        if (s.alive && s.faction === 'cao' && n++ > 12) this.crowd.kill(s, true);
      }
      // Boss 登场过场（约 5 秒，可跳过；期间敌军 AI 与计时冻结）
      this._startCutscene('boss', 'boss');
    }
  }

  // ---------------- 波次生成器 ----------------
  _startWave() {
    if (this.modeId === 'endless' || this.modeId === 'trial') {
      this.wave = 1;
      // 第五阶段：首波人数下调约 30%（试炼 40→28，演武 16→11）
      this.waveQuota = this.modeId === 'trial' ? 28 : 11;
    } else {
      this.wave = 1;
      this.waveQuota = this.chapter.waves[0];
    }
    this.waveSpawned = 0;
    this.spawnT = 0;
  }

  _updateSpawner(dt) {
    if (this.bossSpawned && this.modeId === 'tongguan') {
      // Boss 战期间只补少量小兵
      if (this.crowd.aliveCount('cao') < 6) this._spawnBatch(2);
      return;
    }
    if (this.waveSpawned >= this.waveQuota) {
      // 波次打完 → 下一波
      if (this.crowd.aliveCount('cao') <= 4) {
        this.wave++;
        if (this.modeId === 'tongguan') {
          if (this.wave > this.chapter.waves.length) {
            // 章节小兵已出完：若未达 Boss 触发线，继续补兵直到达标
            if (this.kills < this.chapter.bossAfterKills) {
              this.waveQuota = 12; this.waveSpawned = 0;
            } else return;
          } else {
            this.waveQuota = this.chapter.waves[this.wave - 1];
            this.waveSpawned = 0;
            this._announce(`第 ${this.wave} 波敌军杀到！`);
            this.sfx.waveHorn();
          }
        } else if (this.modeId === 'endless') {
          // 第五阶段：后续波次 14+波×4 → 10+波×3（约 -28%）
          this.waveQuota = 10 + this.wave * 3;
          this.waveSpawned = 0;
          this._announce(`第 ${this.wave} 波！敌军 ${this.waveQuota} 人`);
          this.sfx.waveHorn();
        } else { // trial
          // 第五阶段：试炼每波 45→32（约 -29%）；目标 240 斩不动，波次无限续
          this.waveQuota = 32;
          this.waveSpawned = 0;
        }
      }
      return;
    }
    this.spawnT -= dt;
    if (this.spawnT <= 0 && this.crowd.aliveCount('cao') < this._maxAliveCap) {
      // 第五阶段：试炼每批 4→3 人（同屏更少，节奏放缓）；间隔见 BALANCE.spawn.interval（0.75 秒）
      this._spawnBatch(this.modeId === 'trial' ? 3 : 2);
      this.spawnT = BALANCE.spawn.interval;
    }
    // 友军补员
    this._allyRespawnT -= dt;
    if (this.crowd.aliveCount('ma') === 0 && this._allyRespawnT <= 0) {
      this._spawnAllies();
      this._allyRespawnT = 25;
    }
  }

  /**
   * 第五阶段：出生点按 8 点轮询 + 单点抖动 + 同批次最小间距 3 米分配
   * （旧版只在北/东/西 3 点周围 ±4 米随机刷，天然扎堆）。
   * 轮询下标跨批次连续，同一批次内不重复用点（每批 ≤3 人 < 8 点）。
   */
  _spawnBatch(n) {
    const pts = this.world.spawns.spawnPoints
      || [this.world.spawns.north, this.world.spawns.east, this.world.spawns.west];
    const { positions, nextIdx } = pickSpawnPositions(pts, n, this._spawnPtIdx);
    this._spawnPtIdx = nextIdx;
    // 弓手占比随波次上升：15% 起，+2%/波，上限 25%
    const archerShare = archerShareForWave(this.wave);
    for (let i = 0; i < positions.length && this.waveSpawned < this.waveQuota; i++) {
      const pt = positions[i];
      const r = Math.random();
      const type = r < 0.45 ? 'soldier'
        : r < 0.70 ? 'spearman'
        : r < 0.70 + archerShare ? 'archer' : 'elite';
      const s = this.crowd.spawn(type, pt.x, pt.z, 'cao');
      if (s) this.waveSpawned++;
    }
  }

  _updateTrial(dt) {
    if (this.modeId !== 'trial') return;
    this.trialLeft -= dt;
    if (this.trialLeft <= 0) {
      this.trialLeft = 0;
      this._endRun(this.kills >= this.chapter.killTarget, `时间到！共斩 ${this.kills} 人`);
    }
  }

  _updateComboTimer(dt) {
    if (this.comboT > 0) {
      this.comboT -= dt;
      if (this.comboT <= 0) this.combo = 0;
    }
  }

  // ---------------- 掉落与特效 ----------------
  _maybeDrop(x, z) {
    if (Math.random() > BALANCE.dropChance) return;
    const d = this.drops.find((o) => !o.active);
    if (!d) return;
    d.active = true; d.x = x; d.z = z; d.life = 20; d.bob = Math.random() * 6;
    d.group.visible = true;
    d.group.position.set(x, 0.1, z);
    this.sfx.drop();
  }

  _updateDrops(dt) {
    const p = this.player;
    for (const d of this.drops) {
      if (!d.active) continue;
      d.life -= dt; d.bob += dt * 3;
      d.group.position.y = 0.1 + Math.abs(Math.sin(d.bob)) * 0.15;
      d.group.rotation.y += dt * 2;
      if (d.life <= 0) { d.active = false; d.group.visible = false; continue; }
      if (Math.hypot(p.x - d.x, p.z - d.z) < 1.3 && p.hp < p.maxHp) {
        p.hp = Math.min(p.maxHp, p.hp + BALANCE.dropHeal);
        d.active = false; d.group.visible = false;
        this.sfx.heal();
        this._dmgNum(p.x, p.y + 2.2, p.z, `+${BALANCE.dropHeal}`, '#7dff8a');
      }
    }
  }

  _burstDebris(x, z, color, n) {
    let c = 0;
    for (const d of this.debris) {
      if (d.life > 0) continue;
      d.life = 0.5 + Math.random() * 0.4;
      d.mesh.visible = true;
      d.mesh.material.color.setHex(color);
      d.mesh.position.set(x + (Math.random() - 0.5), 1 + Math.random(), z + (Math.random() - 0.5));
      const a = Math.random() * Math.PI * 2;
      d.vx = Math.cos(a) * (2 + Math.random() * 5);
      d.vz = Math.sin(a) * (2 + Math.random() * 5);
      d.vy = 3 + Math.random() * 5;
      d.spin = (Math.random() - 0.5) * 12;
      if (++c >= n) break;
    }
  }

  _updateFx(dt) {
    // 箭矢渲染：按逻辑池位置/速度定向（长轴沿速度方向）
    if (this.arrowMesh) {
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const zAxis = new THREE.Vector3(0, 0, 1);
      const dir = new THREE.Vector3();
      const pos = new THREE.Vector3();
      const scl = new THREE.Vector3(1, 1, 1);
      const zero = new THREE.Matrix4().makeScale(0, 0, 0);
      this.arrowPool.arrows.forEach((a, i) => {
        if (!a.active) { this.arrowMesh.setMatrixAt(i, zero); return; }
        dir.set(a.vx, a.vy, a.vz).normalize();
        q.setFromUnitVectors(zAxis, dir);
        pos.set(a.x, a.y, a.z);
        m.compose(pos, q, scl);
        this.arrowMesh.setMatrixAt(i, m);
      });
      this.arrowMesh.instanceMatrix.needsUpdate = true;
    }
    // 玩家远程弹丸渲染：按逻辑池位置/速度定向，颜色按武将远程种类
    if (this.shotMesh) {
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const zAxis = new THREE.Vector3(0, 0, 1);
      const dir = new THREE.Vector3();
      const pos = new THREE.Vector3();
      const scl = new THREE.Vector3(1, 1, 1);
      const zero = new THREE.Matrix4().makeScale(0, 0, 0);
      const col = new THREE.Color();
      this.shotPool.shots.forEach((s, i) => {
        if (!s.active) { this.shotMesh.setMatrixAt(i, zero); return; }
        dir.set(s.vx, s.vy, s.vz).normalize();
        q.setFromUnitVectors(zAxis, dir);
        pos.set(s.x, s.y, s.z);
        m.compose(pos, q, scl);
        this.shotMesh.setMatrixAt(i, m);
        this.shotMesh.setColorAt(i, col.setHex(s.color));
        // 火矢拖尾：每帧小概率撒一粒橙色碎块
        if (s.kind === 'fire' && Math.random() < 0.4) this._burstDebris(s.x, s.z, 0xff7a1a, 1);
      });
      this.shotMesh.instanceMatrix.needsUpdate = true;
      if (this.shotMesh.instanceColor) this.shotMesh.instanceColor.needsUpdate = true;
    }
    for (const d of this.debris) {
      if (d.life <= 0) continue;
      d.life -= dt;
      if (d.life <= 0) { d.mesh.visible = false; continue; }
      d.vy -= 22 * dt;
      d.mesh.position.x += d.vx * dt;
      d.mesh.position.y += d.vy * dt;
      d.mesh.position.z += d.vz * dt;
      if (d.mesh.position.y < 0.08) { d.mesh.position.y = 0.08; d.vy = 0; d.vx *= 0.7; d.vz *= 0.7; }
      d.mesh.rotation.x += d.spin * dt;
      d.mesh.rotation.y += d.spin * dt;
    }
    // 旗帜飘动
    for (const f of this.world.flags) {
      f.cloth.rotation.y = Math.sin(this.time * 2 + f.phase) * 0.25;
    }
    for (const t of this.world.torches) {
      const s = 1 + Math.sin(this.time * 11 + t.position.x) * 0.18;
      t.scale.set(s, s, s);
    }
    // 飘字
    for (let i = this.dmgNums.length - 1; i >= 0; i--) {
      const n = this.dmgNums[i];
      n.life -= dt;
      if (n.life <= 0) { n.el.remove(); this.dmgNums.splice(i, 1); continue; }
      n.y += dt * 34;
      n.el.style.transform = `translate(-50%, -50%) translate(${n.x}px, ${-n.y}px)`;
      n.el.style.opacity = Math.min(1, n.life / 0.4);
    }
  }

  // 第五阶段修：旧版 z 硬编码 this.player.z，敌人的飘字按玩家 z 投影，
  // 离玩家越远偏差越大（飘字不落在被打的敌人头上）；现改为显式传 z。
  _dmgNum(x, y, z, text, color) {
    const layer = $('dmg-layer');
    if (this.dmgNums.length > 24) return;
    this._v3.set(x, y, z);
    const v = this._v3.clone().project(this.camera);
    if (v.z > 1) return;
    const el = document.createElement('div');
    el.className = 'dmg-num';
    el.textContent = text;
    el.style.color = color;
    const sx = (v.x * 0.5 + 0.5) * this.container.clientWidth;
    const sy = (-v.y * 0.5 + 0.5) * this.container.clientHeight;
    layer.appendChild(el);
    this.dmgNums.push({ el, x: sx, y: sy, life: 0.8 });
  }

  _shake(amount) {
    this._shakeT = amount;
  }

  // ---------------- 玩家动画 ----------------
  _animatePlayer(dt) {
    const p = this.player;
    const rig = p.rig;
    const moving = p.moveMag > 0 && !p.combo.busy;
    const swing = moving ? Math.sin(p.walkPhase) * 0.55 : 0;
    rig.legL.rotation.x = swing;
    rig.legR.rotation.x = -swing;
    rig.armL.rotation.x = moving ? -swing * 0.7 : 0;
    // 攻击挥臂：按招式进度扫过
    if (p.combo.busy && p.attackKind) {
      const spec = p.attackKind === 'normal' ? BALANCE.combo[p.attackStage - 1]
        : p.attackKind === 'charge' ? BALANCE.charge[p.attackStage - 1] : BALANCE.airAtk;
      const total = spec.dur || 0.34;
      const prog = 1 - Math.max(0, p.combo.stageT) / total;
      const sweep = Math.sin(Math.min(1, prog * 1.15) * Math.PI);
      rig.armR.rotation.x = -0.6 - sweep * 1.6;
      rig.armR.rotation.z = sweep * 0.7;
      rig.group.rotation.x = sweep * 0.08;
    } else {
      rig.armR.rotation.x += (moving ? swing * 0.7 : -0.15 - rig.armR.rotation.x) * 0.2;
      rig.armR.rotation.z *= 0.8;
      rig.group.rotation.x *= 0.8;
    }
    if (p.combo.dodging) {
      rig.group.rotation.x = -0.9; // 前滚翻
    }
    if (!p.grounded) {
      rig.legL.rotation.x = 0.5;
      rig.legR.rotation.x = -0.3;
    }
    // 坐骑动画：骑乘时骑手双腿收拢、马腿按步频奔跑；未骑乘马腿静止
    if (this.horse) {
      const gallop = (this.mount.mounted && moving) ? Math.sin(p.walkPhase) * 0.6 : 0;
      this.horse.legFL.rotation.x = gallop;
      this.horse.legBR.rotation.x = gallop;
      this.horse.legFR.rotation.x = -gallop;
      this.horse.legBL.rotation.x = -gallop;
    }
    if (this.mount.mounted) { rig.legL.rotation.x = 0.5; rig.legR.rotation.x = 0.5; }
    // 受击闪红
    if (p.hurtFlash > 0) {
      p.hurtFlash -= dt;
      rig.group.traverse((o) => { if (o.isMesh) o.material.emissive?.setRGB?.(0.6, 0.05, 0.05); });
      if (p.hurtFlash <= 0) rig.group.traverse((o) => { if (o.isMesh) o.material.emissive?.setRGB?.(0, 0, 0); });
    }
  }

  // ---------------- 相机 ----------------
  _updateCamera(dt) {
    const p = this.player;
    let targetYaw = this.camYaw;
    if (this.lockTarget) {
      const t = this.lockTarget;
      const tx = t.x ?? t.group?.position.x, tz = t.z ?? t.group?.position.z;
      targetYaw = Math.atan2(p.x - tx, p.z - tz);
      // 平滑跟随锁定方向
      let diff = targetYaw - this.camYaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.camYaw += diff * Math.min(1, dt * 4);
    }
    const cx = p.x + Math.sin(this.camYaw) * this.camDist;
    const cz = p.z + Math.cos(this.camYaw) * this.camDist;
    const cy = p.y + this.camDist * 0.42 + 1.2;
    const k = 1 - Math.exp(-BALANCE.camera.lerp * dt);
    this.camera.position.x += (cx - this.camera.position.x) * k;
    this.camera.position.y += (cy - this.camera.position.y) * k;
    this.camera.position.z += (cz - this.camera.position.z) * k;
    this._v3.set(p.x, p.y + 1.8, p.z);
    this.camera.lookAt(this._v3);
    if (this._shakeT > 0) {
      this._shakeT -= dt;
      this.camera.position.x += (Math.random() - 0.5) * 0.3;
      this.camera.position.y += (Math.random() - 0.5) * 0.3;
    }
  }

  // ---------------- HUD / 小地图 / 结算 ----------------
  _showHud(show) {
    $('hud').classList.toggle('hidden', !show);
    $('objective').classList.toggle('hidden', !show);
  }

  _announce(text) {
    const el = $('announce');
    el.textContent = text;
    el.classList.remove('hidden');
    clearTimeout(this._announceT);
    this._announceT = setTimeout(() => el.classList.add('hidden'), 3200);
  }

  _fmtTime(s) {
    const m = Math.floor(s / 60), ss = Math.floor(s % 60);
    return `${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  }

  _updateHudThrottled(dt) {
    this._hudT -= dt;
    if (this._hudT > 0) return;
    this._hudT = 0.12;
    const p = this.player;
    $('hp-bar').style.width = `${(p.hp / p.maxHp) * 100}%`;
    $('hp-text').textContent = `${Math.ceil(p.hp)} / ${p.maxHp}`;
    $('musou-bar').style.width = `${p.musou}%`;
    $('musou-text').textContent = p.musou >= 100 ? '无双已满 [I]' : `无双 ${Math.floor(p.musou)}`;
    const rl = $('ranged-line');
    if (rl) {
      const spec = this.ranged.spec;
      rl.textContent = this.ranged.ready
        ? `${spec.name}就绪 [Q]`
        : `${spec.name}冷却 ${this.ranged.cd.toFixed(1)}s`;
    }
    $('kill-count').textContent = this.kills;
    $('combo-count').textContent = this.combo > 1 ? `${this.combo} 连击` : '';
    $('combo-count').classList.toggle('hidden', this.combo <= 1);
    $('time-text').textContent = this.modeId === 'trial'
      ? `剩余 ${this._fmtTime(Math.max(0, this.trialLeft))}`
      : this._fmtTime(this.time);
    $('wave-text').textContent = `第 ${this.wave} 波`;
    $('char-name').textContent = `${this.charSpec.name} · ${this.charSpec.title}`;
    // 第五阶段：霸体 HUD 图标（脚下金圈的文字版反馈，与霸体窗口同步显隐）
    const armorEl = $('armor-indicator');
    if (armorEl) armorEl.classList.toggle('hidden', !p.combo.isArmored);
    const obj = this.modeId === 'tongguan'
      ? (this.bossSpawned ? '击败曹操！' : `斩敌 ${Math.min(this.kills, 60)} / 60，引曹操现身`)
      : this.modeId === 'trial' ? `目标：${this.kills} / ${this.chapter.killTarget} 斩` : `已坚持 ${this.wave} 波`;
    $('objective-text').textContent = obj;
    const sub = $('objective').querySelector('small');
    if (sub) sub.textContent = `${MAPS[this.mapId].label} · ${this.chapter.year}`;
    if (this.bossSpawned && !this.boss.dead) {
      $('boss-hp-bar').style.width = `${(this.boss.hp / this.boss.maxHp) * 100}%`;
      $('boss-hp-text').textContent = `${Math.ceil(this.boss.hp)} / ${this.boss.maxHp}`;
    }
    this._drawMinimap();
  }

  _drawMinimap() {
    const cv = $('minimap');
    if (!cv) return;
    const ctx = cv.getContext('2d');
    const W = cv.width, H = cv.height;
    const scale = W / (this.world.bounds * 2 + 16);
    const toXY = (x, z) => [W / 2 + x * scale, H / 2 + z * scale];
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(10,14,20,0.72)';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(216,169,40,0.8)';
    ctx.strokeRect(1, 1, W - 2, H - 2);
    // 地形障碍（通用：按本图碰撞体画，潼关是关墙，阳平关是营寨/粮仓/河岸）
    ctx.fillStyle = 'rgba(138,122,98,0.9)';
    for (const c of this.world.colliders) {
      if (c.rect) {
        const [x, y] = toXY(c.x - c.rect.hw, c.z - c.rect.hd);
        ctx.fillRect(x, y, c.rect.hw * 2 * scale, c.rect.hd * 2 * scale);
      } else if (c.r >= 2) {
        const [x, y] = toXY(c.x, c.z);
        ctx.beginPath(); ctx.arc(x, y, Math.max(2, c.r * scale), 0, Math.PI * 2); ctx.fill();
      }
    }
    // 敌军红点
    ctx.fillStyle = '#ff4a3a';
    for (const s of this.crowd.soldiers) {
      if (!s.alive || s.faction !== 'cao') continue;
      const [x, y] = toXY(s.x, s.z);
      ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
    }
    // 友军绿点
    ctx.fillStyle = '#7dff8a';
    for (const s of this.crowd.soldiers) {
      if (!s.alive || s.faction !== 'ma') continue;
      const [x, y] = toXY(s.x, s.z);
      ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
    }
    // Boss 紫点
    if (this.bossSpawned && !this.boss.dead) {
      ctx.fillStyle = '#c07dff';
      const [x, y] = toXY(this.boss.x, this.boss.z);
      ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
    }
    // 坐骑黄点（未骑乘时标出马匹位置；骑乘时马即玩家位置）
    if (this.horse && !this.mount.mounted) {
      ctx.fillStyle = '#ffd23e';
      const [hx, hy] = toXY(this.horse.group.position.x, this.horse.group.position.z);
      ctx.fillRect(hx - 2, hy - 2, 4, 4);
    }
    // 玩家白箭
    const [px, py] = toXY(this.player.x, this.player.z);
    ctx.fillStyle = '#fff';
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(Math.atan2(Math.sin(this.player.facing), Math.cos(this.player.facing)) * -1 + Math.PI);
    ctx.beginPath(); ctx.moveTo(0, -5); ctx.lineTo(3.5, 4); ctx.lineTo(-3.5, 4); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  _resetRun() {
    // 过场 / 坐骑复位
    this.cutscene = null;
    this.cutsceneAfter = null;
    this._pendingEnd = null;
    const cutEl = $('cutscene');
    if (cutEl) cutEl.classList.add('hidden');
    this.mount.dismount();
    if (this.horse) this.horse.group.position.set(this.horseHome.x, 0, this.horseHome.z);
    const p = this.player;
    // 重建玩家（换将时模型也要换）
    this.scene.remove(p.group);
    this.player = this._makePlayer();
    this.scene.add(this.player.group);
    // 清敌群
    for (const s of this.crowd.soldiers) if (s.alive) this.crowd.kill(s, true);
    this.allies = [];
    this._spawnAllies();
    // Boss 复位
    const b = this.boss;
    b.hp = BOSS.hp; b.dead = false; b.state = 'idle'; b.group.visible = false;
    b.group.traverse((o) => { if (o.isMesh) o.material.emissive?.setRGB?.(0, 0, 0); });
    $('boss-bar-wrap').classList.add('hidden');
    $('boss-warning').classList.add('hidden');
    // 掉落/碎块/箭矢复位
    for (const d of this.drops) { d.active = false; d.group.visible = false; }
    for (const d of this.debris) { d.life = 0; d.mesh.visible = false; }
    this.arrowPool.clear();
    this.shotPool.clear();
    this._clearBurnZones();
    this.ranged.setChar(this.charId);
    Object.assign(this, {
      time: 0, kills: 0, combo: 0, comboT: 0, maxCombo: 0,
      damageTaken: 0, damageDealt: 0, bossSpawned: false, bossDead: false,
      victory: false, hitstopT: 0, wave: 0, waveSpawned: 0, waveQuota: 0,
      trialLeft: this.chapter.timeLimit || 0, lockTarget: null, pendingHit: null,
    });
    this._musouNotified = false;
    this._lockHintShown = false; // 每局重新提示一次锁定
    this.camYaw = Math.PI;
    this.player.group.position.set(this.world.spawns.player.x, 0, this.world.spawns.player.z);
    this.camera.position.set(0, 8, 46);
    document.body.classList.remove('musou-mode');
  }

  _endRun(won, reason) {
    if (this.state !== 'playing') return;
    this.state = 'over';
    this._exitPointerLock(); // 结算时恢复光标，方便点按钮
    // 结算时下马（马匹留在原地）
    if (this.mount.mounted) { this.mount.dismount(); this.player.group.position.y = this.player.y; }
    this.victory = won;
    const grade = gradeFor({ kills: this.kills, damageTaken: this.damageTaken, timeSec: this.time, died: !won });
    const key = `machao_best_${this.modeId}_${this.charId}`;
    const prev = JSON.parse(localStorage.getItem(key) || '{"kills":0}');
    const isBest = this.kills > (prev.kills || 0);
    if (isBest) localStorage.setItem(key, JSON.stringify({ kills: this.kills, grade, time: Math.round(this.time), date: new Date().toISOString().slice(0, 10) }));
    $('result-title').textContent = won ? '胜 利' : '败 北';
    $('result-title').style.color = won ? '#ffd23e' : '#ff5a4a';
    $('result-reason').textContent = reason;
    $('result-grade').textContent = grade;
    $('result-kills').textContent = this.kills;
    $('result-combo').textContent = this.maxCombo;
    $('result-time').textContent = this._fmtTime(this.time);
    $('result-damage').textContent = Math.round(this.damageTaken);
    $('result-best').textContent = isBest ? '★ 新纪录！' : `最佳纪录：${prev.kills || 0} 斩（${prev.grade || '-'}）`;
    $('result-screen').classList.remove('hidden');
    if (won) this.sfx.victory(); else this.sfx.defeat();
    $('boss-warning').classList.add('hidden');
    $('lock-indicator').classList.add('hidden');
    if (this.bossSpawned) {
      $('boss-hp-bar').style.width = `${(this.boss.hp / this.boss.maxHp) * 100}%`;
      $('boss-hp-text').textContent = `${Math.ceil(this.boss.hp)} / ${this.boss.maxHp}`;
    }
    this._updateBestLabels();
  }

  _updateBestLabels() {
    // 标题界面显示各模式最佳纪录
    for (const mode of Object.keys(CHAPTERS)) {
      const el = $(`best-${mode}`);
      if (!el) continue;
      const rec = JSON.parse(localStorage.getItem(`machao_best_${mode}_${this.charId}`) || 'null');
      el.textContent = rec ? `最佳：${rec.kills} 斩 · ${rec.grade}级` : '暂无纪录';
    }
  }
}
