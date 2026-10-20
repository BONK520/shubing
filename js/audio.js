// 毛絨消消樂 — 音效與背景音樂，全部用 Web Audio 即時合成（不用音檔）
// API（docs/SPEC.md §5）：
//   audio.unlock()            第一次 pointerdown / keydown 時呼叫；建立或喚醒 AudioContext（含 iOS 解鎖）
//   audio.play(name, opts)    靜音或尚未解鎖時直接忽略；永遠不丟例外
//                             opts.delay（毫秒）：排在多久之後響（照 AudioContext 的時鐘，和畫面的動畫時間對齊）
//   audio.setMuted(b) / audio.muted     只管音效（sfx）；音樂另外用 setMusic 控制
//   audio.setMusic(b) / audio.music     輕柔循環背景音樂；分頁隱藏時自動暫停
// 音效名稱：tap select swap invalid match(opts.cascade 1..n) stripe wrap bomb special land shuffle
//           win lose star(opts.n 1..3) sugar combo
//           pop(opts.cascade, opts.group：連鎖越多、同一步的組數越多，音越高) board(炸彈+炸彈) chime(opts.level：長連鎖)
// 全部經過壓縮器 + 限幅器，不會爆音。

const PENTA = [0, 2, 4, 7, 9];                       // C 大調五聲音階
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
const penta = (base, step) => base + 12 * Math.floor(step / 5) + PENTA[((step % 5) + 5) % 5];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rnd = (a, b) => a + Math.random() * (b - a);

const MASTER_VOL = 0.9;
const SFX_VOL = 1.0;
const MUSIC_VOL = 0.3;
const MAX_VOICES = 150;              // 以振盪器數量計（一個鈴聲 = 4 個）

let ctx = null;
let master = null, sfxBus = null, musicBus = null, revIn = null, noiseBuf = null;
let unlocked = false, muted = false, musicOn = false;
let voices = 0;
let gestureHooked = false;
const lastPlayed = Object.create(null);   // name -> 最近排定的幾個時間點（AudioContext 秒）

// 同一個音效最短間隔（秒，用「排定要響的時間」比），避免同時疊太多變得很吵
const GAP = { land: 0.016, tap: 0.04, match: 0.03, pop: 0.022, special: 0.05, star: 0.05, stripe: 0.035, wrap: 0.05,
  bomb: 0.12, chime: 0.3, swap: 0.05, invalid: 0.1, combo: 0.15, board: 0.3 };

// ---------- 建立音訊圖 ----------
function makeContext() {
  const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  if (!AC) return null;
  let c = null;
  try { c = new AC({ latencyHint: 'interactive' }); } catch (e) {
    try { c = new AC(); } catch (e2) { return null; }
  }
  try {
    // 限幅器：最後一關，任何疊加都不會超過 0 dBFS
    const lim = c.createDynamicsCompressor();
    lim.threshold.value = -2;
    lim.knee.value = 0;
    lim.ratio.value = 20;
    lim.attack.value = 0.001;
    lim.release.value = 0.12;
    lim.connect(c.destination);
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 14;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.25;
    comp.connect(lim);

    master = c.createGain();
    master.gain.value = MASTER_VOL;
    master.connect(comp);

    // 小小的殘響，讓木琴 / 鈴聲更柔。殘響的脈衝要算一陣子：第一次點擊時先不算（不然手機上那一下會卡），稍後再補
    const rev = c.createConvolver();
    revIn = c.createGain();
    revIn.gain.value = 0.22;
    revIn.connect(rev);
    rev.connect(master);
    const addRev = () => { try { rev.buffer = makeImpulse(c, 1.1, 2.6); } catch (e) { /* 沒有殘響也能玩 */ } };
    if (typeof requestIdleCallback === 'function') requestIdleCallback(addRev, { timeout: 4000 });
    else setTimeout(addRev, 1500);

    sfxBus = c.createGain();
    sfxBus.gain.value = muted ? 0 : SFX_VOL;
    sfxBus.connect(master);
    sfxBus.connect(revIn);

    musicBus = c.createGain();
    musicBus.gain.value = 0;
    musicBus.connect(master);
    const musicRev = c.createGain();
    musicRev.gain.value = 0.9;
    musicBus.connect(musicRev);
    musicRev.connect(revIn);

    noiseBuf = c.createBuffer(1, Math.floor(c.sampleRate * 0.8), c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  } catch (e) {
    try { c.close(); } catch (e2) { /* ignore */ }
    return null;
  }
  return c;
}

function makeImpulse(c, seconds, decay) {
  const len = Math.floor(c.sampleRate * seconds);
  const buf = c.createBuffer(2, len, c.sampleRate);
  // (1 - i/len)^decay：每 256 個樣本才算一次 pow，中間線性內插（快很多，聽不出差別）
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i0 = 0; i0 < len; i0 += 256) {
      const a = Math.pow(1 - i0 / len, decay), b = Math.pow(Math.max(0, 1 - (i0 + 256) / len), decay);
      const n = Math.min(256, len - i0);
      for (let k = 0; k < n; k++) d[i0 + k] = (Math.random() * 2 - 1) * (a + (b - a) * (k / 256));
    }
  }
  return buf;
}

function playSilent() {
  try {
    const b = ctx.createBuffer(1, 1, 22050);
    const s = ctx.createBufferSource();
    s.buffer = b;
    s.connect(ctx.destination);
    if (s.start) s.start(0); else s.noteOn(0);
  } catch (e) { /* ignore */ }
}

function tryResume() {
  if (!ctx) return;
  try {
    if (ctx.state !== 'running' && ctx.state !== 'closed') {
      const p = ctx.resume();
      if (p && p.then) p.then(() => { if (musicOn) startMusic(); }).catch(() => {});
    }
  } catch (e) { /* ignore */ }
}

// iOS 被中斷（來電、切 App）後要靠下一次手勢才能恢復，所以一直留著一個輕量的監聽
function hookGestures() {
  if (gestureHooked || typeof document === 'undefined') return;
  gestureHooked = true;
  const onGesture = () => {
    if (!ctx || document.hidden) return;
    if (ctx.state !== 'running') { tryResume(); playSilent(); }
  };
  ['pointerdown', 'touchend', 'keydown', 'mousedown'].forEach(t => {
    try { document.addEventListener(t, onGesture, { passive: true, capture: true }); } catch (e) { /* ignore */ }
  });
  document.addEventListener('visibilitychange', () => {
    try {
      if (!ctx) return;
      if (document.hidden) {
        stopMusic(true);
        if (ctx.state === 'running') ctx.suspend().catch(() => {});
      } else {
        tryResume();
        if (musicOn) startMusic();
      }
    } catch (e) { /* ignore */ }
  });
}

// ---------- 合成小積木 ----------
function track(src, cleanup) {
  voices++;
  src.onended = () => {
    voices--;
    try { cleanup.forEach(n => n.disconnect()); } catch (e) { /* ignore */ }
  };
}

function panNode(pan, dest) {
  if (!pan || !ctx.createStereoPanner) return dest;
  const p = ctx.createStereoPanner();
  p.pan.value = clamp(pan, -1, 1);
  p.connect(dest);
  return p;
}

// 一個有包絡的振盪器音
function tone(freq, t, o = {}) {
  const {
    type = 'sine', dur = 0.3, attack = 0.005, gain = 0.15, to = null, glide = 0.06,
    detune = 0, lp = null, hp = null, q = 0.7, pan = 0, dest = sfxBus, vibrato = 0, release = null, own = null,
  } = o;
  if (freq > ctx.sampleRate * 0.45) return;     // 聽不到的高泛音直接略過
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + glide);
  if (detune) osc.detune.setValueAtTime(detune, t);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(gain, t + attack);
  if (release) {
    g.gain.setValueAtTime(gain, t + attack + dur);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + dur + release);
  } else {
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + dur);
  }
  const nodes = [osc, g];
  let head = osc;
  if (lp) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; f.Q.value = q; head.connect(f); head = f; nodes.push(f); }
  if (hp) { const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hp; f.Q.value = q; head.connect(f); head = f; nodes.push(f); }
  if (vibrato) {
    const lfo = ctx.createOscillator(), lg = ctx.createGain();
    lfo.frequency.value = 5.5; lg.gain.value = vibrato;
    lfo.connect(lg); lg.connect(osc.frequency);
    lfo.start(t); lfo.stop(t + attack + dur + (release || 0) + 0.05);
    nodes.push(lfo, lg);
  }
  head.connect(g);
  const out = panNode(pan, dest);
  g.connect(out);
  if (out !== dest) nodes.push(out);
  if (own) nodes.push(...own);
  osc.start(t);
  osc.stop(t + attack + dur + (release || 0) + 0.05);
  track(osc, nodes);
}

// 濾波噪音（咻、噗）
function noise(t, o = {}) {
  const { dur = 0.2, attack = 0.01, gain = 0.06, type = 'bandpass', f0 = 1000, f1 = null, q = 1, pan = 0, dest = sfxBus, mid = null } = o;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = type; f.Q.value = q;
  f.frequency.setValueAtTime(f0, t);
  if (mid) {
    f.frequency.exponentialRampToValueAtTime(mid, t + dur * 0.5);
    f.frequency.exponentialRampToValueAtTime(f1 || f0, t + dur);
  } else if (f1) {
    f.frequency.exponentialRampToValueAtTime(f1, t + dur);
  }
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f); f.connect(g);
  const out = panNode(pan, dest);
  g.connect(out);
  const nodes = [src, f, g];
  if (out !== dest) nodes.push(out);
  src.loop = true;
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.05);
  track(src, nodes);
}

// 木琴：基音 + 4 倍泛音的「咚」
// 有左右聲道時，整個音只建一個 panner（每個泛音各建一個很浪費），跟著最長的那個泛音一起清掉
function marimba(m, t, gain = 0.15, dur = 0.45, dest = sfxBus, pan = 0) {
  const f = mtof(m), out = panNode(pan, dest), own = out !== dest ? [out] : null;
  tone(f, t, { dur, attack: 0.003, gain, dest: out, own });
  tone(f * 3.93, t, { dur: 0.07, attack: 0.002, gain: gain * 0.32, dest: out });
  tone(f * 9.2, t, { dur: 0.025, attack: 0.001, gain: gain * 0.08, dest: out });
}

// 鈴聲：不和諧泛音、比較長的尾巴
function bell(m, t, gain = 0.1, dur = 1.0, dest = sfxBus, pan = 0) {
  const f = mtof(m), out = panNode(pan, dest), own = out !== dest ? [out] : null;
  tone(f, t, { dur, attack: 0.003, gain, dest: out, own });
  tone(f * 2.76, t, { dur: dur * 0.55, attack: 0.002, gain: gain * 0.35, dest: out });
  tone(f * 5.4, t, { dur: dur * 0.3, attack: 0.002, gain: gain * 0.16, dest: out });
  tone(f * 8.93, t, { dur: dur * 0.15, attack: 0.001, gain: gain * 0.07, dest: out });
}

// 啵
function pop(t, f0 = 700, f1 = 260, gain = 0.12, dur = 0.08) {
  tone(f0, t, { dur, attack: 0.003, gain, to: f1, glide: dur * 0.8 });
}

// 亮晶晶：一串高音小鈴
function sparkle(t, n = 5, gain = 0.05, base = 96, spread = 0.045) {
  for (let i = 0; i < n; i++) {
    const m = penta(base, Math.floor(rnd(0, 8)));
    bell(m, t + i * spread + rnd(0, 0.015), gain * rnd(0.6, 1), 0.28, sfxBus, rnd(-0.6, 0.6));
  }
}

// 啵：泡泡破掉那種短促的音（音高從上往下滑一點點）＋ 一點木琴的「咚」＋ 很短的高頻 click
function bubble(m, t, gain = 0.13, pan = 0) {
  const f = mtof(m), out = panNode(pan, sfxBus), own = out !== sfxBus ? [out] : null;
  tone(f * 1.5, t, { dur: 0.06, attack: 0.002, gain: gain * 0.9, to: f, glide: 0.035, dest: out });
  tone(f, t + 0.004, { dur: 0.16, attack: 0.002, gain: gain * 0.55, dest: out, own });
  tone(f * 3.93, t + 0.004, { dur: 0.04, attack: 0.001, gain: gain * 0.14, dest: out });
  noise(t, { dur: 0.018, attack: 0.001, gain: gain * 0.35, type: 'highpass', f0: 3500, q: 0.7, dest: out });
}

// ---------- 各個音效 ----------
const SFX = {
  tap(t) {
    pop(t, 900, 560, 0.09, 0.05);
  },
  select(t) {
    tone(520, t, { dur: 0.07, attack: 0.003, gain: 0.07, to: 820, glide: 0.06 });
    marimba(84, t + 0.015, 0.08, 0.25);
  },
  // 交換：輕輕的「咻」
  swap(t, o) {
    noise(t, { dur: 0.16, attack: 0.01, gain: o.bad ? 0.07 : 0.11, type: 'bandpass', f0: 500, f1: 3600, q: 1.4 });
    noise(t + 0.02, { dur: 0.12, attack: 0.01, gain: o.bad ? 0.03 : 0.05, type: 'highpass', f0: 3500, f1: 7000, q: 0.7 });
    tone(280, t, { dur: 0.11, attack: 0.008, gain: 0.07, to: 520, glide: 0.1, type: 'triangle', lp: 1800 });
  },
  // 換不了：「啵啵」往下彈回去
  invalid(t) {
    tone(mtof(62), t, { dur: 0.07, attack: 0.006, gain: 0.09, type: 'triangle', lp: 1000, to: mtof(60), glide: 0.07 });
    tone(mtof(57), t + 0.075, { dur: 0.1, attack: 0.006, gain: 0.08, type: 'triangle', lp: 900, to: mtof(55), glide: 0.1 });
  },
  // 消除：連鎖每多一層、同一步每多一組，音就往五聲音階上走（像 Candy Crush 越連越高）
  pop(t, o) {
    const c = clamp(Math.round(o.cascade || 1), 1, 12), g = clamp(Math.round(o.group || 0), 0, 8);
    const step = (c - 1) * 2 + g;
    const m = penta(74, Math.min(step, 13));
    const big = (o.size || 3) >= 4;
    noise(t, { dur: 0.018, attack: 0.001, gain: 0.07, type: 'highpass', f0: 3000, q: 0.7 });
    tone(190 + step * 6, t, { dur: 0.07, attack: 0.002, gain: 0.08, to: 95, glide: 0.06 });
    // 糖果碎開：短短的「喀啦」+ 幾顆很小的高音玻璃聲（和畫面上的碎片同時）
    noise(t + 0.03, { dur: 0.07, attack: 0.001, gain: 0.07, type: 'bandpass', f0: 5200, f1: 2600, q: 2.6 });
    for (let i = 0; i < 3; i++) tone(rnd(2800, 5200), t + 0.035 + i * rnd(0.012, 0.028), { dur: 0.05, attack: 0.001, gain: 0.025, type: 'sine' });
    bubble(m, t, big ? 0.19 : 0.17, clamp((g - 1) * 0.25, -0.5, 0.5));
    if (big) { marimba(m + 12, t + 0.02, 0.09, 0.3); bell(m + 12, t + 0.03, 0.04, 0.5); }
    if (c >= 3 && g === 0) sparkle(t + 0.05, Math.min(c, 6), 0.026, 91 + Math.min(c, 6));
  },
  match(t, o) { SFX.pop(t, o); },
  // 做出特殊方塊：亮晶晶往上爬
  special(t) {
    bell(penta(84, 0), t, 0.07, 0.5);
    bell(penta(84, 2), t + 0.055, 0.075, 0.6);
    bell(penta(84, 4), t + 0.11, 0.08, 0.8);
    noise(t, { dur: 0.35, attack: 0.03, gain: 0.025, type: 'highpass', f0: 6000, q: 0.5 });
    sparkle(t + 0.14, 4, 0.032);
  },
  // 條紋：「咻——滋」掃過去
  stripe(t) {
    tone(320, t, { dur: 0.18, attack: 0.004, gain: 0.13, to: 2600, glide: 0.16, type: 'sawtooth', lp: 3000, q: 1.2 });
    tone(480, t + 0.01, { dur: 0.16, attack: 0.004, gain: 0.06, to: 3200, glide: 0.15 });
    tone(110, t, { dur: 0.2, attack: 0.003, gain: 0.12, to: 55, glide: 0.18 });
    noise(t, { dur: 0.26, attack: 0.004, gain: 0.13, type: 'bandpass', f0: 1200, f1: 8000, q: 0.9 });
    pop(t, 900, 300, 0.05, 0.05);
    sparkle(t + 0.12, 3, 0.026, 98);
  },
  // 包裝：低沉的「碰」
  wrap(t, o) {
    const big = (o.radius || 1) > 1;
    tone(big ? 140 : 170, t, { dur: big ? 0.5 : 0.36, attack: 0.003, gain: big ? 0.4 : 0.34, to: 38, glide: big ? 0.45 : 0.3 });
    noise(t, { dur: big ? 0.42 : 0.3, attack: 0.002, gain: 0.18, type: 'lowpass', f0: 1800, f1: 160, q: 0.6 });
    noise(t + 0.01, { dur: 0.12, attack: 0.001, gain: 0.07, type: 'highpass', f0: 2500, q: 0.6 });
    pop(t + 0.04, 520, 200, 0.06, 0.08);
    bell(penta(72, 0), t + 0.02, 0.04, 0.5);
  },
  // 彩色炸彈：閃電一根接一根，叮叮叮往上爬（時間和畫面上的閃電一樣）
  bomb(t, o) {
    const n = clamp(Math.round(o.n || 9), 1, 40);
    const stg = Math.min(0.03, 0.42 / n), k = Math.min(n, 12), every = n / k;
    noise(t, { dur: 0.2, attack: 0.004, gain: 0.07, type: 'bandpass', f0: 2500, f1: 600, q: 1.5 });
    tone(110, t, { dur: 0.35 + n * stg, attack: 0.05, gain: 0.09, to: 230, glide: 0.3 + n * stg, type: 'sine' });
    for (let i = 0; i < k; i++) {
      const at = t + 0.09 + Math.floor(i * every) * stg;
      bell(penta(74, i), at, 0.05, 0.35, sfxBus, -0.6 + (1.2 * i) / Math.max(1, k - 1));
      noise(at, { dur: 0.03, attack: 0.001, gain: 0.03, type: 'highpass', f0: 5000, q: 0.6 });
    }
    noise(t, { dur: 0.3 + n * stg, attack: 0.15, gain: 0.06, type: 'bandpass', f0: 400, f1: 6000, q: 1.1 });
    tone(150, t + 0.12 + n * stg, { dur: 0.4, attack: 0.003, gain: 0.26, to: 40, glide: 0.35 });
    sparkle(t + 0.12 + n * stg, 8, 0.045, 96, 0.03);
  },
  // 炸彈 + 炸彈：整個盤面
  board(t) {
    tone(120, t, { dur: 0.7, attack: 0.004, gain: 0.3, to: 36, glide: 0.6 });
    noise(t, { dur: 0.8, attack: 0.01, gain: 0.1, type: 'lowpass', f0: 2400, f1: 150, q: 0.6 });
    [72, 76, 79, 84, 88].forEach((m, i) => bell(m, t + 0.08 + i * 0.07, 0.07, 1.0, sfxBus, -0.4 + i * 0.2));
    sparkle(t + 0.3, 12, 0.04, 96, 0.03);
  },
  // 兩個特殊方塊互換
  combo(t) {
    tone(150, t, { dur: 0.4, attack: 0.004, gain: 0.25, to: 42, glide: 0.36 });
    noise(t, { dur: 0.5, attack: 0.02, gain: 0.06, type: 'bandpass', f0: 500, f1: 5000, q: 0.8 });
    [72, 76, 79, 84].forEach((m, i) => bell(m, t + 0.05 + i * 0.05, 0.07, 0.7));
    sparkle(t + 0.25, 8, 0.035, 96, 0.03);
  },
  // 長連鎖：「好棒！」「太甜了！」跳出來時的和弦叮咚，越長越高
  chime(t, o) {
    const lv = clamp(Math.round(o.level || 3), 3, 8), base = 76 + (lv - 3) * 2;
    [0, 4, 7, 12].forEach((d, i) => bell(base + d, t + i * 0.045, 0.085, 0.9, sfxBus, -0.3 + i * 0.2));
    marimba(base - 12, t, 0.1, 0.4);
    sparkle(t + 0.15, 4 + lv, 0.03, 96, 0.03);
  },
  // 落地：脆脆的「喀」— 很短的敲擊聲 + 一點點糖果共鳴；音高依位置稍微不同，一串落下來像糖果互相敲到
  land(t, o) {
    const r = o.r || 0, c = o.c || 0, k = o.k || 0;
    const f = 1650 + ((r * 37 + c * 53 + k * 29) % 9) * 95;
    noise(t, { dur: 0.012, attack: 0.0005, gain: 0.05, type: 'bandpass', f0: 3600, q: 1.6 });
    tone(f, t, { dur: 0.05, attack: 0.001, gain: 0.05, type: 'sine', to: f * 0.93, glide: 0.045 });
    tone(f * 2.7, t, { dur: 0.026, attack: 0.001, gain: 0.016, type: 'sine' });
    tone(260, t, { dur: 0.03, attack: 0.001, gain: 0.025, to: 180, glide: 0.03 });     // 很輕的底，聽起來有重量
  },
  shuffle(t) {
    noise(t, { dur: 0.5, attack: 0.05, gain: 0.06, type: 'bandpass', f0: 900, mid: 3200, f1: 700, q: 1.2 });
    for (let i = 0; i < 7; i++) marimba(penta(72, Math.floor(rnd(0, 8))), t + 0.05 + i * 0.05, 0.06, 0.25, sfxBus, rnd(-0.7, 0.7));
  },
  win(t) {
    [72, 76, 79, 84].forEach((m, i) => { marimba(m, t + i * 0.12, 0.15, 0.4); bell(m + 12, t + i * 0.12, 0.035, 0.4); });
    [88, 91, 96].forEach(m => bell(m, t + 0.52, 0.07, 1.4));
    marimba(72, t + 0.52, 0.12, 0.9);
    sparkle(t + 0.55, 8, 0.04);
  },
  lose(t) {
    const notes = [67, 64, 62, 60];
    notes.forEach((m, i) => {
      const last = i === notes.length - 1;
      tone(mtof(m), t + i * 0.3, {
        type: 'triangle', lp: 900, attack: 0.03, gain: 0.1, dur: last ? 0.7 : 0.26,
        to: last ? mtof(m - 1.5) : null, glide: 0.7, vibrato: last ? 3 : 0,
      });
    });
    tone(mtof(48), t + 0.9, { type: 'sine', attack: 0.05, gain: 0.07, dur: 0.8 });
  },
  star(t, o) {
    let i = o.n != null ? o.n - 1 : (o.index != null ? o.index : 0);
    i = clamp(Math.round(i), 0, 4);
    const m = [84, 88, 91, 96, 100][i];             // C6 → E6 → G6，一顆比一顆高
    bell(m, t, 0.12, 1.0);
    marimba(m - 12, t, 0.08, 0.35);
    sparkle(t + 0.05, 3 + i * 2, 0.035, 96);
  },
  sugar(t) {
    const brass = (m, at, dur, g = 0.07) => {
      tone(mtof(m), at, { type: 'sawtooth', lp: 1700, q: 0.8, attack: 0.03, gain: g, dur, release: 0.25, detune: -6 });
      tone(mtof(m), at, { type: 'sawtooth', lp: 1700, q: 0.8, attack: 0.03, gain: g * 0.8, dur, release: 0.25, detune: 7 });
    };
    brass(67, t, 0.08);
    brass(72, t + 0.13, 0.08);
    brass(76, t + 0.26, 0.08);
    brass(79, t + 0.39, 0.55, 0.08);
    brass(72, t + 0.39, 0.55, 0.05);
    brass(76, t + 0.39, 0.55, 0.05);
    bell(91, t + 0.39, 0.06, 1.2);
    sparkle(t + 0.42, 10, 0.04, 96, 0.04);
  },
};

// ---------- 背景音樂（排程 + lookahead） ----------
const BPM = 92;
const STEP = 60 / BPM / 2;                      // 八分音符
const CHORDS = [                                // 每小節：根音、墊音
  { root: 36, pad: [60, 64, 67] },              // C
  { root: 33, pad: [57, 60, 64] },              // Am
  { root: 29, pad: [57, 60, 65] },              // F
  { root: 31, pad: [55, 59, 62] },              // G
];
const _ = null;
const MELODY = [                                // 8 小節 × 8 個八分音符，全部在五聲音階
  76, _, 79, 76, 74, _, 72, _,
  69, _, 72, 74, 76, _, _, _,
  76, 74, 72, _, 69, _, 72, _,
  74, _, 79, _, 76, 74, _, _,
  79, _, 81, 79, 76, _, 79, _,
  81, _, 79, 76, 72, _, 74, _,
  72, _, 69, 72, 74, _, 76, _,
  79, 76, 74, _, 72, _, _, _,
];
const TOTAL = MELODY.length;
let musicTimer = null, nextTime = 0, stepIdx = 0;

function musicStep(i, t) {
  const bar = Math.floor(i / 8), s = i % 8;
  const ch = CHORDS[bar % 4];
  if (s === 0) {
    const len = STEP * 8;
    ch.pad.forEach((m, k) => {
      tone(mtof(m), t, { type: 'triangle', lp: 950, attack: 0.5, dur: len - 0.55, release: 0.9, gain: 0.032, detune: -5, dest: musicBus, pan: (k - 1) * 0.4 });
      tone(mtof(m), t, { type: 'sine', attack: 0.6, dur: len - 0.65, release: 0.9, gain: 0.03, detune: 6, dest: musicBus, pan: (1 - k) * 0.4 });
    });
  }
  if (s === 0 || s === 4 || s === 7) {
    const m = s === 7 ? ch.root + 7 : ch.root + (s === 4 && bar % 2 ? 7 : 0);
    const f = mtof(m + 12);
    tone(f, t, { type: 'sine', attack: 0.01, dur: s === 7 ? STEP * 0.8 : STEP * 2.6, gain: 0.13, dest: musicBus });
    tone(f * 2, t, { type: 'triangle', lp: 700, attack: 0.01, dur: STEP * 0.9, gain: 0.02, dest: musicBus });
  }
  const m = MELODY[i];
  if (m != null) marimba(m, t, 0.075, 0.5, musicBus, 0.1);
  if (s === 7 && bar % 2 === 1) bell(penta(96, bar % 5), t, 0.022, 0.6, musicBus, -0.3);
  if (s % 2 === 1) noise(t, { dur: 0.045, attack: 0.004, gain: s === 3 || s === 7 ? 0.012 : 0.007, type: 'highpass', f0: 7000, q: 0.5, dest: musicBus, pan: 0.25 });
}

function scheduler() {
  if (!ctx || ctx.state !== 'running') return;
  try {
    if (nextTime < ctx.currentTime) nextTime = ctx.currentTime + 0.05;  // 卡住後別一口氣補一堆
    while (nextTime < ctx.currentTime + 0.18) {
      musicStep(stepIdx, nextTime);
      nextTime += STEP;
      stepIdx = (stepIdx + 1) % TOTAL;
    }
  } catch (e) { /* ignore */ }
}

function startMusic() {
  if (!ctx || !unlocked || !musicOn || musicTimer) return;
  if (typeof document !== 'undefined' && document.hidden) return;
  try {
    const now = ctx.currentTime;
    musicBus.gain.cancelScheduledValues(now);
    musicBus.gain.setValueAtTime(musicBus.gain.value, now);
    musicBus.gain.linearRampToValueAtTime(MUSIC_VOL, now + 1.2);
    nextTime = now + 0.1;
    stepIdx = 0;
    musicTimer = setInterval(scheduler, 40);
    scheduler();
  } catch (e) { /* ignore */ }
}

function stopMusic(fast) {
  if (musicTimer) { clearInterval(musicTimer); musicTimer = null; }
  if (!ctx || !musicBus) return;
  try {
    const now = ctx.currentTime;
    musicBus.gain.cancelScheduledValues(now);
    musicBus.gain.setValueAtTime(musicBus.gain.value, now);
    musicBus.gain.linearRampToValueAtTime(0, now + (fast ? 0.08 : 0.4));
  } catch (e) { /* ignore */ }
}

// ---------- 對外 API ----------
// ---------- 稱讚語音（assets/voice/*.wav，tools/voice_fx.py 做的「魔性」男聲） ----------
const VOICE_IDS = ['c2', 'c3', 'c4', 'c5', 'combo', 's1', 's2', 'start', 'sugar', 'win3'];
const voiceBuf = Object.create(null);
let voiceLoading = false, voiceSrc = null;
function loadVoices() {
  if (voiceLoading || !ctx) return;
  voiceLoading = true;
  for (const id of VOICE_IDS) {
    fetch(`assets/voice/${id}.wav`).then(r => (r.ok ? r.arrayBuffer() : null))
      .then(ab => ab && new Promise((res, rej) => ctx.decodeAudioData(ab, res, rej)))
      .then(b => { if (b) voiceBuf[id] = b; })
      .catch(() => { /* 沒有語音檔就不講話 */ });
  }
}
SFX.voice = (t, o) => {
  const b = voiceBuf[o.id];
  if (!b) return;
  try { if (voiceSrc) voiceSrc.stop(t); } catch (e) { /* 已經停了 */ }
  const s = ctx.createBufferSource(), g = ctx.createGain();
  s.buffer = b;
  g.gain.value = 0.95;
  s.connect(g); g.connect(sfxBus);
  s.start(t);
  voiceSrc = s;
};

export const audio = {
  unlock() {
    try {
      if (!ctx) {
        ctx = makeContext();
        if (!ctx) return;
        hookGestures();
      }
      unlocked = true;
      tryResume();
      playSilent();
      loadVoices();
      if (musicOn) startMusic();
    } catch (e) { /* ignore */ }
  },

  play(name, opts = {}) {
    try {
      if (!ctx || !unlocked || muted) return;
      if (ctx.state !== 'running') { tryResume(); return; }
      const fn = SFX[name];
      if (!fn) return;
      const o = opts || {};
      const delay = Number.isFinite(o.delay) ? clamp(o.delay, 0, 3000) / 1000 : 0;
      const at = ctx.currentTime + 0.005 + delay;
      const gap = GAP[name] != null ? GAP[name] : 0.03;
      const list = lastPlayed[name] || (lastPlayed[name] = []);
      for (const x of list) if (Math.abs(at - x) < gap) return;
      if (voices > MAX_VOICES) return;
      list.push(at);
      if (list.length > 10) list.shift();
      fn(at, o);
    } catch (e) { /* ignore */ }
  },

  setMuted(b) {
    muted = !!b;
    try {
      if (ctx && sfxBus) {
        const now = ctx.currentTime;
        sfxBus.gain.cancelScheduledValues(now);
        sfxBus.gain.setValueAtTime(sfxBus.gain.value, now);
        sfxBus.gain.linearRampToValueAtTime(muted ? 0 : SFX_VOL, now + 0.05);
      }
    } catch (e) { /* ignore */ }
  },
  get muted() { return muted; },

  setMusic(b) {
    musicOn = !!b;
    try { if (musicOn) startMusic(); else stopMusic(false); } catch (e) { /* ignore */ }
  },
  get music() { return musicOn; },

  // 除錯用（非 SPEC 必要）
  get ready() { return !!ctx && unlocked && ctx.state === 'running'; },
  get names() { return Object.keys(SFX); },
};

export default audio;
