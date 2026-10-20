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
let master = null, sfxBus = null, crispBus = null, musicBus = null, revIn = null, noiseBuf = null;
let crunchBufs = null;     // 糖果碎掉的聲音（makeCrunches 離線算好的幾種）
let unlocked = false, muted = false, musicOn = false;
let voices = 0;
let gestureHooked = false;
let stale = false;         // 頁面曾經被切到背景：下一次手勢時整個重建音訊（手機瀏覽器恢復後常常會沒聲音）
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
    // 糖果碎掉的聲音也是空閒時才算（第一次消除前通常就算好了；還沒好的話第一次用到時才算）
    const addRev = () => {
      try { rev.buffer = makeImpulse(c, 1.1, 2.6); } catch (e) { /* 沒有殘響也能玩 */ }
      try { if (!crunchBufs) crunchBufs = makeCrunches(c); } catch (e) { /* 用到時再算 */ }
    };
    if (typeof requestIdleCallback === 'function') requestIdleCallback(addRev, { timeout: 4000 });
    else setTimeout(addRev, 1500);

    sfxBus = c.createGain();
    sfxBus.gain.value = muted ? 0 : SFX_VOL;
    // 溫暖的濾波：把刺耳的高頻收掉（聽起來比較圓、比較療癒）
    const warm = c.createBiquadFilter();
    warm.type = 'lowpass'; warm.frequency.value = 4600; warm.Q.value = 0.4;
    const shelf = c.createBiquadFilter();
    shelf.type = 'highshelf'; shelf.frequency.value = 2800; shelf.gain.value = -5;
    sfxBus.connect(shelf); shelf.connect(warm); warm.connect(master);
    sfxBus.connect(revIn);
    // 清脆的那條路（糖果碎掉的「咔」）：不經過上面的柔化低通，高頻的脆裂才留得住；只切掉很低的悶聲和最刺的頂端
    crispBus = c.createGain();
    crispBus.gain.value = muted ? 0 : SFX_VOL;
    const tight = c.createBiquadFilter();
    tight.type = 'highpass'; tight.frequency.value = 280; tight.Q.value = 0.5;
    const air = c.createBiquadFilter();
    air.type = 'lowpass'; air.frequency.value = 11500; air.Q.value = 0.5;
    crispBus.connect(tight); tight.connect(air); air.connect(master);
    const crispRev = c.createGain();
    crispRev.gain.value = 0.3;
    crispBus.connect(crispRev); crispRev.connect(revIn);

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

// 硬糖碎掉的聲音（像咬碎糖果那種「咔啦」）：一聲主要的脆裂（中頻的身體 + 很亮的頂），緊接著幾聲很快的小裂，
// 一點點糖玻璃的「叮」，最後是碎片掉下來的細碎聲。離線先算好 n 種（每顆糖果隨機挑一種、播放時只改音高），很省
function makeCrunches(c, n = 6) {
  const sr = c.sampleRate, out = [];
  for (let v = 0; v < n; v++) {
    const len = Math.floor(sr * 0.22), buf = c.createBuffer(1, len, sr), d = buf.getChannelData(0);
    // 一聲短促、有共鳴的裂：雜訊 × 很快衰減的包絡，經過帶通（RBJ 二階），音色在 f 附近；q 越大越像「叮」
    const crack = (at, amp, f, q, ms) => {
      const i0 = Math.floor(at * sr), n0 = Math.max(4, Math.floor(sr * ms / 1000)), ring = Math.floor(sr * 0.01);
      const w = 2 * Math.PI * Math.min(f, sr * 0.45) / sr, al = Math.sin(w) / (2 * q), a0 = 1 + al;
      const b0 = al / a0, b2 = -al / a0, a1 = -2 * Math.cos(w) / a0, a2 = (1 - al) / a0;
      let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
      for (let k = 0; k < n0 + ring && i0 + k < len; k++) {
        const x0 = k < n0 ? (Math.random() * 2 - 1) * Math.exp(-k / (n0 * 0.3)) : 0;
        const y0 = b0 * x0 + b2 * x2 - a1 * y1 - a2 * y2;
        x2 = x1; x1 = x0; y2 = y1; y1 = y0;
        d[i0 + k] += y0 * amp;
      }
    };
    const tink = (at, amp, f, tau) => {
      const i0 = Math.floor(at * sr), n0 = Math.floor(sr * tau * 6);
      for (let k = 0; k < n0 && i0 + k < len; k++) d[i0 + k] += amp * Math.sin(2 * Math.PI * f * k / sr) * Math.exp(-k / (sr * tau));
    };
    crack(0, 1.4, 1700 + Math.random() * 700, 0.8, 5);                      // 「咔」的身體
    crack(0.0006, 1.3, 4300 + Math.random() * 1800, 2.2, 4);                 // 很亮的頂
    let t = 0.007 + Math.random() * 0.006;
    for (let i = 0, m = 3 + Math.floor(Math.random() * 3); i < m; i++) {     // 緊接著的小裂（kr-kr-k）
      crack(t, (0.85 + Math.random() * 0.6) * Math.pow(0.8, i), 2400 + Math.random() * 4600, 2 + Math.random() * 4, 2 + Math.random() * 3);
      t += 0.006 + Math.random() * 0.012;
    }
    const tf = 2900 + Math.random() * 1200;                                  // 糖玻璃的「叮」（很短）
    tink(0.0015, 0.12, tf, 0.016);
    tink(0.0015, 0.05, tf * 2.71, 0.008);
    for (let i = 0, tc = t + 0.012; i < 9 && tc < 0.2; i++) {                // 碎片掉下來
      crack(tc, 0.32 * Math.pow(0.82, i) * (0.5 + Math.random()), 3200 + Math.random() * 5000, 3 + Math.random() * 5, 1 + Math.random() * 1.5);
      tc += 0.007 + Math.random() * 0.018;
    }
    let peak = 0;
    for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(d[i]));
    if (peak > 0) for (let i = 0; i < len; i++) d[i] *= 0.95 / peak;
    out.push(buf);
  }
  return out;
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

// 切回來後的第一次手勢：關掉舊的 AudioContext，整個重建（比 resume 可靠：iOS Safari 常常 resume 了卻沒聲音）
let rebuilds = 0;
function rebuild() {
  stale = false;
  rebuilds++;
  try { stopMusic(true); } catch (e) { /* ignore */ }
  const old = ctx;
  try { if (voiceSrc) voiceSrc.stop(); } catch (e) { /* ignore */ }
  voiceSrc = null;
  crunchBufs = null;          // 新的 AudioContext 重算一次（makeContext 空閒時會算）
  const c = makeContext();
  if (!c) return;
  ctx = c;
  for (const k in lastPlayed) delete lastPlayed[k];
  for (const k in voiceBuf) delete voiceBuf[k];
  voiceLoading = false;
  voices = 0;
  try { if (old && old.state !== 'closed') old.close().catch(() => {}); } catch (e) { /* ignore */ }
  tryResume();
  playSilent();
  loadVoices();
  if (musicOn) startMusic();
}

// iOS 被中斷（來電、切 App）後要靠下一次手勢才能恢復，所以一直留著一個輕量的監聽
function hookGestures() {
  if (gestureHooked || typeof document === 'undefined') return;
  gestureHooked = true;
  const onGesture = () => {
    if (!ctx || document.hidden) return;
    if (stale) { rebuild(); return; }
    if (ctx.state !== 'running') { tryResume(); playSilent(); }
  };
  ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown', 'mousedown'].forEach(t => {
    try { document.addEventListener(t, onGesture, { passive: true, capture: true }); } catch (e) { /* ignore */ }
  });
  // 從背景 / 上一頁回來（bfcache）也一樣：下一次手勢時重建
  window.addEventListener('pageshow', e => { if (e.persisted) stale = true; });
  window.addEventListener('pagehide', () => { stale = true; });
  document.addEventListener('visibilitychange', () => {
    try {
      if (!ctx) return;
      if (document.hidden) {
        stopMusic(true);
        stale = true;
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
  tone(f * 3.93, t, { dur: 0.06, attack: 0.002, gain: gain * 0.18, dest: out });
}

// 鈴聲：不和諧泛音、比較長的尾巴
function bell(m, t, gain = 0.1, dur = 1.0, dest = sfxBus, pan = 0) {
  const f = mtof(m), out = panNode(pan, dest), own = out !== dest ? [out] : null;
  tone(f, t, { dur, attack: 0.003, gain, dest: out, own });
  tone(f * 2.76, t, { dur: dur * 0.5, attack: 0.002, gain: gain * 0.22, dest: out });
  tone(f * 5.4, t, { dur: dur * 0.25, attack: 0.002, gain: gain * 0.06, dest: out });
}

// 啵
function pop(t, f0 = 700, f1 = 260, gain = 0.12, dur = 0.08) {
  tone(f0, t, { dur, attack: 0.003, gain, to: f1, glide: dur * 0.8 });
}

// 糖果碎掉：挑一種算好的「咔啦」，rate 改音高（也會跟著變短 / 變長），走清脆的那條路
function crunch(t, rate = 1, gain = 0.3, pan = 0) {
  if (!crunchBufs) crunchBufs = makeCrunches(ctx);
  const src = ctx.createBufferSource();
  src.buffer = crunchBufs[Math.floor(Math.random() * crunchBufs.length)];
  src.playbackRate.value = rate;
  const g = ctx.createGain();
  g.gain.value = gain;
  src.connect(g);
  const out = panNode(pan, crispBus);
  g.connect(out);
  const nodes = [src, g];
  if (out !== crispBus) nodes.push(out);
  src.start(t);
  track(src, nodes);
}

// 亮晶晶：一串高音小鈴
function sparkle(t, n = 5, gain = 0.05, base = 96, spread = 0.045) {
  base = Math.min(base, 96) - 12; gain *= 0.6;          // 低一個八度、小聲一點，不刺耳
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
    noise(t, { dur: 0.16, attack: 0.012, gain: o.bad ? 0.06 : 0.09, type: 'bandpass', f0: 400, f1: 2200, q: 1.4 });
    tone(280, t, { dur: 0.11, attack: 0.008, gain: 0.07, to: 520, glide: 0.1, type: 'triangle', lp: 1800 });
  },
  // 換不了：「啵啵」往下彈回去
  invalid(t) {
    tone(mtof(62), t, { dur: 0.07, attack: 0.006, gain: 0.09, type: 'triangle', lp: 1000, to: mtof(60), glide: 0.07 });
    tone(mtof(57), t + 0.075, { dur: 0.1, attack: 0.006, gain: 0.08, type: 'triangle', lp: 900, to: mtof(55), glide: 0.1 });
  },
  // 消除：連鎖每多一層、同一步每多一組，音就往五聲音階上走（像 Candy Crush 越連越高）
  pop(t, o) {
    // 硬糖碎掉的「咔啦」（renderer 在糖果碎開的那一刻叫）：清脆的裂聲 + 一點點跟著五聲音階往上的「叮」+ 很輕的身體；
    // 同一組一顆比一顆高、連鎖越多越高（裂聲的音高只跟著走一半，太高會變尖）
    const c = clamp(Math.round(o.cascade || 1), 1, 12), g = clamp(Math.round(o.group || 0), 0, 8), j = clamp(Math.round(o.idx || 0), 0, 8);
    const step = (c - 1) * 2 + g + j;
    const m = penta(60, Math.min(step, 14));
    const f = mtof(m);
    const pan = clamp((j - 2) * 0.18, -0.5, 0.5);
    crunch(t, 0.92 * Math.pow(2, (m - 60) / 30), 0.32, pan);
    tone(f * 2, t + 0.002, { dur: 0.06, attack: 0.001, gain: 0.035, type: 'sine', pan });
    tone(190, t, { dur: 0.03, attack: 0.001, gain: 0.07, to: 120, glide: 0.03 });
    if (c >= 3 && j === 0 && g === 0) sparkle(t + 0.05, Math.min(c, 5), 0.02, 88);
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
    tone(260, t, { dur: 0.18, attack: 0.006, gain: 0.11, to: 1500, glide: 0.16, type: 'sawtooth', lp: 1700, q: 1 });
    tone(390, t + 0.01, { dur: 0.16, attack: 0.006, gain: 0.05, to: 1900, glide: 0.15 });
    tone(110, t, { dur: 0.2, attack: 0.003, gain: 0.12, to: 55, glide: 0.18 });
    noise(t, { dur: 0.26, attack: 0.006, gain: 0.1, type: 'bandpass', f0: 900, f1: 3500, q: 0.9 });
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
    const lv = clamp(Math.round(o.level || 3), 3, 8), base = 64 + (lv - 3) * 2;
    [0, 4, 7, 12].forEach((d, i) => bell(base + d, t + i * 0.045, 0.085, 0.9, sfxBus, -0.3 + i * 0.2));
    marimba(base - 12, t, 0.1, 0.4);
    sparkle(t + 0.15, 4 + lv, 0.03, 96, 0.03);
  },
  // 落地：脆脆的「喀」— 很短的敲擊聲 + 一點點糖果共鳴；音高依位置稍微不同，一串落下來像糖果互相敲到
  land(t, o) {
    const r = o.r || 0, c = o.c || 0, k = o.k || 0;
    const f = 820 + ((r * 37 + c * 53 + k * 29) % 9) * 55;
    noise(t, { dur: 0.012, attack: 0.001, gain: 0.03, type: 'bandpass', f0: 1700, q: 1.4 });
    tone(f, t, { dur: 0.06, attack: 0.002, gain: 0.05, type: 'sine', to: f * 0.9, glide: 0.05 });
    tone(220, t, { dur: 0.04, attack: 0.001, gain: 0.03, to: 150, glide: 0.035 });     // 很輕的底，聽起來有重量
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
// 16 小節、兩段（A：記得住的主旋律；B：往上爬再回來），F 大調、108 BPM：
// 主旋律用溫暖的木琴 + 低八度輕輕墊著，貝斯一彈一跳，反拍和弦，輕輕的鼓（全部收掉刺耳的高頻）
const BPM = 108;
const STEP = 60 / BPM / 2;                      // 八分音符
const C_ = (root, chord) => ({ root, chord });
const CHORDS = [                                // 每小節的和弦（根音、和弦音）
  C_(41, [65, 69, 72]), C_(38, [62, 65, 69]), C_(46, [62, 65, 70]), C_(48, [64, 67, 72]),   // F  Dm Bb C
  C_(41, [65, 69, 72]), C_(38, [62, 65, 69]), C_(46, [62, 65, 70]), C_(48, [64, 67, 72]),
  C_(46, [62, 65, 70]), C_(48, [64, 67, 72]), C_(45, [64, 69, 72]), C_(38, [62, 65, 69]),   // Bb C  Am Dm
  C_(46, [62, 65, 70]), C_(48, [64, 67, 72]), C_(41, [65, 69, 72]), C_(41, [65, 69, 72]),   // Bb C  F  F
];
const _ = null;
const MELODY = [
  72, _, 74, 72, 69, _, 65, _,     67, 69, _, 72, _, 69, 67, _,     65, _, 67, 69, 70, _, 69, _,     67, _, _, _, 72, _, 74, _,
  77, _, 76, 74, 72, _, 69, _,     74, _, 72, 69, 67, _, 69, _,     70, 69, 67, 65, 67, _, 69, _,     72, _, 67, _, 65, _, _, _,
  74, _, 74, 72, 70, _, 72, _,     76, _, 74, 72, 74, _, _, _,      72, _, 72, 69, 76, _, 74, _,     72, _, 69, _, 74, _, _, _,
  77, _, 76, 74, 72, _, 70, _,     72, _, 74, 76, 77, _, 79, _,     77, _, 72, _, 69, _, 72, 74,     72, _, 69, _, 65, _, _, _,
];
const TOTAL = MELODY.length;                    // 128 步 = 16 小節
let musicTimer = null, nextTime = 0, stepIdx = 0;

function musicStep(i, t) {
  const bar = Math.floor(i / 8), s = i % 8;
  const ch = CHORDS[bar % CHORDS.length];
  // 墊底：每小節一個很軟的和弦（慢慢浮起來）
  if (s === 0) {
    const len = STEP * 8;
    ch.chord.forEach((m, k) => tone(mtof(m - 12), t, { type: 'sine', attack: 0.35, dur: len - 0.4, release: 0.6, gain: 0.022, detune: (k - 1) * 4, dest: musicBus, pan: (k - 1) * 0.35 }));
  }
  // 貝斯：第 1、3 拍根音，第 2 拍後半上八度，一彈一跳
  if (s === 0 || s === 4) tone(mtof(ch.root), t, { type: 'triangle', lp: 600, attack: 0.008, dur: STEP * 1.7, gain: 0.16, dest: musicBus });
  if (s === 3 || s === 7) tone(mtof(ch.root + 12), t, { type: 'triangle', lp: 700, attack: 0.008, dur: STEP * 0.8, gain: 0.09, dest: musicBus });
  // 反拍和弦：短短的撥弦
  if (s % 2 === 1) ch.chord.forEach((m, k) => tone(mtof(m), t + k * 0.006, { type: 'triangle', lp: 1300, attack: 0.004, dur: STEP * 0.55, gain: 0.018, dest: musicBus, pan: (k - 1) * 0.3 }));
  // 主旋律：溫暖的木琴 + 低八度輕輕墊著
  const m = MELODY[i];
  if (m != null) {
    marimba(m, t, 0.085, 0.45, musicBus, 0.08);
    tone(mtof(m - 12), t, { type: 'sine', attack: 0.01, dur: 0.3, gain: 0.03, dest: musicBus });
  }
  // 鼓：大鼓 1、3 拍，拍手 2、4 拍，沙鈴八分音符（都很輕）
  if (s === 0 || s === 4) tone(110, t, { type: 'sine', attack: 0.002, dur: 0.14, gain: 0.16, to: 46, glide: 0.11, dest: musicBus });
  if (s === 2 || s === 6) noise(t, { dur: 0.09, attack: 0.002, gain: 0.03, type: 'bandpass', f0: 1400, q: 0.9, dest: musicBus });
  if (s % 2 === 1) noise(t, { dur: 0.035, attack: 0.004, gain: 0.008, type: 'bandpass', f0: 3200, q: 1.2, dest: musicBus, pan: 0.2 });
  // 每 4 小節最後一下：小小的過門
  if (bar % 4 === 3 && s === 6) tone(mtof(ch.root + 24), t, { type: 'triangle', lp: 1500, attack: 0.005, dur: STEP * 0.6, gain: 0.03, dest: musicBus });
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
  get state() { return ctx ? ctx.state : 'none'; },      // 除錯用
  get rebuilds() { return rebuilds; },
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
        for (const bus of [sfxBus, crispBus]) {
          if (!bus) continue;
          bus.gain.cancelScheduledValues(now);
          bus.gain.setValueAtTime(bus.gain.value, now);
          bus.gain.linearRampToValueAtTime(muted ? 0 : SFX_VOL, now + 0.05);
        }
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
