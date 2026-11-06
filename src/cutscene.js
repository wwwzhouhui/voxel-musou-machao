// ============================================================
// voxel-musou-machao · src/cutscene.js
// 剧情过场：纯逻辑（无 Three.js 依赖，可用 node 直接回归测试）
// 台词全部原创（按建安十六年潼关之战史实写成，不复制原项目文案）。
// 过场期间游戏模拟冻结（_step 不跑），计时也不走；任意键/点击/Esc 跳过。
// cam 取值由游戏层解析：'gate' 关墙 / 'player' 玩家 / 'boss' Boss 出场点 /
// 'wide' 全景 / 'army' 敌军方向。过场用真实时间推进（dt 来自 rAF）。
// ============================================================

/** 一句台词：who 说话人（'' 为旁白），text，dur 秒，cam 镜头 */
export const CUTSCENES = {
  // 潼关之战开场：约 11 秒
  intro: {
    id: 'intro', kind: 'intro', skippable: true,
    lines: [
      { who: '', text: '建安十六年，秋。马超联军据潼关，曹操亲率大军，旌旗遮天蔽日而来。', dur: 3.0, cam: 'gate' },
      { who: '马超', text: '父兄之仇，今日必报！曹操老贼，纳命来！', dur: 2.5, cam: 'player' },
      { who: '庞德', text: '少将军放心，末将愿为先锋，死战不退！', dur: 2.5, cam: 'player' },
      { who: '', text: '曹军如潮水般涌向关前——潼关一战，一触即发。', dur: 3.0, cam: 'army' },
    ],
  },
  // Boss 登场：斩 60 触发，约 5 秒
  boss: {
    id: 'boss', kind: 'boss', skippable: true,
    lines: [
      { who: '曹操', text: '马超小儿，你父马腾已死，今日便是你的死期！', dur: 2.5, cam: 'boss' },
      { who: '马超', text: '割须弃袍之辱，今日连本带利讨回来！', dur: 2.5, cam: 'player' },
    ],
  },
  // 胜利结尾：击败曹操后，约 7 秒
  victory: {
    id: 'victory', kind: 'victory', skippable: true,
    lines: [
      { who: '马超', text: '曹操败走！潼关守住了！', dur: 2.5, cam: 'player' },
      { who: '庞德', text: '少将军威武！西凉铁骑，天下无双！', dur: 2.5, cam: 'wide' },
      { who: '', text: '建安十六年，潼关大捷，马超之名震动天下。', dur: 2.0, cam: 'wide' },
    ],
  },
  // 败北：简短一句，约 2.5 秒
  defeat: {
    id: 'defeat', kind: 'defeat', skippable: true,
    lines: [
      { who: '', text: '马超力战而亡，潼关失守……', dur: 2.5, cam: 'player' },
    ],
  },
};

export function cutsceneTotal(script) {
  return script.lines.reduce((s, l) => s + (l.dur || 0), 0);
}

/** 过场播放器：tick(dt) 推进，done 为 true 即播完；skip() 立即播完。 */
export class CutsceneRunner {
  constructor(script) {
    this.script = script;
    this.t = 0;
    this.index = 0;
    this.done = script.lines.length === 0;
    this.skipped = false;
  }

  get total() { return cutsceneTotal(this.script); }
  get line() { return this.script.lines[Math.min(this.index, this.script.lines.length - 1)] || null; }
  get progress() { return this.script.lines.length ? (this.index + 1) / this.script.lines.length : 1; }

  tick(dt) {
    if (this.done) return;
    this.t += dt;
    let acc = 0;
    for (let i = 0; i < this.script.lines.length; i++) {
      acc += this.script.lines[i].dur || 0;
      if (this.t < acc) { this.index = i; return; }
    }
    this.index = this.script.lines.length - 1;
    this.done = true;
  }

  skip() {
    if (this.done) return;
    this.skipped = true;
    this.done = true;
    this.t = this.total;
    this.index = Math.max(0, this.script.lines.length - 1);
  }
}
