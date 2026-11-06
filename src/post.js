// ============================================================
// voxel-musou-machao · src/post.js
// 轻量后期管线（原创实现，未复制原项目 post.js 的重型 shader 链）：
//   场景 → 场景 RT → 亮部提取（阈值）→ 两轮可分离高斯模糊 → 合成输出
//   合成：原色 + 泛光 + 暗角 + 轻微饱和提升；输出时做 sRGB 编码
//   （场景 RT 是线性的，ShaderMaterial 不会自动做颜色空间转换，
//    所以 composite 里用精确 sRGB 曲线编码——实测开/关后期亮度基本一致）
// 像素风：场景 RT 降到 1/3 分辨率、NearestFilter 放大，体素块感更强。
// HUD 是 DOM，不进后期，不受影响。任何一步建 RT 失败都回退直出。
// ============================================================
import * as THREE from 'three';

const QUAD_VS = /* glsl */`
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const BRIGHT_FS = /* glsl */`
  uniform sampler2D tColor;
  uniform float uThreshold;
  varying vec2 vUv;
  void main() {
    vec3 c = texture2D(tColor, vUv).rgb;
    float l = dot(c, vec3(0.299, 0.587, 0.114));
    float w = smoothstep(uThreshold, uThreshold + 0.25, l);
    gl_FragColor = vec4(c * w, 1.0);
  }
`;

const BLUR_FS = /* glsl */`
  uniform sampler2D tColor;
  uniform vec2 uDir;
  varying vec2 vUv;
  void main() {
    vec3 c = texture2D(tColor, vUv).rgb * 0.227027;
    vec2 o1 = uDir * 1.3846153846;
    vec2 o2 = uDir * 3.2307692308;
    c += texture2D(tColor, vUv + o1).rgb * 0.3162162162;
    c += texture2D(tColor, vUv - o1).rgb * 0.3162162162;
    c += texture2D(tColor, vUv + o2).rgb * 0.0702702703;
    c += texture2D(tColor, vUv - o2).rgb * 0.0702702703;
    gl_FragColor = vec4(c, 1.0);
  }
`;

const COMPOSITE_FS = /* glsl */`
  uniform sampler2D tColor;
  uniform sampler2D tBloom;
  uniform sampler2D tDepth;
  uniform float uBloomStrength;
  uniform float uVignette;
  uniform float uDof;
  uniform float uFocus;
  uniform float uNear;
  uniform float uFar;
  uniform vec2 uTexel;
  varying vec2 vUv;
  vec3 srgbEncode(vec3 c) {
    return mix(c * 12.92, 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
  }
  void main() {
    vec3 c = texture2D(tColor, vUv).rgb;
    // 深度景深：按线性深度与焦点的距离做 8 抽头模糊（真深度 DoF，非径向假模糊）
    if (uDof > 0.001) {
      float d = texture2D(tDepth, vUv).r;
      float z = d * 2.0 - 1.0;
      float lin = (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear));
      float blur = clamp((abs(lin - uFocus) - 2.0) / 18.0, 0.0, 1.0) * uDof;
      if (blur > 0.01) {
        vec2 r = uTexel * blur * 6.0;
        vec3 bb = texture2D(tColor, vUv).rgb;
        bb += texture2D(tColor, vUv + vec2(r.x, 0.0)).rgb;
        bb += texture2D(tColor, vUv - vec2(r.x, 0.0)).rgb;
        bb += texture2D(tColor, vUv + vec2(0.0, r.y)).rgb;
        bb += texture2D(tColor, vUv - vec2(0.0, r.y)).rgb;
        bb += texture2D(tColor, vUv + vec2(r.x, r.y)).rgb;
        bb += texture2D(tColor, vUv + vec2(-r.x, r.y)).rgb;
        bb += texture2D(tColor, vUv + vec2(r.x, -r.y)).rgb;
        bb += texture2D(tColor, vUv + vec2(-r.x, -r.y)).rgb;
        c = mix(c, bb / 9.0, blur);
      }
    }
    vec3 b = texture2D(tBloom, vUv).rgb;
    c += b * uBloomStrength;
    // 轻微饱和提升
    float l = dot(c, vec3(0.299, 0.587, 0.114));
    c = mix(vec3(l), c, 1.08);
    // 暗角
    float d = distance(vUv, vec2(0.5));
    c *= 1.0 - uVignette * smoothstep(0.45, 0.85, d);
    gl_FragColor = vec4(srgbEncode(max(c, vec3(0.0))), 1.0);
  }
`;

function makeRT(w, h, nearest = false, samples = 0, depthTexture = null) {
  // samples: WebGL2 RT 原生 MSAA（4x/2x/0）；depthTexture: 景深用的深度贴图
  // 注意：three r186 的 depthTexture setter 对 undefined 会读 current.renderTarget
  // 而抛错，所以无深度贴图时不要传这个键（不要传 undefined）。
  const opts = {
    minFilter: nearest ? THREE.NearestFilter : THREE.LinearFilter,
    magFilter: nearest ? THREE.NearestFilter : THREE.LinearFilter,
    format: THREE.RGBAFormat,
    depthBuffer: true,
    stencilBuffer: false,
    samples: samples || 0,
  };
  if (depthTexture) opts.depthTexture = depthTexture;
  const rt = new THREE.WebGLRenderTarget(Math.max(2, Math.floor(w)), Math.max(2, Math.floor(h)), opts);
  return rt;
}

export class PostFX {
  constructor(renderer, opts = {}) {
    this.renderer = renderer;
    this.ok = false;
    this.enabled = opts.enabled !== false;
    this.bloom = opts.bloom !== false;
    this.pixel = !!opts.pixel;
    this.bloomStrength = 0.55;
    this.bloomThreshold = 0.55;
    this.pixelScale = 3; // 像素风降采样倍数
    this.vignette = 0.28;
    // MSAA / DoF：msaa 为场景 RT 的 WebGL2 samples；dof 为深度景深开关
    // msaaEffective / dofEffective 为 _alloc 降级后的实际生效值
    this.msaa = opts.msaa ?? 0;
    this.dof = !!opts.dof;
    this.msaaEffective = 0;
    this.dofEffective = false;
    this.dofStrength = 0.85;
    this.focusDepth = 12; // 焦点深度（米），游戏层每帧按锁定目标/玩家距离更新
    this._depthTex = null;
    try {
      this._quadScene = new THREE.Scene();
      this._quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      this._quadGeo = new THREE.PlaneGeometry(2, 2);
      this._brightMat = new THREE.ShaderMaterial({
        vertexShader: QUAD_VS, fragmentShader: BRIGHT_FS,
        uniforms: { tColor: { value: null }, uThreshold: { value: this.bloomThreshold } },
        depthTest: false, depthWrite: false,
      });
      this._blurMat = new THREE.ShaderMaterial({
        vertexShader: QUAD_VS, fragmentShader: BLUR_FS,
        uniforms: { tColor: { value: null }, uDir: { value: new THREE.Vector2(1, 0) } },
        depthTest: false, depthWrite: false,
      });
      this._compMat = new THREE.ShaderMaterial({
        vertexShader: QUAD_VS, fragmentShader: COMPOSITE_FS,
        uniforms: {
          tColor: { value: null }, tBloom: { value: null }, tDepth: { value: null },
          uBloomStrength: { value: this.bloomStrength }, uVignette: { value: this.vignette },
          uDof: { value: 0 }, uFocus: { value: this.focusDepth },
          uNear: { value: 0.1 }, uFar: { value: 400 }, uTexel: { value: new THREE.Vector2(1 / 1280, 1 / 800) },
        },
        depthTest: false, depthWrite: false,
      });
      this._quad = new THREE.Mesh(this._quadGeo, this._compMat);
      this._quad.frustumCulled = false;
      this._quadScene.add(this._quad);
      this._w = 1280; this._h = 800;
      this._alloc();
      this.ok = true;
    } catch (e) {
      console.warn('[post] init failed, fallback to direct render:', e);
      this.ok = false;
      this.enabled = false;
    }
  }

  _alloc() {
    this._disposeRTs();
    const div = this.pixel ? this.pixelScale : 1;
    const sw = this._w / div, sh = this._h / div;
    // 场景 RT 三级降级：MSAA+深度贴图 → 仅 MSAA → 普通 RT。
    // 某些驱动/软件渲染不支持 samples+depthTexture 组合，逐级降级保证
    // 后期管线不整体失效；实际生效值记在 msaaEffective / dofEffective，
    // 与请求值（msaa / dof）分开，HUD/测试以生效值为准，不谎报。
    this.msaaEffective = 0;
    this.dofEffective = false;
    const attempts = [
      { msaa: this.msaa, depth: this.dof },
      { msaa: this.msaa, depth: false },
      { msaa: 0, depth: false },
    ];
    let lastErr = null;
    for (const a of attempts) {
      try {
        this._depthTex = a.depth ? new THREE.DepthTexture(Math.max(2, Math.floor(sw)), Math.max(2, Math.floor(sh)), THREE.UnsignedIntType) : null;
        this.rtScene = makeRT(sw, sh, this.pixel, a.msaa, this._depthTex);
        this.msaaEffective = a.msaa;
        this.dofEffective = a.depth;
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e;
        if (this._depthTex) { try { this._depthTex.dispose(); } catch (_) { /* ignore */ } this._depthTex = null; }
        if (this.rtScene) { try { this.rtScene.dispose(); } catch (_) { /* ignore */ } this.rtScene = null; }
      }
    }
    if (!this.rtScene) throw lastErr || new Error('rtScene alloc failed');
    if (this.msaaEffective !== this.msaa || this.dofEffective !== this.dof) {
      console.warn(`[post] scene RT fallback: requested msaa=${this.msaa} dof=${this.dof}, effective msaa=${this.msaaEffective} dof=${this.dofEffective}`);
    }
    const bw = Math.max(2, sw / 4), bh = Math.max(2, sh / 4);
    this.rtBright = makeRT(bw, bh);
    this.rtBlurA = makeRT(bw, bh);
    this.rtBlurB = makeRT(bw, bh);
    this._texel = { x: 1 / bw, y: 1 / bh };
    this._texelScene = { x: 1 / Math.max(2, sw), y: 1 / Math.max(2, sh) };
  }

  _disposeRTs() {
    for (const k of ['rtScene', 'rtBright', 'rtBlurA', 'rtBlurB']) {
      if (this[k]) { this[k].dispose(); this[k] = null; }
    }
    if (this._depthTex) { this._depthTex.dispose(); this._depthTex = null; }
  }

  resize(w, h) {
    this._w = Math.max(2, w); this._h = Math.max(2, h);
    if (this.ok) this._alloc();
  }

  setBloom(on) { this.bloom = !!on; if (on) this.enabled = true; }
  setPixel(on) {
    const changed = !!on !== this.pixel;
    this.pixel = !!on;
    if (on) this.enabled = true;
    if (changed && this.ok) this._alloc();
  }
  setEnabled(on) { this.enabled = !!on; }

  /** MSAA：改 samples 需重建场景 RT；0/2/4 以外的值钳制到最近档 */
  setMsaa(n) {
    const v = n >= 4 ? 4 : n >= 2 ? 2 : 0;
    if (v === this.msaa) return;
    this.msaa = v;
    if (this.ok) this._alloc();
  }

  /** DoF：开关需重建场景 RT（挂/卸深度贴图） */
  setDof(on) {
    const v = !!on;
    if (v === this.dof) return;
    this.dof = v;
    if (this.ok) this._alloc();
  }

  setFocusDepth(d) { this.focusDepth = Math.max(2, Math.min(60, d || 12)); }

  get active() { return this.ok && this.enabled; }

  _pass(mat, fromRT, toRT) {
    mat.uniforms.tColor.value = fromRT.texture;
    this._quad.material = mat;
    this.renderer.setRenderTarget(toRT);
    this.renderer.render(this._quadScene, this._quadCam);
  }

  render(scene, camera) {
    if (!this.active) {
      this.renderer.setRenderTarget(null);
      this.renderer.render(scene, camera);
      return;
    }
    const r = this.renderer;
    // 1) 场景进 RT
    r.setRenderTarget(this.rtScene);
    r.render(scene, camera);
    // 2) 泛光（可关）：亮部提取 → 两轮 H/V 模糊
    if (this.bloom) {
      this._brightMat.uniforms.uThreshold.value = this.bloomThreshold;
      this._pass(this._brightMat, this.rtScene, this.rtBright);
      this._blurMat.uniforms.uDir.value.set(this._texel.x, 0);
      this._pass(this._blurMat, this.rtBright, this.rtBlurA);
      this._blurMat.uniforms.uDir.value.set(0, this._texel.y);
      this._pass(this._blurMat, this.rtBlurA, this.rtBlurB);
      this._blurMat.uniforms.uDir.value.set(this._texel.x, 0);
      this._pass(this._blurMat, this.rtBlurB, this.rtBlurA);
      this._blurMat.uniforms.uDir.value.set(0, this._texel.y);
      this._pass(this._blurMat, this.rtBlurA, this.rtBlurB);
    }
    // 3) 合成到屏幕
    this._compMat.uniforms.tColor.value = this.rtScene.texture;
    this._compMat.uniforms.tBloom.value = this.bloom ? this.rtBlurB.texture : this.rtScene.texture;
    this._compMat.uniforms.tDepth.value = this._depthTex ? this._depthTex : this.rtScene.texture;
    this._compMat.uniforms.uBloomStrength.value = this.bloom ? this.bloomStrength : 0;
    this._compMat.uniforms.uVignette.value = this.vignette;
    this._compMat.uniforms.uDof.value = this.dofEffective ? this.dofStrength : 0;
    this._compMat.uniforms.uFocus.value = this.focusDepth;
    this._compMat.uniforms.uNear.value = camera.near;
    this._compMat.uniforms.uFar.value = camera.far;
    this._compMat.uniforms.uTexel.value.set(this._texelScene.x, this._texelScene.y);
    this._quad.material = this._compMat;
    r.setRenderTarget(null);
    r.render(this._quadScene, this._quadCam);
  }

  dispose() {
    this._disposeRTs();
    this._quadGeo?.dispose();
  }
}
