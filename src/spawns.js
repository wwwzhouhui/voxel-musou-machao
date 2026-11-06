// ============================================================
// voxel-musou-machao · src/spawns.js
// 敌潮出生点：纯逻辑（无 Three.js 依赖，可用 node 直接回归测试）
// 两张地图各 8 个出生点，分布在场地四周与纵深，避开玩家出生点与 Boss 登场区。
// 出生分配：按出生点轮询 + 单点抖动 + 同批次最小间距，避免扎堆一坨。
// ============================================================

// 每张图的 8 个出生点（与 src/world.js 的地形/出生点一致，数据放这里以便 node 自检；
// world.js 的 spawns.spawnPoints 直接引用本表）。坐标单位：米；战场半宽 52。
export const SPAWN_POINTS = {
  // 潼关：玩家 (0, 38)，Boss (0, -38)。8 点：北段两翼 / 东西两侧 / 中段 / 南侧，
  // 距玩家最近 38 米（西南角），距 Boss 最近 18 米（中段），均不在两人头顶。
  tongguan: [
    { x: -30, z: -40 }, { x: 30, z: -40 },
    { x: -46, z: -10 }, { x: 46, z: -10 },
    { x: -44, z: 20 }, { x: 44, z: 20 },
    { x: 0, z: -20 }, { x: -38, z: 34 },
  ],
  // 阳平关：玩家 (0, 30)，Boss (0, -38)。8 点：北侧箭楼两翼 / 木桥东岸 / 西侧山坡 /
  // 东南、西南野地 / 南侧隘口 / 营北门外；距玩家最近 16 米（南侧隘口），距 Boss 最近 18 米。
  yangping: [
    { x: -30, z: -40 }, { x: 30, z: -40 },
    { x: 44, z: 0 }, { x: -44, z: -20 },
    { x: 36, z: 28 }, { x: -36, z: 28 },
    { x: 0, z: 46 }, { x: 0, z: -20 },
  ],
};

export const SPAWN_MIN_GAP = 3;   // 同批次内任意两名敌人的最小出生间距（米）
export const SPAWN_JITTER = 3.5;  // 单点抖动半径（米）：出生点周围随机散开

/**
 * 按出生点轮询分配一批敌人的出生位置。
 * @param {Array<{x,z}>} points 出生点表（至少 1 个）
 * @param {number} count 本批人数
 * @param {number} startIdx 上一批结束时的轮询下标（跨批次连续轮询）
 * @param {function} rand 随机函数（默认 Math.random；测试可传确定性函数）
 * @returns {{ positions: Array<{x, z, point}>, nextIdx: number }}
 * 保证：同一批次内任意两人间距 ≥ SPAWN_MIN_GAP（至多重抖 5 次仍撞则取最远一次）；
 * count ≥ 点数时每个点至少用一次（轮询）。
 */
export function pickSpawnPositions(points, count, startIdx = 0, rand = Math.random) {
  const pts = points && points.length ? points : [{ x: 0, z: -40 }];
  const positions = [];
  let idx = ((startIdx % pts.length) + pts.length) % pts.length;
  for (let n = 0; n < count; n++) {
    const pt = pts[idx];
    idx = (idx + 1) % pts.length;
    let best = null, bestGap = -1;
    for (let attempt = 0; attempt < 5; attempt++) {
      const a = rand() * Math.PI * 2;
      const r = 0.5 + rand() * (SPAWN_JITTER - 0.5);
      const cand = { x: pt.x + Math.cos(a) * r, z: pt.z + Math.sin(a) * r, point: pts.indexOf(pt) };
      let gap = Infinity;
      for (const p of positions) gap = Math.min(gap, Math.hypot(p.x - cand.x, p.z - cand.z));
      if (gap >= SPAWN_MIN_GAP) { best = cand; bestGap = gap; break; }
      if (gap > bestGap) { best = cand; bestGap = gap; }
    }
    positions.push(best);
  }
  return { positions, nextIdx: idx };
}
