// 毛絨消消樂 — 音效與背景音樂，全部用 Web Audio 即時合成（不用音檔）
// API（docs/SPEC.md §5）：
//   audio.unlock()            第一次 pointerdown / keydown 時呼叫；建立或喚醒 AudioContext（含 iOS 解鎖）
//   audio.play(name, opts)    靜音或尚未解鎖時直接忽略；永遠不丟例外
//   audio.setMuted(b) / audio.muted     只管音效（sfx）；音樂另外用 setMusic 控制
//   audio.setMusic(b) / audio.music     輕柔循環背景音樂；分頁隱藏時自動暫停
// 音效名稱：tap select swap invalid match(opts.cascade 1..n) stripe wrap bomb special land shuffle
//           win lose star(opts.n 1..3) sugar combo

const PENTA = [0, 2, 4, 7, 9];                       // C 大調五聲音階
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
const penta = (base, step) => base + 12 * Math.floor(step / 5) + PENTA[((step % 5) + 5) % 5];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rnd = (a, b) => a + Math.random() * (b - a);

const MASTER_VOL = 1.0;
const SFX_VOL = 0.9;
const MUSIC_VOL = 0.32;
const MAX_VOICES = 140;              // 以振盪器數量計（一個鈴聲 = 4 個）

let ctx = null;
let master = null, sfxBus = null, musicBus = null, revIn = null, noiseBuf = null;
let unlocked = false, muted = false, musicOn = false;
let voices = 0;
let gestureHooked = false;
const lastPlayed = Object.create(null);

// 同一個音效最短間隔（秒），避免同時疊太多變得很吵
const GAP = { land: 0.09, tap: 0.04, match: 0.05, special: 0.06, star: 0.05 };

// ---------- 建立音訊圖 ----------
function makeContext() {
  const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  if (!AC) return null;
  let c = null;
  try { c = new AC({ latencyHint: 'interactive' }); } catch (e) {
    try { c = new AC(); } catch (e2) { return null; }
  }
  try {
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 14;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.25;
    comp.connect(c.destination);

    master = c.createGain();
    master.gain.value = MASTER_VOL;
    master.connect(comp);

    // 小小的殘響，讓木琴 / 鈴聲更柔
    const rev = c.createConvolver();
    rev.buffer = makeImpulse(c, 1.6, 2.6);
    revIn = c.createGain();
    revIn.gain.value = 0.22;
    revIn.connect(rev);
    rev.connect(master);

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

    noiseBuf = c.createBuffer(1, Math.floor(c.sampleRate * 1.0), c.sampleRate);
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
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
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
    detune = 0, lp = null, hp = null, q = 0.7, pan = 0, dest = sfxBus, vibrato = 0, release = null,
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
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.05);
  track(src, nodes);
}

// 木琴：基音 + 4 倍泛音的「咚」
function marimba(m, t, gain = 0.15, dur = 0.45, dest = sfxBus, pan = 0) {
  const f = mtof(m);
  tone(f, t, { dur, attack: 0.003, gain, dest, pan });
  tone(f * 3.93, t, { dur: 0.07, attack: 0.002, gain: gain * 0.32, dest, pan });
  tone(f * 9.2, t, { dur: 0.025, attack: 0.001, gain: gain * 0.08, dest, pan });
}

// 鈴聲：不和諧泛音、比較長的尾巴
function bell(m, t, gain = 0.1, dur = 1.0, dest = sfxBus, pan = 0) {
  const f = mtof(m);
  tone(f, t, { dur, attack: 0.003, gain, dest, pan });
  tone(f * 2.76, t, { dur: dur * 0.55, attack: 0.002, gain: gain * 0.35, dest, pan });
  tone(f * 5.4, t, { dur: dur * 0.3, attack: 0.002, gain: gain * 0.16, dest, pan });
  tone(f * 8.93, t, { dur: dur * 0.15, attack: 0.001, gain: gain * 0.07, dest, pan });
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

// ---------- 各個音效 ----------
const SFX = {
  tap(t) {
    pop(t, 900, 560, 0.09, 0.05);
  },
  select(t) {
    tone(520, t, { dur: 0.09, attack: 0.004, gain: 0.08, to: 820, glide: 0.07 });
    marimba(84, t + 0.02, 0.1, 0.3);
  },
  swap(t) {
    noise(t, { dur: 0.16, gain: 0.08, type: 'bandpass', f0: 700, f1: 2600, q: 1.4 });
    tone(330, t, { dur: 0.12, attack: 0.01, gain: 0.09, to: 500, glide: 0.11, type: 'triangle', lp: 1800 });
  },
  invalid(t) {
    tone(mtof(64), t, { dur: 0.1, attack: 0.008, gain: 0.1, type: 'triangle', lp: 1100, to: mtof(63), glide: 0.1 });
    tone(mtof(60), t + 0.12, { dur: 0.16, attack: 0.008, gain: 0.1, type: 'triangle', lp: 1000, to: mtof(58), glide: 0.16 });
  },
  match(t, o) {
    const c = clamp(Math.round(o.cascade || 1), 1, 12);
    const step = c - 1;
    const top = penta(72, 2 + step);                 // E5, G5, A5, C6, D6, E6 ...
    marimba(top, t, 0.17, 0.45);
    marimba(penta(72, step), t + 0.012, 0.07, 0.35); // 和聲
    pop(t, 620 + step * 70, 280 + step * 30, 0.08, 0.07);
    if (c >= 3) sparkle(t + 0.06, Math.min(c, 7), 0.035, 91 + Math.min(step, 5));
  },
  special(t) {
    bell(penta(84, 2), t, 0.1, 0.7);
    bell(penta(84, 4), t + 0.09, 0.1, 0.9);
    sparkle(t + 0.12, 4, 0.04);
  },
  stripe(t) {
    tone(260, t, { dur: 0.24, attack: 0.006, gain: 0.11, to: 2100, glide: 0.22, type: 'triangle', lp: 3200 });
    tone(390, t + 0.02, { dur: 0.22, attack: 0.006, gain: 0.05, to: 2600, glide: 0.2, type: 'sine' });
    noise(t, { dur: 0.32, gain: 0.09, type: 'bandpass', f0: 900, f1: 6500, q: 0.9 });
    sparkle(t + 0.18, 3, 0.03, 98);
  },
  wrap(t) {
    tone(170, t, { dur: 0.38, attack: 0.004, gain: 0.42, to: 46, glide: 0.32 });
    noise(t, { dur: 0.28, gain: 0.12, type: 'lowpass', f0: 900, f1: 180, q: 0.6 });
    pop(t + 0.05, 500, 200, 0.07, 0.09);
    pop(t + 0.11, 640, 260, 0.05, 0.08);
    bell(penta(72, 0), t + 0.02, 0.05, 0.6);
  },
  bomb(t) {
    for (let i = 0; i < 9; i++) bell(penta(72, i), t + i * 0.045, 0.065, 0.5, sfxBus, -0.5 + i / 8);
    noise(t, { dur: 0.75, attack: 0.15, gain: 0.05, type: 'bandpass', f0: 400, f1: 6000, q: 1.2 });
    tone(110, t, { dur: 0.5, attack: 0.08, gain: 0.12, to: 220, glide: 0.45, type: 'sine' });
    sparkle(t + 0.38, 9, 0.04, 96, 0.035);
  },
  combo(t) {
    tone(150, t, { dur: 0.45, attack: 0.004, gain: 0.4, to: 42, glide: 0.4 });
    noise(t, { dur: 0.6, attack: 0.02, gain: 0.07, type: 'bandpass', f0: 500, f1: 5000, q: 0.8 });
    [72, 76, 79, 84].forEach((m, i) => bell(m, t + 0.05 + i * 0.06, 0.08, 0.8));
    sparkle(t + 0.3, 10, 0.04, 96, 0.03);
  },
  land(t) {
    tone(260, t, { dur: 0.07, attack: 0.003, gain: 0.08, to: 150, glide: 0.06 });
    tone(1300, t, { dur: 0.02, attack: 0.001, gain: 0.015 });
  },
  shuffle(t) {
    noise(t, { dur: 0.55, attack: 0.05, gain: 0.06, type: 'bandpass', f0: 900, mid: 3200, f1: 700, q: 1.2 });
    for (let i = 0; i < 7; i++) marimba(penta(72, Math.floor(rnd(0, 8))), t + 0.05 + i * 0.055, 0.06, 0.25, sfxBus, rnd(-0.7, 0.7));
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
      if (musicOn) startMusic();
    } catch (e) { /* ignore */ }
  },

  play(name, opts = {}) {
    try {
      if (!ctx || !unlocked || muted) return;
      if (ctx.state !== 'running') { tryResume(); return; }
      const fn = SFX[name];
      if (!fn) return;
      const now = ctx.currentTime;
      const gap = GAP[name] != null ? GAP[name] : 0.03;
      if (now - (lastPlayed[name] ?? -1) < gap) return;
      if (voices > MAX_VOICES) return;
      lastPlayed[name] = now;
      fn(now + 0.005, opts || {});
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
