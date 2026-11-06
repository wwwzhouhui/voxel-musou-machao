// ============================================================
// voxel-musou-machao · src/world.js
// 地图注册表：tongguan 潼关峡谷（南北向峡谷 + 北端关墙）
//            yangping 阳平关夜战（开阔营寨平原：中央木栅营寨 / 东侧河流木桥 /
//                     西侧粮仓 / 南侧隘口 / 北侧山岗，夜战）
// 程序化体素地形 / 城墙 / 旌旗 / 山体 / 火把；全部原创布局。
// buildWorld(scene, variantName, mapId) 返回 { group, colliders, spawns,
//   flags, torches, variant, bounds, mapId }，group 可整体移除以便换图。
// ============================================================
import * as THREE from 'three';
import { box, buildFlag } from './voxel.js';

// 确定性伪随机（固定种子，同一关卡每次一样）
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const VARIANTS = {
  day: {
    sky: 0x87b5d6, fog: 0x9db8c8, fogNear: 55, fogFar: 160,
    sun: 0xfff2d8, sunI: 1.25, hemiSky: 0xbfd9ee, hemiGround: 0x8a7a5a, hemiI: 0.75,
    ground: 0x9a8a5e, groundAlt: 0x8a7a52, ambient: 0.35, label: '白昼 · 潼关',
  },
  dusk: {
    sky: 0xd98a4a, fog: 0xc98a5a, fogNear: 45, fogFar: 140,
    sun: 0xffb36b, sunI: 1.05, hemiSky: 0xe8a06a, hemiGround: 0x6a5238, hemiI: 0.6,
    ground: 0x8a7450, groundAlt: 0x7a6444, ambient: 0.28, label: '黄昏 · 演武场',
  },
  night: {
    sky: 0x0d1526, fog: 0x141c2e, fogNear: 35, fogFar: 120,
    sun: 0x9db8e8, sunI: 0.55, hemiSky: 0x2a3a5a, hemiGround: 0x1a1410, hemiI: 0.5,
    ground: 0x5a5a48, groundAlt: 0x4a4a3e, ambient: 0.22, label: '夜战 · 试炼场',
  },
  yangpingNight: {
    sky: 0x0a1226, fog: 0x101a30, fogNear: 30, fogFar: 115,
    sun: 0xbdd0f0, sunI: 0.65, hemiSky: 0x2a3a5e, hemiGround: 0x1c241a, hemiI: 0.65,
    ground: 0x46543f, groundAlt: 0x3c4836, ambient: 0.28, label: '夜战 · 阳平关',
  },
};

function setupLights(g, v, variantName) {
  const sun = new THREE.DirectionalLight(v.sun, v.sunI);
  sun.position.set(40, 60, -25);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -70; sun.shadow.camera.right = 70;
  sun.shadow.camera.top = 70; sun.shadow.camera.bottom = -70;
  sun.shadow.camera.far = 180;
  g.add(sun);
  g.add(new THREE.HemisphereLight(v.hemiSky, v.hemiGround, v.hemiI));
  g.add(new THREE.AmbientLight(0xffffff, v.ambient));
  return sun;
}

function groundTiles(g, v, rng, size = 170, tileCount = 90) {
  const ground = new THREE.Mesh(
    new THREE.BoxGeometry(size, 1, size),
    new THREE.MeshLambertMaterial({ color: v.ground }),
  );
  ground.position.y = -0.5;
  ground.receiveShadow = true;
  g.add(ground);
  const tileGeo = new THREE.BoxGeometry(4, 0.12, 4);
  const tileMatA = new THREE.MeshLambertMaterial({ color: v.groundAlt });
  const tileMatB = new THREE.MeshLambertMaterial({ color: v.ground });
  for (let i = 0; i < tileCount; i++) {
    const t = new THREE.Mesh(tileGeo, rng() > 0.5 ? tileMatA : tileMatB);
    t.position.set((rng() - 0.5) * 110, 0.02, (rng() - 0.5) * 110);
    t.receiveShadow = true;
    g.add(t);
  }
}

function addTorches(g, positions, night, flags, torches, colliders) {
  const torchFlameMat = new THREE.MeshBasicMaterial({ color: 0xffa030 });
  for (const [x, z] of positions) {
    const grp = new THREE.Group();
    box(0.12, 1.6, 0.12, 0x3a2a1a, 0, 0.8, 0, grp);
    const flame = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.55, 0.3), torchFlameMat);
    flame.position.y = 1.85; grp.add(flame);
    const light = new THREE.PointLight(0xff8a20, night ? 14 : 4, 12, 1.8);
    light.position.y = 2; grp.add(light);
    grp.position.set(x, 0, z);
    g.add(grp);
    torches.push(flame);
    colliders.push({ x, z, r: 0.5 });
  }
}

// ---------------- 潼关峡谷（原布局，改为装进 group） ----------------
function buildTongguan(g, v, rng) {
  const colliders = [];
  const flags = [];
  const torches = [];
  setupLights(g, v, 'day');

  groundTiles(g, v, rng);
  // 中央大道（石板路）
  const roadMat = new THREE.MeshLambertMaterial({ color: 0x7a7468 });
  for (let z = -52; z <= 52; z += 4) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(7, 0.1, 3.6), roadMat);
    s.position.set(0, 0.03, z);
    s.receiveShadow = true;
    g.add(s);
  }

  // 两侧峡谷山体
  const rockCols = [0x6a6258, 0x7a6a52, 0x5a5248];
  for (const side of [-1, 1]) {
    for (let z = -80; z <= 80; z += 9) {
      const h = 14 + rng() * 16;
      const w = 8 + rng() * 7;
      const m = box(w, h, 9, rockCols[Math.floor(rng() * 3)], side * (62 + rng() * 6), h / 2 - 1, z + (rng() - 0.5) * 4);
      m.castShadow = true; m.receiveShadow = true;
      g.add(m);
      if (rng() > 0.5) {
        const cap = box(w * 0.7, 3 + rng() * 4, 7, 0x8a7a5a, side * (62 + rng() * 6), h + 1, z);
        g.add(cap);
      }
    }
  }

  // 北端潼关城墙 + 关门 + 箭塔
  const wallMat = new THREE.MeshLambertMaterial({ color: 0x8a7a62 });
  const wallMatD = new THREE.MeshLambertMaterial({ color: 0x6a5c48 });
  function wallSeg(x, y, z, w, h, d, mat2 = wallMat) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat2);
    m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
    g.add(m); return m;
  }
  wallSeg(-16, 4, -52, 22, 8, 3);
  wallSeg(16, 4, -52, 22, 8, 3);
  wallSeg(0, 9.5, -52, 12, 3, 3, wallMatD);
  wallSeg(0, 2, -52, 1.2, 4, 0.4, new THREE.MeshLambertMaterial({ color: 0x4a3226 }));
  for (let x = -26; x <= 26; x += 2.4) {
    if (Math.abs(x) < 6) continue;
    wallSeg(x, 8.6, -52, 1.2, 1.2, 3.2, wallMatD);
  }
  for (const s of [-1, 1]) {
    wallSeg(s * 30, 6, -52, 5, 12, 5, wallMatD);
    wallSeg(s * 30, 12.6, -52, 6.5, 1.2, 6.5, wallMat);
    wallSeg(s * 30, 13.8, -52, 5, 1.6, 5, wallMatD);
    colliders.push({ x: s * 30, z: -52, r: 3.4 });
  }
  colliders.push({ x: -16, z: -52, r: 11, rect: { hw: 11, hd: 2 } });
  colliders.push({ x: 16, z: -52, r: 11, rect: { hw: 11, hd: 2 } });

  // 南端木栅 / 营寨（玩家出生侧）
  for (let x = -24; x <= 24; x += 3) {
    const p = box(0.35, 2.6, 0.35, 0x5a4632, x, 1.3, 50);
    p.rotation.z = (rng() - 0.5) * 0.08;
    g.add(p);
  }
  wallSeg(0, 1.1, 50, 50, 0.5, 0.5, new THREE.MeshLambertMaterial({ color: 0x5a4632 }));

  // 旌旗
  const flagCols = [0xb02020, 0x1e4d6b, 0xd8a928];
  for (let z = -44; z <= 44; z += 11) {
    for (const s of [-1, 1]) {
      const f = buildFlag({ color: flagCols[Math.floor(rng() * 3)], poleH: 5 + rng() * 1.5 });
      f.group.position.set(s * 5.2, 0, z);
      g.add(f.group);
      flags.push({ cloth: f.cloth, phase: rng() * Math.PI * 2 });
    }
  }
  for (const x of [-24, -8, 8, 24]) {
    const f = buildFlag({ color: 0xb02020, poleH: 4 });
    f.group.position.set(x, 8, -52);
    g.add(f.group);
    flags.push({ cloth: f.cloth, phase: rng() * Math.PI * 2 });
  }

  // 散落山石（障碍）
  for (let i = 0; i < 16; i++) {
    const x = (rng() - 0.5) * 90;
    const z = (rng() - 0.5) * 95;
    if (Math.abs(x) < 8) continue;
    const r = 1 + rng() * 1.6;
    const m = box(r * 2, r * 1.4, r * 2, rockCols[i % 3], x, r * 0.6, z);
    m.rotation.y = rng() * Math.PI;
    g.add(m);
    colliders.push({ x, z, r: r * 1.3 });
  }

  // 火把
  const torchPos = [];
  for (let z = -40; z <= 40; z += 16) for (const s of [-1, 1]) torchPos.push([s * 4.4, z]);
  addTorches(g, torchPos, false, flags, torches, colliders);

  // 远处雪山剪影
  for (let i = 0; i < 7; i++) {
    const h = 26 + rng() * 20;
    const m = box(18 + rng() * 14, h, 12, 0x7a8a9a, -90 + i * 30 + (rng() - 0.5) * 10, h / 2 - 2, -95 - rng() * 15);
    m.castShadow = false;
    g.add(m);
  }

  const spawns = {
    north: { x: 0, z: -46 }, east: { x: 46, z: -10 }, west: { x: -46, z: -10 },
    south: { x: 0, z: 44 }, player: { x: 0, z: 38 },
    allies: [{ x: -3, z: 34 }, { x: 3, z: 36 }, { x: 0, z: 32 }],
    boss: { x: 0, z: -38 },
  };
  return { colliders, spawns, flags, torches };
}

// ---------------- 阳平关夜战（全新布局） ----------------
function buildYangping(g, v, rng) {
  const colliders = [];
  const flags = [];
  const torches = [];
  setupLights(g, v, 'yangpingNight');

  groundTiles(g, v, rng, 170, 70);

  const woodMat = new THREE.MeshLambertMaterial({ color: 0x5a4632 });
  const woodDark = new THREE.MeshLambertMaterial({ color: 0x3a2e20 });
  const stoneMat = new THREE.MeshLambertMaterial({ color: 0x5a5a52 });
  function seg(x, y, z, w, h, d, mat2 = woodMat) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat2);
    m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
    g.add(m); return m;
  }

  // 东侧河流（x 38..52），只留桥口 z -5..5 可过
  const waterMat = new THREE.MeshLambertMaterial({ color: 0x2a4a6b });
  for (const zc of [-28.5, 28.5]) {
    const w = new THREE.Mesh(new THREE.BoxGeometry(14, 0.12, 47), waterMat);
    w.position.set(45, 0.06, zc);
    g.add(w);
  }
  // 河面反光条
  for (let i = 0; i < 10; i++) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(12, 0.05, 0.8), new THREE.MeshLambertMaterial({ color: 0x6a9ac8 }));
    s.position.set(45, 0.12, -48 + i * 10 + rng() * 4);
    g.add(s);
  }
  colliders.push({ x: 45, z: -28.5, r: 1, rect: { hw: 7, hd: 23.5 } });
  colliders.push({ x: 45, z: 28.5, r: 1, rect: { hw: 7, hd: 23.5 } });
  // 木桥：桥面 + 栏杆（桥口 z -4..4）
  for (let x = 38; x <= 52; x += 2) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.18, 8), new THREE.MeshLambertMaterial({ color: 0x7a5a34 }));
    p.position.set(x, 0.15, 0); p.receiveShadow = true;
    g.add(p);
  }
  seg(38, 0.8, -4.2, 15, 0.3, 0.3, woodDark);
  seg(38, 0.8, 4.2, 15, 0.3, 0.3, woodDark);

  // 中央营寨：木栅方阵（半边 16 米），四面各留 8 米正门缺口
  function palisadeWall(cx, cz, horizontal) {
    // 两段：缺口两侧各一段
    for (const s of [-1, 1]) {
      if (horizontal) {
        for (let x = cx + s * 6; (s > 0 ? x <= cx + 16 : x >= cx - 16); x += s * 2) {
          const p = box(0.4, 3.0, 0.4, 0x5a4632, x, 1.5, cz);
          g.add(p);
        }
        seg(cx + s * 10, 1.0, cz, 12, 0.4, 0.4, woodDark);
        colliders.push({ x: cx + s * 10, z: cz, r: 1, rect: { hw: 6, hd: 0.7 } });
      } else {
        for (let z = cz + s * 6; (s > 0 ? z <= cz + 16 : z >= cz - 16); z += s * 2) {
          const p = box(0.4, 3.0, 0.4, 0x5a4632, cx, 1.5, z);
          g.add(p);
        }
        seg(cx, 1.0, cz + s * 10, 0.4, 0.4, 12, woodDark);
        colliders.push({ x: cx, z: cz + s * 10, r: 1, rect: { hw: 0.7, hd: 6 } });
      }
    }
  }
  palisadeWall(0, -16, true);
  palisadeWall(0, 16, true);
  palisadeWall(-16, 0, false);
  palisadeWall(16, 0, false);

  // 营内帐篷 ×4（尖顶）
  for (const [tx, tz] of [[-8, -8], [8, -8], [-8, 8], [8, 8]]) {
    seg(tx, 1.2, tz, 4.5, 2.4, 4, new THREE.MeshLambertMaterial({ color: 0x8a7a5a }));
    const roof = box(4.8, 0.3, 4.8, 0x6a4a2a, tx, 2.7, tz);
    roof.rotation.y = Math.PI / 4;
    g.add(roof);
    colliders.push({ x: tx, z: tz, r: 2.6 });
  }
  // 营中帅旗 + 篝火
  const bf = buildFlag({ color: 0xb02020, poleH: 7 });
  bf.group.position.set(0, 0, 0);
  g.add(bf.group);
  flags.push({ cloth: bf.cloth, phase: 0 });
  const fire = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.8, 1.2), new THREE.MeshBasicMaterial({ color: 0xff8a20 }));
  fire.position.set(0, 0.4, 4);
  g.add(fire);
  const fireLight = new THREE.PointLight(0xff8a20, 20, 16, 1.6);
  fireLight.position.set(0, 2, 4);
  g.add(fireLight);

  // 西侧粮仓 ×2（大屋 + 粮袋）
  for (const [gx, gz] of [[-32, -12], [-32, 6]]) {
    seg(gx, 2.5, gz, 9, 5, 7, new THREE.MeshLambertMaterial({ color: 0x7a6a4a }));
    const roof = box(10, 0.5, 8, 0x4a3226, gx, 5.2, gz);
    roof.rotation.z = 0.08;
    g.add(roof);
    colliders.push({ x: gx, z: gz, r: 1, rect: { hw: 4.8, hd: 3.8 } });
    for (let i = 0; i < 4; i++) {
      const sack = box(1.1, 0.8, 1.1, 0xc8b078, gx - 4 + (i % 2) * 2.2, 0.4, gz + 4.5 + Math.floor(i / 2) * 1.4);
      sack.rotation.y = rng() * 0.6;
      g.add(sack);
    }
  }

  // 北侧山岗 + 箭楼 ×2
  for (const [hx, hz] of [[-20, -48], [0, -50], [20, -48]]) {
    const h = 10 + rng() * 6;
    const m = box(14, h, 8, 0x4a443c, hx, h / 2 - 1, hz);
    g.add(m);
    colliders.push({ x: hx, z: hz, r: 5 });
  }
  for (const [tx, tz] of [[-30, -38], [28, -40]]) {
    seg(tx, 3, tz, 4, 6, 4, woodDark);
    seg(tx, 6.4, tz, 5.5, 0.6, 5.5, woodMat);
    seg(tx, 7.2, tz, 4.5, 1.4, 4.5, woodMat);
    colliders.push({ x: tx, z: tz, r: 2.6 });
  }

  // 南侧隘口：两侧巨石夹出 16 米通道
  for (const [rx, rz, rr] of [[-16, 46, 5], [16, 46, 5], [-26, 44, 4], [26, 44, 4]]) {
    const m = box(rr * 2, rr * 1.6, rr * 2, 0x5a5248, rx, rr * 0.7, rz);
    m.rotation.y = rng() * Math.PI;
    g.add(m);
    colliders.push({ x: rx, z: rz, r: rr * 1.25 });
  }

  // 壕沟（视觉）：营寨南门外一条暗色浅沟，玩家可跨过，无碰撞
  const ditch = new THREE.Mesh(new THREE.BoxGeometry(36, 0.06, 3), new THREE.MeshLambertMaterial({ color: 0x1e2418 }));
  ditch.position.set(0, 0.04, 21.5);
  g.add(ditch);

  // 旌旗：营门 + 粮仓 + 桥头
  const flagCols = [0xb02020, 0xd8a928, 0x1e4d6b];
  for (const [fx, fz] of [[-4, -16], [4, -16], [-4, 16], [4, 16], [-32, -18], [38, -5], [38, 5]]) {
    const f = buildFlag({ color: flagCols[Math.floor(rng() * 3)], poleH: 5 });
    f.group.position.set(fx, 0, fz);
    g.add(f.group);
    flags.push({ cloth: f.cloth, phase: rng() * Math.PI * 2 });
  }

  // 散落山石
  for (let i = 0; i < 10; i++) {
    const x = (rng() - 0.5) * 80;
    const z = (rng() - 0.5) * 80;
    if (Math.abs(x) < 20 && Math.abs(z) < 20) continue; // 别挡营寨
    if (x > 32) continue; // 别挡河
    const r = 1 + rng() * 1.4;
    const m = box(r * 2, r * 1.2, r * 2, 0x5a5248, x, r * 0.5, z);
    m.rotation.y = rng() * Math.PI;
    g.add(m);
    colliders.push({ x, z, r: r * 1.3 });
  }

  // 火把：营寨四角 + 桥头 + 粮仓 + 隘口（夜战主光源）
  const torchPos = [
    [-16, -16], [16, -16], [-16, 16], [16, 16],
    [38, -5], [38, 5], [-32, -18], [-32, 12], [0, -30], [-8, 44], [8, 44],
  ];
  addTorches(g, torchPos, true, flags, torches, colliders);

  // 远山剪影
  for (let i = 0; i < 6; i++) {
    const h = 22 + rng() * 16;
    const m = box(20 + rng() * 12, h, 10, 0x2a3648, -75 + i * 30, h / 2 - 2, -95 - rng() * 10);
    m.castShadow = false;
    g.add(m);
  }

  const spawns = {
    north: { x: 0, z: -44 },   // 北侧山岗隘口
    east: { x: 44, z: 0 },     // 木桥东岸（桥口，不在河里）
    west: { x: -44, z: -20 },  // 西侧山坡
    south: { x: 0, z: 46 },    // 南侧隘口通道
    player: { x: 0, z: 30 },   // 营寨南门外，壕沟北侧
    allies: [{ x: -3, z: 26 }, { x: 3, z: 28 }, { x: 0, z: 24 }],
    boss: { x: 0, z: -38 },    // 北侧箭楼前
  };
  return { colliders, spawns, flags, torches };
}

/**
 * buildWorld(scene, variantName, mapId)
 * 返回 { group, colliders, spawns, flags, torches, variant, bounds, mapId }
 */
export function buildWorld(scene, variantName = 'day', mapId = 'tongguan') {
  const id = mapId === 'yangping' ? 'yangping' : 'tongguan';
  const variantKey = id === 'yangping' ? 'yangpingNight' : (VARIANTS[variantName] ? variantName : 'day');
  const v = VARIANTS[variantKey];
  const rng = mulberry32(id === 'yangping' ? 215 : 211); // 阳平关之战 215 年作种子
  const g = new THREE.Group();
  g.name = `world-${id}`;
  scene.background = new THREE.Color(v.sky);
  scene.fog = new THREE.Fog(v.fog, v.fogNear, v.fogFar);
  const built = id === 'yangping' ? buildYangping(g, v, rng) : buildTongguan(g, v, rng);
  scene.add(g);
  return { group: g, ...built, variant: v, bounds: 52, mapId: id };
}

/** 圆形/矩形碰撞：把点推出障碍外 */
export function resolveCollisions(pos, radius, colliders, bound) {
  for (const c of colliders) {
    if (c.rect) {
      const dx = pos.x - c.x, dz = pos.z - c.z;
      if (Math.abs(dx) < c.rect.hw + radius && Math.abs(dz) < c.rect.hd + radius) {
        const px = c.rect.hw + radius - Math.abs(dx);
        const pz = c.rect.hd + radius - Math.abs(dz);
        if (px < pz) pos.x = c.x + Math.sign(dx || 1) * (c.rect.hw + radius);
        else pos.z = c.z + Math.sign(dz || 1) * (c.rect.hd + radius);
      }
    } else {
      const dx = pos.x - c.x, dz = pos.z - c.z;
      const d = Math.hypot(dx, dz);
      const min = c.r + radius;
      if (d < min && d > 0.0001) {
        pos.x = c.x + (dx / d) * min;
        pos.z = c.z + (dz / d) * min;
      }
    }
  }
  const b = bound - radius;
  pos.x = Math.max(-b, Math.min(b, pos.x));
  pos.z = Math.max(-b, Math.min(b, pos.z));
  return pos;
}
