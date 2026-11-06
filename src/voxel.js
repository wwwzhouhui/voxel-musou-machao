// ============================================================
// voxel-musou-machao · src/voxel.js
// 体素角色拼装：全部用 BoxGeometry 程序化生成，无外部模型
// （原创拼装，与原项目模型无关）
// ============================================================
import * as THREE from 'three';

const _matCache = new Map();
export function mat(color) {
  if (!_matCache.has(color)) {
    _matCache.set(color, new THREE.MeshLambertMaterial({ color }));
  }
  return _matCache.get(color);
}

export function box(w, h, d, color, x = 0, y = 0, z = 0, parent = null) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
  m.position.set(x, y, z);
  m.castShadow = true;
  if (parent) parent.add(m);
  return m;
}

/** 武器：按类型拼装，返回装在 pivot（右手）里的 group */
export function buildWeapon(type, c) {
  const g = new THREE.Group();
  if (type === 'spear') {
    // 银枪：长杆 + 枪缨 + 枪头
    box(0.09, 0.09, 2.6, c.weapon, 0, 0, 0.3, g);
    box(0.16, 0.16, 0.35, c.plume, 0, 0, 1.35, g);          // 红缨
    box(0.05, 0.22, 0.55, c.weaponGlow, 0, 0, 1.75, g);      // 枪头
    box(0.12, 0.12, 0.18, c.trim, 0, 0, -0.95, g);           // 枪尾配重
  } else if (type === 'fan') {
    // 羽扇：扇柄 + 扇面（白羽）
    box(0.08, 0.08, 0.9, 0x6b4a2a, 0, 0, 0.2, g);
    for (let i = -2; i <= 2; i++) {
      const f = box(0.14, 0.02, 0.75, i % 2 ? c.weapon : 0xe8e2d0, i * 0.16, 0, 0.85, g);
      f.rotation.y = i * 0.22;
    }
    box(0.2, 0.06, 0.2, c.weaponGlow, 0, 0, 0.62, g);        // 扇钉（火光）
  } else if (type === 'axes') {
    // 双铁戟：主戟 + 副戟（左右各一，pivot 里拼两把）
    for (const s of [-1, 1]) {
      const sub = new THREE.Group();
      sub.position.x = s * 0.22;
      box(0.1, 0.1, 1.5, 0x4a3226, 0, 0, 0.1, sub);
      box(0.3, 0.06, 0.5, c.weapon, 0, 0, 0.85, sub);       // 戟刃
      box(0.06, 0.3, 0.2, c.weapon, 0, 0, 0.85, sub);        // 月牙小枝
      box(0.1, 0.1, 0.16, c.trim, 0, 0, -0.7, sub);
      g.add(sub);
    }
  } else if (type === 'sword') {
    // 曹操：倚天剑
    box(0.09, 0.09, 1.5, c.weapon, 0, 0, 0.35, g);
    box(0.05, 0.3, 0.5, c.weaponGlow, 0, 0, 1.2, g);
    box(0.22, 0.06, 0.1, c.trim, 0, 0, -0.35, g);
  }
  return g;
}

/**
 * 拼装一名武将（玩家 / Boss 共用）。
 * 返回 { group, armR, armL, legL, legR, head, weapon, height }
 * 尺寸单位：米；总高约 1.9 * scale。
 */
export function buildHero(spec, scale = 1) {
  const c = spec.colors;
  const g = new THREE.Group();
  const parts = { group: g };

  // 腿
  parts.legL = new THREE.Group(); parts.legL.position.set(-0.16, 0.85, 0);
  box(0.22, 0.85, 0.26, c.boots, 0, -0.42, 0, parts.legL);
  parts.legR = new THREE.Group(); parts.legR.position.set(0.16, 0.85, 0);
  box(0.22, 0.85, 0.26, c.boots, 0, -0.42, 0, parts.legR);
  g.add(parts.legL, parts.legR);

  // 躯干：铠甲 + 腰布 + 披风
  box(0.62, 0.62, 0.38, c.armor, 0, 1.16, 0, g);                 // 胸甲
  box(0.66, 0.16, 0.42, c.armorDark, 0, 1.5, 0, g);              // 肩甲横条
  box(0.5, 0.3, 0.32, c.cloth, 0, 0.78, 0, g);                   // 腰布
  box(0.58, 0.1, 0.06, c.trim, 0, 0.92, 0, g);                   // 金腰带
  const cape = box(0.56, 0.95, 0.05, c.clothDark, 0, 1.05, -0.24, g); // 披风
  cape.name = 'cape';

  // 肩甲
  box(0.24, 0.18, 0.4, c.armorDark, -0.42, 1.48, 0, g);
  box(0.24, 0.18, 0.4, c.armorDark, 0.42, 1.48, 0, g);

  // 手臂（pivot 在肩部，便于挥舞）
  parts.armL = new THREE.Group(); parts.armL.position.set(-0.42, 1.44, 0);
  box(0.18, 0.62, 0.2, c.armor, 0, -0.28, 0, parts.armL);
  box(0.16, 0.14, 0.18, c.skin, 0, -0.62, 0, parts.armL);
  parts.armR = new THREE.Group(); parts.armR.position.set(0.42, 1.44, 0);
  box(0.18, 0.62, 0.2, c.armor, 0, -0.28, 0, parts.armR);
  box(0.16, 0.14, 0.18, c.skin, 0, -0.62, 0, parts.armR);
  g.add(parts.armL, parts.armR);

  // 头 + 头盔 + 盔缨
  parts.head = new THREE.Group(); parts.head.position.set(0, 1.72, 0);
  box(0.34, 0.3, 0.32, c.skin, 0, 0, 0, parts.head);             // 脸
  box(0.36, 0.14, 0.34, c.helmet, 0, 0.2, 0, parts.head);        // 盔顶
  box(0.38, 0.1, 0.1, c.helmet, 0, 0.14, 0.17, parts.head);      // 盔檐
  if (c.plume) {
    box(0.08, 0.3, 0.08, c.plume, 0, 0.4, -0.05, parts.head);    // 盔缨
  }
  // 眼睛（两点黑）
  box(0.05, 0.05, 0.02, 0x111111, -0.08, 0.02, 0.17, parts.head);
  box(0.05, 0.05, 0.02, 0x111111, 0.08, 0.02, 0.17, parts.head);
  g.add(parts.head);

  // 武器装在右手 pivot
  parts.weaponPivot = new THREE.Group();
  parts.weaponPivot.position.set(0, -0.66, 0.05);
  parts.weapon = buildWeapon(spec.weaponType || 'spear', c);
  // 枪类横握：沿 Z 轴向前；扇/戟竖握微调
  if (spec.weaponType === 'fan') parts.weapon.rotation.x = -Math.PI / 2.4;
  if (spec.weaponType === 'axes') parts.weapon.rotation.x = -Math.PI / 2.6;
  parts.weaponPivot.add(parts.weapon);
  parts.armR.add(parts.weaponPivot);

  // 左手：周瑜持扇在左手？不，统一右手；左手空拳即可。典韦双戟已在右手 pivot 拼双把。
  g.scale.setScalar(scale);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  parts.height = 1.95 * scale;
  return parts;
}

/** 马匹毛色：按武将区分（马超白马、孙策枣红、周瑜乌马、典韦黑骝） */
export const HORSE_COLORS = {
  machao: { coat: 0xe8e8e8, mane: 0xf5f5f5, saddle: 0xb02020 },
  sunce: { coat: 0x6b4a2a, mane: 0x2a1a0e, saddle: 0x2e6b34 },
  zhouyu: { coat: 0x2a2a2e, mane: 0x111111, saddle: 0x1e4d6b },
  dianwei: { coat: 0x4a3226, mane: 0x1a120c, saddle: 0x6b1e1e },
};

/**
 * 体素马：BoxGeometry 程序化拼装。返回 { group, legFL, legFR, legBL, legBR, head }
 * 马身朝 +Z，骑手坐在 y≈1.35 的马鞍上；四腿 pivot 在肩/胯部，可摆动做奔跑动画。
 */
export function buildHorse(charId = 'machao') {
  const c = HORSE_COLORS[charId] || HORSE_COLORS.machao;
  const g = new THREE.Group();
  const parts = { group: g };
  // 马身 + 肚带
  box(0.72, 0.66, 1.7, c.coat, 0, 1.08, 0, g);
  box(0.76, 0.12, 0.5, c.saddle, 0, 1.28, -0.1, g); // 马鞍
  box(0.78, 0.1, 0.1, 0xd8a928, 0, 1.28, 0.35, g);  // 鞍前金饰
  // 脖颈 + 马头（向前上方伸出）
  const neck = box(0.34, 0.8, 0.42, c.coat, 0, 1.55, 0.85, g);
  neck.rotation.x = 0.5;
  parts.head = new THREE.Group();
  parts.head.position.set(0, 1.95, 1.15);
  box(0.3, 0.32, 0.62, c.coat, 0, 0, 0.1, parts.head);          // 头
  box(0.1, 0.22, 0.08, c.coat, -0.1, 0.24, -0.05, parts.head);  // 左耳
  box(0.1, 0.22, 0.08, c.coat, 0.1, 0.24, -0.05, parts.head);   // 右耳
  box(0.32, 0.1, 0.3, c.mane, 0, 0.18, -0.15, parts.head);       // 额前鬃毛
  g.add(parts.head);
  // 鬃毛（脖颈后一排）
  box(0.14, 0.7, 0.3, c.mane, 0, 1.6, 0.62, g);
  // 马尾
  const tail = box(0.16, 0.7, 0.14, c.mane, 0, 0.95, -0.95, g);
  tail.rotation.x = 0.25;
  // 四腿（pivot 在顶部，便于奔跑摆动）
  const mkLeg = (x, z) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, 0.85, z);
    box(0.2, 0.85, 0.22, c.coat, 0, -0.42, 0, pivot);
    box(0.22, 0.14, 0.24, 0x2a2018, 0, -0.82, 0, pivot); // 蹄
    g.add(pivot);
    return pivot;
  };
  parts.legFL = mkLeg(-0.24, 0.62);
  parts.legFR = mkLeg(0.24, 0.62);
  parts.legBL = mkLeg(-0.24, -0.62);
  parts.legBR = mkLeg(0.24, -0.62);
  // 缰绳（鞍前两条细杆，示意）
  box(0.03, 0.03, 0.9, 0x4a3226, -0.12, 1.55, 0.85, g);
  box(0.03, 0.03, 0.9, 0x4a3226, 0.12, 1.55, 0.85, g);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return parts;
}

/** 体素碎块（死亡爆裂用）：返回一组小方块 mesh，供粒子系统复用 */
export function makeDebris(color, n = 10, size = 0.14) {
  const geo = new THREE.BoxGeometry(size, size, size);
  const m = new THREE.Mesh(geo, mat(color));
  m.castShadow = false;
  return m;
}

/** 旗帜：旗杆 + 旗面，返回 { group, cloth }（cloth 可摆动） */
export function buildFlag({ poleH = 5, w = 1.6, h = 1.0, color = 0xb02020, emblem = 0xd8a928 }) {
  const g = new THREE.Group();
  box(0.09, poleH, 0.09, 0x4a3226, 0, poleH / 2, 0, g);
  box(0.14, 0.14, 0.14, emblem, 0, poleH + 0.05, 0, g);
  const cloth = new THREE.Group();
  cloth.position.set(0, poleH - h / 2 - 0.15, 0);
  const c = box(w, h, 0.04, color, w / 2, 0, 0, cloth);
  c.castShadow = false;
  box(w * 0.55, h * 0.5, 0.05, emblem, w / 2, 0, 0.01, cloth).castShadow = false;
  g.add(cloth);
  return { group: g, cloth };
}
