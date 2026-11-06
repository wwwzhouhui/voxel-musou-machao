// ============================================================
// voxel-musou-machao · src/adaptive.js
// 自适应画质：纯逻辑（无 Three.js 依赖，可用 node 直接回归测试）
// 档位由高到低：high → medium → low → potato，每档固定一组效果。
// 自动模式：滚动监测 FPS，<30 持续 3 秒降一档，>55 持续 8 秒升一档，
// 最多升回用户手动档（自动模式下限为 high 档）；手动模式（high/medium/low）
// 固定在对应档位，永不自动变。SwiftShader 约 4fps 是测试环境限制，
// 真机上阈值不变——低端真机也会按同样规则降档，这是预期行为。
// ============================================================

export const QUALITY_TIERS = [
  // msaa: 场景 RT 的 WebGL2 samples（4x/2x/0）；dof: 深度景深仅高档开
  { id: 'high',   label: '高', bloom: true,  post: true,  pixelRatio: 2,   shadows: true,  maxAlive: 46, msaa: 4, dof: true },
  { id: 'medium', label: '中', bloom: true,  post: true,  pixelRatio: 1.5, shadows: true,  maxAlive: 40, msaa: 2, dof: false },
  { id: 'low',    label: '低', bloom: false, post: true,  pixelRatio: 1,   shadows: false, maxAlive: 32, msaa: 0, dof: false },
  { id: 'potato', label: '极低', bloom: false, post: false, pixelRatio: 1, shadows: false, maxAlive: 24, msaa: 0, dof: false },
];

/** 手动画质模式 → 固定档位下标（与旧 ?quality=low 语义对齐：low = 极低档） */
export const MANUAL_TIER = { high: 0, medium: 1, low: 3 };

export const ADAPTIVE = {
  lowFps: 30,     // 低于此帧率视为卡顿
  lowHold: 3,     // 持续这么多秒才降档（防抖动）
  highFps: 55,    // 高于此帧率视为流畅
  highHold: 8,    // 持续这么多秒才升档（升档比降档更保守）
};

export class AdaptiveQuality {
  constructor(mode = 'auto', startTier = 0) {
    this.mode = mode; // 'auto' | 'high' | 'medium' | 'low'
    this.tier = mode === 'auto' ? startTier : (MANUAL_TIER[mode] ?? 0);
    this._lowT = 0;
    this._highT = 0;
  }

  get tierDef() { return QUALITY_TIERS[this.tier]; }
  get isAuto() { return this.mode === 'auto'; }

  /** 切换模式：手动模式立即固定到对应档位；切回自动从当前档位继续自适应 */
  setMode(mode) {
    this.mode = mode;
    this._lowT = 0;
    this._highT = 0;
    if (mode !== 'auto') this.tier = MANUAL_TIER[mode] ?? 0;
    return this.tier;
  }

  /**
   * 每帧（真实时间）调用。返回新档位下标，或 null（无变化）。
   * 手动模式永不变化；自动模式按 ADAPTIVE 阈值升降。
   */
  update(fps, dt) {
    if (this.mode !== 'auto') return null;
    if (fps < ADAPTIVE.lowFps) {
      this._lowT += dt;
      this._highT = 0;
      if (this._lowT >= ADAPTIVE.lowHold && this.tier < QUALITY_TIERS.length - 1) {
        this.tier++;
        this._lowT = 0;
        return this.tier;
      }
    } else if (fps > ADAPTIVE.highFps) {
      this._highT += dt;
      this._lowT = 0;
      if (this._highT >= ADAPTIVE.highHold && this.tier > 0) {
        this.tier--;
        this._highT = 0;
        return this.tier;
      }
    } else {
      this._lowT = 0;
      this._highT = 0;
    }
    return null;
  }
}
