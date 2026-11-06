// ============================================================
// voxel-musou-machao · src/audio.js
// 程序化 WebAudio 音效：无外部音频文件，全部合成
// ============================================================

export class Sfx {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = localStorage.getItem('machao_muted') === '1';
    this._noiseBuf = null;
  }

  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    this.master.connect(this.ctx.destination);
    // 预生成 1s 白噪声
    const len = this.ctx.sampleRate;
    this._noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this._noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  setMuted(m) {
    this.muted = m;
    localStorage.setItem('machao_muted', m ? '1' : '0');
    if (this.master) this.master.gain.value = m ? 0 : 0.5;
  }

  _noise(dur, filterFreq, type = 'bandpass', gain = 0.5, sweepTo = null) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuf;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = type; f.frequency.setValueAtTime(filterFreq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + dur + 0.02);
  }

  _tone(freq, dur, type = 'sine', gain = 0.3, slideTo = null, delay = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  swing(stage = 1) { // 挥砍：噪声扫频
    this._noise(0.12, 900 + stage * 200, 'bandpass', 0.35, 300);
  }
  hit(heavy = false) { // 命中：低频 thump + 金属
    this._tone(160, 0.12, 'sine', 0.5, 60);
    this._noise(0.08, 2400, 'highpass', heavy ? 0.3 : 0.18);
    if (heavy) this._tone(90, 0.2, 'triangle', 0.4, 40);
  }
  hurt() { this._tone(220, 0.15, 'sawtooth', 0.25, 90); }
  dodge() { this._noise(0.18, 1200, 'bandpass', 0.2, 2400); }
  jump() { this._tone(300, 0.12, 'sine', 0.15, 520); }
  kill() { // 击杀：短促爆裂
    this._noise(0.15, 800, 'lowpass', 0.4, 120);
    this._tone(520, 0.1, 'square', 0.12, 180);
  }
  drop() { this._tone(660, 0.08, 'sine', 0.2); this._tone(880, 0.12, 'sine', 0.2, null, 0.08); }
  heal() { [523, 659, 784].forEach((f, i) => this._tone(f, 0.18, 'sine', 0.2, null, i * 0.07)); }
  musouReady() { [392, 523, 659, 784].forEach((f, i) => this._tone(f, 0.15, 'triangle', 0.22, null, i * 0.06)); }
  musou() { // 无双：升调琶音 + 轰鸣
    [262, 330, 392, 523, 659, 784, 1046].forEach((f, i) => this._tone(f, 0.22, 'sawtooth', 0.16, null, i * 0.05));
    this._noise(0.6, 300, 'lowpass', 0.5, 90);
    this._tone(65, 0.7, 'sine', 0.5, 32);
  }
  bossRoar() {
    this._tone(110, 0.5, 'sawtooth', 0.35, 55);
    this._noise(0.5, 400, 'lowpass', 0.4, 100);
  }
  bossHit() { this._tone(180, 0.1, 'square', 0.2, 70); }
  victory() { [523, 659, 784, 1046, 784, 1046].forEach((f, i) => this._tone(f, 0.25, 'triangle', 0.25, null, i * 0.12)); }
  defeat() { [392, 330, 262, 196].forEach((f, i) => this._tone(f, 0.35, 'triangle', 0.22, null, i * 0.16)); }
  click() { this._tone(800, 0.05, 'sine', 0.15); }
  arrowShoot() { // 拉弓射箭：破空哨音
    this._noise(0.22, 1800, 'bandpass', 0.22, 4200);
  }
  arrowHit() { // 箭矢命中：闷响 + 弦颤
    this._tone(140, 0.1, 'triangle', 0.4, 60);
    this._noise(0.06, 1200, 'highpass', 0.2);
  }
  ranged(kind) { // 玩家远程：火矢燃爆 / 投枪破空 / 飞戟重响
    if (kind === 'fire') {
      this._noise(0.3, 900, 'lowpass', 0.4, 2400);
      this._tone(220, 0.25, 'sawtooth', 0.2, 90);
    } else if (kind === 'heavy') {
      this._noise(0.18, 700, 'bandpass', 0.35, 200);
      this._tone(120, 0.18, 'triangle', 0.4, 50);
    } else {
      this._noise(0.15, 1600, 'bandpass', 0.3, 3800);
    }
  }
  mount() { // 上马：低沉蹄声 + 一声短哨
    this._tone(140, 0.15, 'triangle', 0.3, 90);
    this._noise(0.12, 500, 'lowpass', 0.3, 150);
    this._tone(660, 0.1, 'sine', 0.15, 880, 0.12);
  }
  charge() { // 冲锋：马蹄急促 + 风声
    this._noise(0.5, 700, 'bandpass', 0.3, 1800);
    this._tone(98, 0.4, 'sawtooth', 0.2, 160);
  }
  waveHorn() { // 波次号角
    this._tone(196, 0.4, 'sawtooth', 0.2);
    this._tone(294, 0.4, 'sawtooth', 0.2, null, 0.1);
  }
}
