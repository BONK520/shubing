// 薯餅蛋蛋島 — 關卡地圖每一站的背景：每站的底色和物件、兩站交界的銜接物、站牌、駐站娃娃（雲台合照／雲後探頭）
// 畫法照 shubing夜間/草稿/大地圖示意/island-map.html 的 A 樣式（完整風景）搬過來；全部用程式畫 SVG，不用另外載圖
function rngOf(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const pick = (r, a) => a[Math.floor(r() * a.length)];

/* ---------- 物件（原點在物件底部中央，大約50px高） ---------- */
const sh = (rx = 20) => `<ellipse cx="0" cy="0" rx="${rx}" ry="${rx * .26}" fill="#3b1a2a" opacity=".1"/>`;
function star(cx, cy, r1, r2, n = 5) { let d = ''; for (let k = 0; k < n * 2; k++) { const r = k % 2 ? r2 : r1, a = Math.PI * k / n - Math.PI / 2; d += (k ? 'L' : 'M') + (cx + r * Math.cos(a)).toFixed(1) + ' ' + (cy + r * Math.sin(a)).toFixed(1); } return d + 'Z'; }
function gear(cx, cy, r, n = 8) { let d = ''; for (let k = 0; k < n * 4; k++) { const rr = (k % 4 < 2) ? r : r * .78, a = Math.PI * 2 * k / (n * 4); d += (k ? 'L' : 'M') + (cx + rr * Math.cos(a)).toFixed(1) + ' ' + (cy + rr * Math.sin(a)).toFixed(1); } return d + 'Z'; }
const ring = (cx, cy, R, r) => `M${cx - R} ${cy}a${R} ${R} 0 1 0 ${2 * R} 0a${R} ${R} 0 1 0 ${-2 * R} 0ZM${cx - r} ${cy}a${r} ${r} 0 1 1 ${2 * r} 0a${r} ${r} 0 1 1 ${-2 * r} 0Z`;
const PINKS = ['#ff8fb8', '#ffb36b', '#8fc9ff', '#b99bff', '#7fd6a6', '#ffd45c'];

const PR = {
  egg: r => sh(15) + `<ellipse cx="0" cy="-19" rx="14" ry="19" fill="#fffaf0"/><ellipse cx="-5" cy="-26" rx="3.5" ry="6" fill="#fff"/><circle cx="-5" cy="-17" r="1.6" fill="#6b2d4a"/><circle cx="5" cy="-17" r="1.6" fill="#6b2d4a"/><ellipse cx="-8" cy="-12" rx="3" ry="2" fill="#ffb3c9"/><ellipse cx="8" cy="-12" rx="3" ry="2" fill="#ffb3c9"/>`,
  hashbrown: r => sh(22) + `<rect x="-21" y="-20" width="42" height="20" rx="9" fill="#d98f2b"/><rect x="-21" y="-25" width="42" height="21" rx="9" fill="#f6bd4f"/>${[[-12, -17], [-3, -20], [7, -15], [13, -20], [-8, -10], [3, -10]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.6" fill="#c97a1c"/>`).join('')}<rect x="-15" y="-23" width="16" height="3" rx="1.5" fill="#fff1c4" opacity=".8"/>`,
  boat: r => `<path d="M-30-14H30L20 0H-20Z" fill="${pick(r, ['#ff8fb8', '#ffb36b', '#ff9b9b'])}"/><path d="M-27-12H27" stroke="#fff" stroke-width="3" stroke-linecap="round"/><path d="M0-14V-54" stroke="#a5657f" stroke-width="3"/><path d="M3-52L26-18H3Z" fill="#fff"/><path d="M-3-46L-20-18H-3Z" fill="#ffe9f1"/>`,
  wave: r => `<path d="M-26 0q6.5-7 13 0t13 0t13 0t13 0" fill="none" stroke="#fff" stroke-width="3.5" stroke-linecap="round" opacity=".85"/>`,
  palm: r => sh(18) + `<path d="M0 0Q-5-26 6-50" fill="none" stroke="#c48f5e" stroke-width="7" stroke-linecap="round"/><g transform="translate(6 -50)">${[-160, -120, -70, -25, 15].map(a => `<ellipse cx="15" cy="0" rx="17" ry="6.5" fill="#5fbf86" transform="rotate(${a})"/>`).join('')}<circle cx="-3" cy="5" r="4" fill="#a8693c"/><circle cx="4" cy="6" r="4" fill="#a8693c"/></g>`,
  shell: r => `<path d="M-13 0A13 14 0 0 1 13 0Z" fill="#ffc6d8"/><path d="M0 0V-13M-7 0L-5-11M7 0L5-11" stroke="#f290b2" stroke-width="1.8"/>`,
  umbrella: r => sh(16) + `<path d="M0 0V-42" stroke="#a5657f" stroke-width="3"/><path d="M-28-40Q0-66 28-40Z" fill="${pick(r, ['#ff8fb8', '#8fc9ff', '#ffb36b'])}"/><path d="M-9-40Q0-64 9-40Z" fill="#fff"/>`,
  starfish: r => `<path d="${star(0, -10, 12, 5.5)}" fill="#ffa36b" stroke="#ffa36b" stroke-width="3" stroke-linejoin="round"/><circle cx="0" cy="-10" r="1.5" fill="#fff"/>`,
  ball: r => sh(14) + `<circle cx="0" cy="-14" r="14" fill="#fff"/><path d="M0-28A14 14 0 0 1 14-14H0Z" fill="#ff6b8a"/><path d="M0 0A14 14 0 0 1-14-14H0Z" fill="#5bb8ff"/><path d="M-14-14A14 14 0 0 1 0-28V-14Z" fill="#ffd45c"/>`,
  flower: r => { const c = pick(r, ['#ff8fb8', '#ffffff', '#ffd45c', '#b99bff']); return `<path d="M0 0V-18" stroke="#5fb37a" stroke-width="3"/><ellipse cx="5" cy="-8" rx="5" ry="2.5" fill="#6cc48a" transform="rotate(-30 5 -8)"/>${[0, 72, 144, 216, 288].map(a => `<circle cx="${(6 * Math.cos(a * Math.PI / 180)).toFixed(1)}" cy="${(-24 + 6 * Math.sin(a * Math.PI / 180)).toFixed(1)}" r="5" fill="${c}"/>`).join('')}<circle cx="0" cy="-24" r="3.5" fill="#ffb02e"/>`; },
  bush: r => sh(22) + `<circle cx="-11" cy="-11" r="12" fill="#6fc48c"/><circle cx="11" cy="-11" r="12" fill="#6fc48c"/><circle cx="0" cy="-19" r="14" fill="#86d39c"/><circle cx="-5" cy="-24" r="4" fill="#b2e8c0"/>`,
  house: r => { const c = pick(r, PINKS); return sh(26) + `<rect x="-20" y="-34" width="40" height="34" rx="6" fill="#fff4e6"/><path d="M-26-30L0-54L26-30Z" fill="${c}" stroke="${c}" stroke-width="6" stroke-linejoin="round"/><rect x="-6" y="-17" width="12" height="17" rx="6" fill="#c98f6b"/><circle cx="11" cy="-24" r="4.5" fill="#bfe6ff"/>`; },
  doghouse: r => sh(22) + `<rect x="-18" y="-28" width="36" height="28" rx="4" fill="#ffd3a8"/><path d="M-23-25L0-46L23-25Z" fill="#ff8f8f" stroke="#ff8f8f" stroke-width="5" stroke-linejoin="round"/><path d="M-8 0V-10A8 8 0 0 1 8-10V0Z" fill="#8a5a44"/><path d="M-8-35h16" stroke="#fff" stroke-width="3" stroke-linecap="round"/>`,
  paw: r => `<g fill="#6b2d4a" opacity=".16"><ellipse cx="0" cy="-7" rx="8" ry="6.5"/><circle cx="-9" cy="-16" r="3.5"/><circle cx="-3" cy="-20" r="3.5"/><circle cx="3" cy="-20" r="3.5"/><circle cx="9" cy="-16" r="3.5"/></g>`,
  fence: r => `<g fill="#fffaf2" stroke="#e8cdb8" stroke-width="1.5">${[-18, -6, 6, 18].map(x => `<path d="M${x - 4} 0V-20L${x}-25L${x + 4}-20V0Z"/>`).join('')}<rect x="-24" y="-16" width="48" height="5" rx="2"/></g>`,
  fruittree: r => sh(22) + `<rect x="-4" y="-28" width="8" height="28" rx="3" fill="#b98257"/><circle cx="0" cy="-44" r="21" fill="#68c085"/><circle cx="-8" cy="-51" r="8" fill="#8ad6a0"/>${[[-10, -38], [8, -48], [10, -34], [-2, -56], [-14, -50]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3.6" fill="${pick(r, ['#ff6b8a', '#ffb02e'])}"/>`).join('')}`,
  basket: r => sh(18) + `<circle cx="-7" cy="-16" r="6" fill="#ff6b8a"/><circle cx="5" cy="-17" r="6" fill="#ffb02e"/><circle cx="-1" cy="-21" r="6" fill="#9bd36b"/><path d="M-16-14H16L12 0H-12Z" fill="#d49a63"/><path d="M-14-8H14" stroke="#b77a45" stroke-width="2"/>`,
  tower: r => { const c = pick(r, ['#ff8fb8', '#8fc9ff', '#b99bff']); return sh(22) + `<rect x="-16" y="-58" width="32" height="58" rx="3" fill="#f6ead6"/><path d="M-16-58h32" stroke="#e6d3b4" stroke-width="2"/>${[-14, -2, 10].map(x => `<rect x="${x}" y="-64" width="6" height="7" fill="#f6ead6"/>`).join('')}<path d="M-19-63L0-90L19-63Z" fill="${c}"/><path d="M0-90V-102" stroke="#a5657f" stroke-width="2"/><path d="M0-102L12-98L0-94Z" fill="#ffd45c"/><path d="M-6 0V-12A6 6 0 0 1 6-12V0Z" fill="#c98f6b"/><path d="M-4-34V-42A4 4 0 0 1 4-42V-34Z" fill="#8a5a8a"/>`; },
  cupcake: r => sh(16) + `<path d="M-15-18L15-18L11 0H-11Z" fill="${pick(r, ['#ff9fc6', '#8fc9ff', '#b99bff'])}"/><path d="M-6-18L-4 0M6-18L4 0" stroke="#fff" stroke-width="2" opacity=".6"/><circle cx="-9" cy="-22" r="8" fill="#fff4f8"/><circle cx="9" cy="-22" r="8" fill="#fff4f8"/><circle cx="0" cy="-28" r="10" fill="#fff4f8"/><circle cx="1" cy="-40" r="4.5" fill="#ff4f7b"/>`,
  donut: r => sh(18) + `<path d="${ring(0, -16, 18, 6)}" fill="#e3a160" fill-rule="evenodd"/><path d="${ring(0, -18, 15, 7)}" fill="${pick(r, ['#ff9fc6', '#c4a3ff', '#8fd6ff'])}" fill-rule="evenodd"/>${[[-9, -24, 20], [8, -26, -30], [10, -13, 60], [-10, -12, 10], [0, -30, 80]].map(([x, y, a]) => `<rect x="${x}" y="${y}" width="5" height="1.8" rx=".9" fill="${pick(r, ['#fff', '#ffd45c', '#5bb8ff'])}" transform="rotate(${a} ${x} ${y})"/>`).join('')}`,
  cookie: r => `<ellipse cx="0" cy="-7" rx="17" ry="9" fill="#d99a55"/><ellipse cx="0" cy="-9" rx="17" ry="9" fill="#efb96f"/>${[[-8, -10], [5, -6], [6, -13], [-2, -12], [-10, -6]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2" fill="#7a4a2b"/>`).join('')}`,
  sprinkle: r => `<rect x="-4" y="-1" width="8" height="3" rx="1.5" fill="${pick(r, ['#ff8fb8', '#5bb8ff', '#ffd45c', '#7fd6a6'])}" transform="rotate(${Math.floor(r() * 180)})"/>`,
  cloud: r => `<use href="#ma-cloud" x="-32" y="-30" width="64" height="34"/>`,   // 遊戲裡那朵立體雲（定義在 CLOUD_DEFS）
  balloon: r => `<path d="M0-26Q-4-12 2 0" stroke="#c49ab0" stroke-width="1.4" fill="none"/><ellipse cx="0" cy="-40" rx="12" ry="15" fill="${pick(r, PINKS)}"/><ellipse cx="-4" cy="-45" rx="3" ry="5" fill="#fff" opacity=".6"/><path d="M-3-25h6l-3 3z" fill="#c49ab0"/>`,
  bird: r => `<path d="M-10-4Q-5-10 0-4Q5-10 10-4" stroke="#8a6a9a" stroke-width="2.2" fill="none" stroke-linecap="round"/>`,
  tulip: r => { const c = pick(r, ['#ff6b8a', '#ffb02e', '#b99bff', '#ff8fb8']); return `<path d="M0 0V-20" stroke="#5fb37a" stroke-width="3"/><ellipse cx="-5" cy="-8" rx="6" ry="2.5" fill="#6cc48a" transform="rotate(30 -5 -8)"/><path d="M-8-30Q-9-18 0-18Q9-18 8-30L4-25L0-31L-4-25Z" fill="${c}"/>`; },
  butterfly: r => { const c = pick(r, ['#ffb3d4', '#b9a3ff', '#ffd45c']); return `<g transform="translate(0 -30)"><ellipse cx="-7" cy="-4" rx="7" ry="9" fill="${c}"/><ellipse cx="7" cy="-4" rx="7" ry="9" fill="${c}"/><ellipse cx="-5" cy="6" rx="5" ry="5" fill="${c}" opacity=".8"/><ellipse cx="5" cy="6" rx="5" ry="5" fill="${c}" opacity=".8"/><rect x="-1.5" y="-8" width="3" height="16" rx="1.5" fill="#6b2d4a"/></g>`; },
  block: r => { const c = pick(r, PINKS); return sh(14) + `<rect x="-13" y="-26" width="26" height="26" rx="5" fill="${c}"/><rect x="-9" y="-22" width="18" height="18" rx="3" fill="#fff" opacity=".35"/><circle cx="0" cy="-13" r="4" fill="#fff"/>`; },
  rug: r => `<ellipse cx="0" cy="-6" rx="30" ry="10" fill="#ffd0e2"/><ellipse cx="0" cy="-6" rx="22" ry="6.5" fill="none" stroke="#fff" stroke-width="2" stroke-dasharray="4 4"/>`,
  rock: r => sh(18) + `<path d="M-18 0Q-20-16-6-20Q8-24 16-12Q20-4 16 0Z" fill="#c8bfb6"/><path d="M-8-16Q0-20 6-17" stroke="#e7e1da" stroke-width="3" fill="none" stroke-linecap="round"/>`,
  signpost: r => sh(12) + `<path d="M0 0V-40" stroke="#a87650" stroke-width="5" stroke-linecap="round"/><path d="M-18-38H12L18-32L12-26H-18Z" fill="#e6b47f"/><path d="M18-22H-12L-18-16L-12-10H18Z" fill="#dba06a"/>`,
  tent: r => { const c = pick(r, ['#ff9b6b', '#8fc9ff', '#7fd6a6']); return sh(24) + `<path d="M-24 0L0-38L24 0Z" fill="${c}"/><path d="M-6 0L0-20L6 0Z" fill="#6b2d4a" opacity=".5"/><path d="M0-38V-46" stroke="#a5657f" stroke-width="2"/>`; },
  pine: r => sh(16) + `<rect x="-3" y="-10" width="6" height="10" fill="#9a6b48"/><path d="M-18-10L0-34L18-10Z" fill="#4fae7f"/><path d="M-14-24L0-46L14-24Z" fill="#5cbc8b"/><path d="M-10-38L0-56L10-38Z" fill="#6ccb98"/>`,
  snowpine: r => sh(16) + `<rect x="-3" y="-10" width="6" height="10" fill="#9a6b48"/><path d="M-18-10L0-34L18-10Z" fill="#5aa88a"/><path d="M-14-24L0-46L14-24Z" fill="#66b596"/><path d="M-10-38L0-56L10-38Z" fill="#74c2a2"/><path d="M-6-45L0-56L6-45Q0-42-6-45ZM-9-31L0-46L9-31Q0-28-9-31ZM-13-17L0-34L13-17Q0-14-13-17Z" fill="#fff"/>`,
  snowegg: r => sh(16) + `<circle cx="0" cy="-12" r="13" fill="#fff"/><ellipse cx="0" cy="-34" rx="10" ry="12" fill="#fff"/><path d="M-10-24Q0-20 10-24" stroke="${pick(r, ['#ff6b8a', '#5bb8ff'])}" stroke-width="5" stroke-linecap="round" fill="none"/><circle cx="-3.5" cy="-36" r="1.5" fill="#6b2d4a"/><circle cx="3.5" cy="-36" r="1.5" fill="#6b2d4a"/><path d="M-1-32l5 1-5 1z" fill="#ff9b4b"/>`,
  flake: r => `<g stroke="#fff" stroke-width="2" stroke-linecap="round" opacity=".9"><path d="M0-14V-2M-6-11L6-5M-6-5L6-11"/></g>`,
  ferris: r => `<path d="M-20 0L0-40L20 0" stroke="#c28fb0" stroke-width="4" fill="none"/><circle cx="0" cy="-40" r="30" fill="none" stroke="#ff8fb8" stroke-width="3.5"/>${[0, 45, 90, 135].map(a => `<path d="M${(-30 * Math.cos(a * Math.PI / 180)).toFixed(1)} ${(-40 - 30 * Math.sin(a * Math.PI / 180)).toFixed(1)}L${(30 * Math.cos(a * Math.PI / 180)).toFixed(1)} ${(-40 + 30 * Math.sin(a * Math.PI / 180)).toFixed(1)}" stroke="#ffc2dc" stroke-width="1.6"/>`).join('')}${[0, 45, 90, 135, 180, 225, 270, 315].map((a, k) => `<circle cx="${(30 * Math.cos(a * Math.PI / 180)).toFixed(1)}" cy="${(-40 + 30 * Math.sin(a * Math.PI / 180)).toFixed(1)}" r="5" fill="${PINKS[k % 6]}"/>`).join('')}<circle cx="0" cy="-40" r="4" fill="#fff"/>`,
  carousel: r => sh(26) + `<rect x="-24" y="-8" width="48" height="8" rx="3" fill="#ffd45c"/>${[-16, 0, 16].map(x => `<path d="M${x} -8V-34" stroke="#f0c040" stroke-width="2.5"/>`).join('')}<path d="M-28-34L0-56L28-34Z" fill="#ff8fb8"/><path d="M-9-34L0-56L9-34Z" fill="#fff"/><path d="M0-56V-62" stroke="#a5657f" stroke-width="2"/><circle cx="0" cy="-63" r="3" fill="#ffd45c"/>`,
  bigtree: r => sh(26) + `<rect x="-5" y="-30" width="10" height="30" rx="3" fill="#8f6143"/><circle cx="-12" cy="-40" r="16" fill="#3f9b6c"/><circle cx="12" cy="-42" r="16" fill="#3f9b6c"/><circle cx="0" cy="-56" r="18" fill="#4fae7c"/><circle cx="-6" cy="-62" r="6" fill="#7cc99d"/>`,
  mushroom: r => sh(14) + `<rect x="-5" y="-14" width="10" height="14" rx="4" fill="#fff3e3"/><path d="M-16-12Q-16-30 0-30Q16-30 16-12Z" fill="${pick(r, ['#ff6b6b', '#ff8fb8', '#ffb02e'])}"/><circle cx="-7" cy="-20" r="2.5" fill="#fff"/><circle cx="5" cy="-24" r="3" fill="#fff"/><circle cx="8" cy="-15" r="2" fill="#fff"/>`,
  note: r => { const c = pick(r, ['#a46bd6', '#ff6fa8', '#5f9cf0']); return `<path d="M0-8V-40L16-45V-13" stroke="${c}" stroke-width="3.5" fill="none" stroke-linejoin="round"/><ellipse cx="-4" cy="-8" rx="6" ry="4.5" fill="${c}"/><ellipse cx="12" cy="-13" rx="6" ry="4.5" fill="${c}"/>`; },
  speaker: r => sh(14) + `<rect x="-13" y="-36" width="26" height="36" rx="5" fill="#5a4a6e"/><circle cx="0" cy="-11" r="7" fill="#2f2640"/><circle cx="0" cy="-11" r="3" fill="#8f7fb0"/><circle cx="0" cy="-28" r="4" fill="#2f2640"/>`,
  spot: r => `<path d="M-4-60L4-60L22 0H-22Z" fill="#fff6b0" opacity=".35"/><rect x="-7" y="-66" width="14" height="9" rx="3" fill="#5a4a6e"/>`,
  seaweed: r => `<path d="M-4 0Q-12-14-4-26T-4-52" stroke="#4fbf8f" stroke-width="5" fill="none" stroke-linecap="round"/><path d="M6 0Q0-10 6-20T6-38" stroke="#6fd3a2" stroke-width="4" fill="none" stroke-linecap="round"/>`,
  coral: r => { const c = pick(r, ['#ff8fa3', '#ffb36b', '#c4a3ff']); return `<path d="M0 0V-22M0-14L-10-26V-34M0-20L9-30V-38M-10-26L-16-30" stroke="${c}" stroke-width="5" fill="none" stroke-linecap="round"/>`; },
  fish: r => { const c = pick(r, ['#ffb36b', '#ff8fb8', '#ffd45c', '#8fe0ff']); const f = r() < .5 ? 1 : -1; return `<g transform="translate(0 -20) scale(${f} 1)"><path d="M10 0L20-8V8Z" fill="${c}"/><ellipse cx="0" cy="0" rx="13" ry="9" fill="${c}"/><circle cx="-6" cy="-2" r="2" fill="#2b2b44"/><path d="M-1-6Q3 0-1 6" stroke="#fff" stroke-width="1.5" fill="none" opacity=".6"/></g>`; },
  bubble: r => `<circle cx="0" cy="-8" r="${(5 + r() * 6).toFixed(1)}" fill="#fff" fill-opacity=".18" stroke="#fff" stroke-width="1.8" opacity=".85"/><circle cx="-2" cy="-10" r="1.6" fill="#fff"/>`,
  star: r => `<path d="${star(0, -12, 10, 4.4)}" fill="#ffe27a" stroke="#ffe27a" stroke-width="2" stroke-linejoin="round"/>`,
  planet: r => { const c = pick(r, ['#ffb36b', '#ff8fb8', '#8fc9ff', '#b99bff']); return `<circle cx="0" cy="-22" r="15" fill="${c}"/><path d="M-12-26Q-4-30 4-24" stroke="#fff" stroke-width="3" fill="none" opacity=".35" stroke-linecap="round"/><ellipse cx="0" cy="-22" rx="26" ry="7" fill="none" stroke="#ffe9b0" stroke-width="3" transform="rotate(-18 0 -22)"/>`; },
  moon: r => `<path d="M6-40A18 18 0 1 0 6-4A14 14 0 1 1 6-40Z" fill="#fff1b0"/>`,
  rocket: r => `<g transform="rotate(-20 0 -26)"><path d="M0-56Q12-44 10-16H-10Q-12-44 0-56Z" fill="#fff"/><circle cx="0" cy="-36" r="5" fill="#8fc9ff" stroke="#d6d0e8" stroke-width="2"/><path d="M-10-24L-17-12L-10-14ZM10-24L17-12L10-14Z" fill="#ff6b8a"/><path d="M-6-16Q0-2 6-16Z" fill="#ffb02e"/></g>`,
  building: r => { const h = 50 + Math.floor(r() * 40), c = pick(r, ['#6a5aa0', '#7f6ab3', '#5b6aa8', '#8a6aa6']); let w = ''; for (let yy = -h + 8; yy < -8; yy += 11) for (const xx of [-10, 2]) if (r() < .75) w += `<rect x="${xx}" y="${yy}" width="7" height="6" rx="1" fill="#ffe28a" opacity="${(.6 + r() * .4).toFixed(2)}"/>`; return `<rect x="-17" y="${-h}" width="34" height="${h}" rx="3" fill="${c}"/>${w}`; },
  lamp: r => `<path d="M0 0V-40" stroke="#5a4a6e" stroke-width="3"/><circle cx="0" cy="-42" r="5" fill="#ffe28a"/><circle cx="0" cy="-42" r="12" fill="#ffe28a" opacity=".25"/>`,
  peak: r => `<path d="M-46 0L0-80L46 0Z" fill="#c9b6a3"/><path d="M-16-52L0-80L16-52L8-56L0-50L-8-56Z" fill="#fff"/><path d="M0-80V-98" stroke="#a5657f" stroke-width="2.5"/><path d="M0-98L16-93L0-88Z" fill="#ff4f7b"/>`,
  trophy: r => sh(16) + `<rect x="-12" y="-8" width="24" height="8" rx="2" fill="#d79a2b"/><rect x="-3" y="-18" width="6" height="10" fill="#f0b93a"/><path d="M-14-42H14Q14-18 0-18Q-14-18-14-42Z" fill="#ffd45c"/><path d="M-14-38Q-24-38-20-28Q-18-24-12-26M14-38Q24-38 20-28Q18-24 12-26" stroke="#ffd45c" stroke-width="3" fill="none"/><path d="M-6-38Q-6-26 0-24" stroke="#fff6c4" stroke-width="3" fill="none" stroke-linecap="round"/>`,
  firework: r => { const c = pick(r, ['#ff6b8a', '#ffd45c', '#5bb8ff', '#b99bff']); let s = ''; for (let k = 0; k < 12; k++) { const a = k * Math.PI / 6; s += `<path d="M${(8 * Math.cos(a)).toFixed(1)} ${(-30 + 8 * Math.sin(a)).toFixed(1)}L${(18 * Math.cos(a)).toFixed(1)} ${(-30 + 18 * Math.sin(a)).toFixed(1)}"/>`; } return `<g stroke="${c}" stroke-width="3" stroke-linecap="round">${s}</g><circle cx="0" cy="-30" r="3" fill="${c}"/>`; },
  confetti: r => `<rect x="-3" y="-3" width="6" height="${3 + Math.floor(r() * 4)}" rx="1" fill="${pick(r, PINKS)}" transform="rotate(${Math.floor(r() * 180)})"/>`,
  chimney: r => sh(28) + `<rect x="-26" y="-30" width="52" height="30" rx="4" fill="#c9cde6"/><path d="M-26-30L-13-40V-30L0-40V-30L13-40V-30L26-40V-30Z" fill="#b2b8dc"/><rect x="12" y="-62" width="10" height="32" rx="2" fill="#a2a8cf"/><circle cx="17" cy="-70" r="6" fill="#ffd6e8"/><circle cx="24" cy="-80" r="8" fill="#e8dcff"/><circle cx="18" cy="-93" r="9" fill="#fff"/><rect x="-18" y="-20" width="9" height="9" rx="2" fill="#ffe28a"/><rect x="-4" y="-20" width="9" height="9" rx="2" fill="#ffe28a"/>`,
  gear: r => { const c = pick(r, ['#b8bde0', '#f0c87a', '#d6b0c8']); return `<path d="${gear(0, -18, 17, 8)}" fill="${c}"/><circle cx="0" cy="-18" r="6" fill="#fff" opacity=".7"/>`; },
  box: r => sh(18) + `<rect x="-17" y="-24" width="34" height="24" rx="2" fill="#e5b98a"/><path d="M-17-24L-11-31H11L17-24Z" fill="#f0cba0"/><rect x="-3" y="-24" width="6" height="10" fill="#fff" opacity=".6"/>`,
  clock: r => sh(16) + `<rect x="-11" y="-12" width="22" height="12" rx="2" fill="#b98257"/><circle cx="0" cy="-30" r="17" fill="#fffaf0" stroke="${pick(r, ['#c98f6b', '#ff8fb8', '#8fc9ff'])}" stroke-width="4"/><path d="M0-30V-41M0-30L7-26" stroke="#6b2d4a" stroke-width="2.5" stroke-linecap="round"/><circle cx="0" cy="-30" r="2" fill="#6b2d4a"/>`,
  grandclock: r => sh(14) + `<rect x="-11" y="-66" width="22" height="66" rx="4" fill="#b07a55"/><circle cx="0" cy="-52" r="9" fill="#fffaf0"/><path d="M0-52V-58M0-52L4-49" stroke="#6b2d4a" stroke-width="1.8" stroke-linecap="round"/><path d="M0-40V-16" stroke="#f0c040" stroke-width="2"/><circle cx="0" cy="-14" r="4.5" fill="#f0c040"/><path d="M-13-66Q0-76 13-66Z" fill="#9a6644"/>`,
  crystal: r => { const c = pick(r, ['#ff9fd0', '#b99bff', '#8fe0ff', '#ffd45c']); return `<path d="M-14 0L-10-22L-4-30L2-22L0 0Z" fill="${c}"/><path d="M0 0L4-34L10-44L16-34L14 0Z" fill="${c}" opacity=".85"/><path d="M6-30L10-40" stroke="#fff" stroke-width="2.5" stroke-linecap="round" opacity=".8"/><path d="M-8-20L-5-26" stroke="#fff" stroke-width="2" stroke-linecap="round" opacity=".7"/>`; },
  cart: r => `<path d="M-26 2H26" stroke="#8a6a5a" stroke-width="3"/><path d="M-20-22H20L15-4H-15Z" fill="#a0786a"/><circle cx="-6" cy="-25" r="5" fill="#ff9fd0"/><circle cx="4" cy="-26" r="5" fill="#8fe0ff"/><circle cx="-10" cy="-2" r="4" fill="#4d3d4d"/><circle cx="10" cy="-2" r="4" fill="#4d3d4d"/>`,
  lantern: r => `<path d="M0 0V-30" stroke="#6a4a3a" stroke-width="3"/><rect x="-7" y="-46" width="14" height="16" rx="4" fill="#ffd45c"/><circle cx="0" cy="-38" r="16" fill="#ffd45c" opacity=".22"/>`,
  chocpot: r => sh(20) + `<path d="M-20-30H20Q20 0 0 0Q-20 0-20-30Z" fill="#8a5a44"/><rect x="-23" y="-34" width="46" height="7" rx="3.5" fill="#a26a4e"/><path d="M-14-34Q-12-46-2-42Q4-54 12-42" stroke="#fff" stroke-width="3" fill="none" opacity=".5" stroke-linecap="round"/><path d="M-6-27V-18" stroke="#5a3424" stroke-width="5" stroke-linecap="round"/>`,
  chocobar: r => sh(18) + `<rect x="-18" y="-22" width="36" height="22" rx="3" fill="#7a4a34"/><path d="M-6-22V0M6-22V0M-18-11H18" stroke="#5e3726" stroke-width="2"/><rect x="-18" y="-22" width="36" height="5" rx="2" fill="#94604a"/>`,
  gift: r => { const c = pick(r, PINKS), d = pick(r, ['#fff', '#ffd45c', '#ff6b8a']); return sh(18) + `<rect x="-16" y="-28" width="32" height="28" rx="3" fill="${c}"/><rect x="-18" y="-32" width="36" height="8" rx="2" fill="${c}"/><rect x="-3" y="-32" width="6" height="32" fill="${d}"/><path d="M0-32Q-14-44-8-34Q-4-30 0-32Q4-30 8-34Q14-44 0-32Z" fill="${d}"/>`; },
  roll: r => sh(22) + `<rect x="-22" y="-16" width="44" height="16" rx="8" fill="${pick(r, ['#ff9fc6', '#8fd6ff', '#c4a3ff'])}"/>${[-12, -2, 8].map(x => `<path d="M${x}-16L${x + 6} 0" stroke="#fff" stroke-width="3" opacity=".7"/>`).join('')}<ellipse cx="22" cy="-8" rx="4" ry="8" fill="#ffe9f1"/>`,
  pipe: r => `<path d="M-18 0V-28Q-18-42 0-42Q18-42 18-28V0" stroke="#ff9fc6" stroke-width="10" fill="none"/><path d="M-18 0V-28Q-18-42 0-42Q18-42 18-28V0" stroke="#fff" stroke-width="3" fill="none" stroke-dasharray="6 7" opacity=".7"/>`,
  belt: r => `<rect x="-32" y="-12" width="64" height="12" rx="6" fill="#9aa2d6"/>${[-24, -12, 0, 12, 24].map(x => `<circle cx="${x}" cy="-6" r="3" fill="#dfe3ff"/>`).join('')}<rect x="-12" y="-28" width="16" height="16" rx="3" fill="${pick(r, PINKS)}"/>`,
  sparkle: r => `<path d="${star(0, -8, 8, 2.4, 4)}" fill="#fff" opacity=".9"/>`,
  // ---- 第 25–44 站（工作單9）----
  train: r => { const c = pick(r, ['#ff8fb8', '#8fc9ff', '#ffb36b']); return sh(30) + `<rect x="-30" y="-14" width="60" height="5" rx="2.5" fill="#b9a7c9"/><rect x="-26" y="-36" width="30" height="24" rx="6" fill="${c}"/><rect x="2" y="-46" width="24" height="34" rx="6" fill="${c}"/><rect x="7" y="-42" width="14" height="11" rx="3" fill="#dff3ff"/><rect x="-22" y="-44" width="9" height="10" rx="3" fill="#6b5a7a"/><circle cx="-18" cy="-52" r="5" fill="#fff" opacity=".9"/><circle cx="-12" cy="-60" r="6.5" fill="#fff" opacity=".8"/><rect x="-28" y="-38" width="56" height="4" rx="2" fill="#fff" opacity=".45"/>${[-17, -3, 15].map(x => `<circle cx="${x}" cy="-9" r="6.5" fill="#5a4a6e"/><circle cx="${x}" cy="-9" r="2.4" fill="#ffd45c"/>`).join('')}`; },
  platsign: r => sh(12) + `<path d="M0 0V-38" stroke="#8a7a9a" stroke-width="4" stroke-linecap="round"/><circle cx="0" cy="-44" r="13" fill="#fff" stroke="${pick(r, ['#ff8fb8', '#8fc9ff', '#7fd6a6'])}" stroke-width="4"/><path d="M-7-44h14" stroke="#6b2d4a" stroke-width="3" stroke-linecap="round"/>`,
  platlamp: r => sh(10) + `<path d="M0 0V-46M0-46H10" stroke="#7a6a8e" stroke-width="3.5" stroke-linecap="round" fill="none"/><path d="M5-46h12l-2 8H7Z" fill="#7a6a8e"/><circle cx="11" cy="-36" r="5" fill="#fff3b0"/><circle cx="11" cy="-34" r="13" fill="#fff3b0" opacity=".25"/>`,
  hotair: r => { const c = pick(r, ['#ff8fb8', '#ffb36b', '#8fc9ff', '#b99bff']), d = pick(r, ['#fff', '#ffd45c']); return `<g transform="translate(0 ${-6 - Math.floor(r() * 14)})"><path d="M-6-14L-8-26M6-14L8-26" stroke="#a5657f" stroke-width="1.5"/><rect x="-7" y="-14" width="14" height="11" rx="3" fill="#c98f5e"/><path d="M-8-26Q-24-44-18-60Q-10-74 0-74Q10-74 18-60Q24-44 8-26Z" fill="${c}"/><path d="M-3-26Q-9-48-5-74M3-26Q9-48 5-74" stroke="${d}" stroke-width="3.5" fill="none" opacity=".85"/><ellipse cx="-10" cy="-58" rx="3.5" ry="7" fill="#fff" opacity=".5"/></g>`; },
  windmill: r => sh(18) + `<path d="M-11 0L-6-44H6L11 0Z" fill="#fff4e6"/><path d="M-4 0V-12A4 4 0 0 1 4-12V0Z" fill="#c98f6b"/><path d="M-9-44L0-54L9-44Z" fill="${pick(r, ['#ff8fb8', '#8fc9ff'])}"/><g transform="translate(0 -44) rotate(${Math.floor(r() * 90)})">${[0, 90, 180, 270].map(a => `<rect x="-3" y="-30" width="6" height="26" rx="2" fill="#f1dcc8" transform="rotate(${a})"/><rect x="2" y="-29" width="8" height="20" rx="2" fill="#fff" transform="rotate(${a})"/>`).join('')}<circle r="3.5" fill="#a5657f"/></g>`,
  grass: r => `<g fill="${pick(r, ['#6fc48c', '#86d39c', '#5fb37a'])}"><path d="M-12 0Q-12-12-16-20Q-6-12-4 0Z"/><path d="M-4 0Q-2-16 0-26Q4-14 4 0Z"/><path d="M4 0Q8-12 15-18Q12-8 12 0Z"/></g>`,
  hive: r => sh(16) + `<path d="M0-48V-56" stroke="#8f6143" stroke-width="3"/>${[[-9, -48, 9], [-14, -38, 14], [-16, -27, 16], [-14, -16, 14], [-9, -6, 9]].map(([x, y, w]) => `<rect x="${x - 1}" y="${y}" width="${w * 2 + 2}" height="11" rx="5.5" fill="#f6c14f"/><path d="M${x + 2} ${y + 10.5}h${w * 2 - 4}" stroke="#d99a2b" stroke-width="1.5"/>`).join('')}<path d="M-5 0V-6A5 5 0 0 1 5-6V0Z" fill="#8a5a24"/><g transform="translate(16 -46)"><ellipse rx="5" ry="4" fill="#ffd45c"/><path d="M-1-3.5V3.5M2-3V3" stroke="#6b4a2a" stroke-width="1.5"/><ellipse cx="-1" cy="-5" rx="3" ry="2" fill="#fff" opacity=".8"/></g>`,
  honeypot: r => sh(15) + `<path d="M-14-24Q-18-4-10 0H10Q18-4 14-24Z" fill="#e3a14a"/><rect x="-15" y="-30" width="30" height="8" rx="3" fill="#c98738"/><path d="M-12-30Q-12-38-4-36Q0-42 6-36Q12-38 12-30Z" fill="#ffcf5a"/><path d="M-8-26Q-8-18-5-14" stroke="#ffcf5a" stroke-width="4" stroke-linecap="round" fill="none"/><rect x="-8" y="-16" width="16" height="9" rx="2" fill="#fff4dc"/>`,
  pumpkin: r => { const c = pick(r, ['#ff9b45', '#ffb04f', '#f78a3a']); return sh(20) + `<ellipse cx="-9" cy="-14" rx="10" ry="14" fill="${c}"/><ellipse cx="9" cy="-14" rx="10" ry="14" fill="${c}"/><ellipse cx="0" cy="-14" rx="10" ry="15" fill="#ffc06a"/><path d="M0-28Q1-36 6-38" stroke="#5f9a4f" stroke-width="4" stroke-linecap="round" fill="none"/><path d="M2-30Q10-34 13-28Q8-26 2-30Z" fill="#7fc46a"/><ellipse cx="-4" cy="-20" rx="2.5" ry="5" fill="#fff" opacity=".35"/>`; },
  scarecrow: r => sh(14) + `<path d="M0 0V-44M-22-34H22" stroke="#a87650" stroke-width="4" stroke-linecap="round"/><path d="M-12-36H12L9-14H-9Z" fill="${pick(r, ['#8fc9ff', '#ff8fb8', '#7fd6a6'])}"/><path d="M-12-30H12" stroke="#fff" stroke-width="2" opacity=".6"/><circle cx="0" cy="-46" r="9" fill="#fff1c4"/><circle cx="-3" cy="-46" r="1.4" fill="#6b2d4a"/><circle cx="3" cy="-46" r="1.4" fill="#6b2d4a"/><path d="M-15-51H15L8-55Q0-66-8-55Z" fill="#e6b45c"/><path d="M-26-36l4 4M26-36l-4 4" stroke="#f0d07a" stroke-width="3" stroke-linecap="round"/>`,
  onsen: r => `<ellipse cx="0" cy="-6" rx="30" ry="11" fill="#bfa58e"/><ellipse cx="0" cy="-8" rx="25" ry="8" fill="#9fdbe0"/><ellipse cx="-8" cy="-10" rx="8" ry="2.5" fill="#fff" opacity=".6"/>${[-18, 12, 24].map((x, i) => `<circle cx="${x}" cy="${-4 + (i % 2) * 3}" r="5" fill="#d2c0ae"/>`).join('')}<path d="M-10-18q-5-7 0-13t0-12M2-18q-5-7 0-13t0-12M14-18q-5-7 0-13" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round" opacity=".75"/>`,
  steam: r => `<g fill="#fff" opacity=".7"><circle cx="-6" cy="-10" r="7"/><circle cx="4" cy="-20" r="9"/><circle cx="-3" cy="-32" r="7"/><circle cx="6" cy="-40" r="5"/></g>`,
  bucket: r => sh(14) + `<path d="M-13-22H13L10 0H-10Z" fill="#d6a874"/><path d="M-12-15H12M-11-6H11" stroke="#a87650" stroke-width="2.5"/><ellipse cx="0" cy="-22" rx="13" ry="3.5" fill="#bfe6ea"/><rect x="-16" y="-25" width="6" height="3" rx="1.5" fill="#a87650"/><rect x="10" y="-25" width="6" height="3" rx="1.5" fill="#a87650"/><path d="M-6-25Q-8-32-4-34" stroke="#fff" stroke-width="2.5" fill="none" opacity=".7"/>`,
  bamboo: r => { const h = 50 + Math.floor(r() * 16); let s = ''; for (const [x, hh] of [[-7, h], [6, h - 12]]) { s += `<rect x="${x - 4}" y="${-hh}" width="8" height="${hh}" rx="3" fill="#7cc77e"/>`; for (let y = -12; y > -hh + 4; y -= 13) s += `<rect x="${x - 4.5}" y="${y}" width="9" height="2.6" rx="1.3" fill="#5aa860"/>`; s += `<ellipse cx="${x + 9}" cy="${-hh + 10}" rx="8" ry="3" fill="#8fd68a" transform="rotate(-25 ${x + 9} ${-hh + 10})"/>`; } return sh(14) + s; },
  bambasket: r => sh(16) + `<path d="M-16-18H16L12 0H-12Z" fill="#d9b874"/><path d="M-15-12H15M-14-6H14M-6-18L-5 0M2-18V0M9-18L8 0" stroke="#b8954f" stroke-width="1.6"/><path d="M-12-18Q0-36 12-18" stroke="#b8954f" stroke-width="3" fill="none"/><circle cx="-5" cy="-21" r="4.5" fill="#ff8f8f"/><circle cx="4" cy="-22" r="4.5" fill="#ffd45c"/>`,
  stonelamp: r => sh(14) + `<rect x="-10" y="-8" width="20" height="8" rx="2" fill="#bdb6ad"/><rect x="-4" y="-20" width="8" height="12" fill="#cfc8bf"/><rect x="-11" y="-34" width="22" height="14" rx="2" fill="#cfc8bf"/><rect x="-6" y="-31" width="12" height="8" rx="1.5" fill="#ffe28a"/><path d="M-16-34L0-46L16-34Z" fill="#b3aca3" stroke="#b3aca3" stroke-width="3" stroke-linejoin="round"/><circle cx="0" cy="-48" r="3" fill="#b3aca3"/>`,
  paperlantern: r => { const c = pick(r, ['#ff6b6b', '#ff8fb8', '#ffb36b']); return `<path d="M0-50V-38" stroke="#6a4a3a" stroke-width="2"/><rect x="-6" y="-40" width="12" height="4" rx="1.5" fill="#d6a63a"/><ellipse cx="0" cy="-26" rx="13" ry="11" fill="${c}"/><path d="M-6-36Q-9-26-6-16M6-36Q9-26 6-16M0-37V-15" stroke="#fff" stroke-width="1.2" fill="none" opacity=".45"/><rect x="-6" y="-17" width="12" height="4" rx="1.5" fill="#d6a63a"/><path d="M0-13V-5" stroke="#ffd45c" stroke-width="2.5" stroke-linecap="round"/><circle cx="0" cy="-26" r="22" fill="#ffd45c" opacity=".16"/>`; },
  stall: r => { const c = pick(r, ['#ff6b8a', '#ffb36b', '#8fc9ff']); return sh(26) + `<rect x="-24" y="-24" width="48" height="24" rx="3" fill="#c98f5e"/><rect x="-24" y="-24" width="48" height="5" fill="#e3b07a"/><path d="M-22-24V-48M22-24V-48" stroke="#8a5a44" stroke-width="3"/><path d="M-28-56H28L24-44H-24Z" fill="#fff"/>${[-20, -8, 4, 16].map(x => `<path d="M${x - 4} -56h8l-1 12h-6Z" fill="${c}"/>`).join('')}${[-14, -2, 10].map((x, i) => `<circle cx="${x}" cy="-28" r="4" fill="${['#ffd45c', '#ff8fb8', '#9fe0a0'][i]}"/>`).join('')}<circle cx="0" cy="-36" r="16" fill="#ffe28a" opacity=".14"/>`; },
  flags: r => `<path d="M-26-44Q0-30 26-44" stroke="#c49ab0" stroke-width="1.4" fill="none"/>${[-20, -10, 0, 10, 20].map(x => { const y = -44 + 14 * (1 - (x / 26) ** 2) * .9; return `<path d="M${x - 5} ${y.toFixed(1)}L${x + 5} ${y.toFixed(1)}L${x} ${(y + 11).toFixed(1)}Z" fill="${pick(r, PINKS)}"/>`; }).join('')}<path d="M-26-44V0M26-44V0" stroke="#a87650" stroke-width="3" stroke-linecap="round"/>`,
  tank: r => sh(24) + `<rect x="-24" y="-38" width="48" height="38" rx="6" fill="#d6f2fb" stroke="#fff" stroke-width="3"/><rect x="-21" y="-28" width="42" height="25" rx="3" fill="#8fd6ef"/><path d="M-21-28q5-3 10.5 0t10.5 0t10.5 0t10.5 0" stroke="#fff" stroke-width="2" fill="none" opacity=".7"/><g transform="translate(-6 -14) scale(.5)"><path d="M10 0L20-8V8Z" fill="#ffb36b"/><ellipse rx="13" ry="9" fill="#ffb36b"/><circle cx="-6" cy="-2" r="2" fill="#2b2b44"/></g><path d="M12-5Q8-12 12-18" stroke="#4fbf8f" stroke-width="3" fill="none" stroke-linecap="round"/><circle cx="8" cy="-22" r="2" fill="#fff" opacity=".8"/>`,
  fern: r => { const c = pick(r, ['#5fb37a', '#6cc48a', '#4fae7c']); let s = ''; for (const a of [-50, -20, 10, 40]) { let leaf = `<path d="M0 0Q4-24 0-46" stroke="${c}" stroke-width="3" fill="none"/>`; for (let k = 1; k < 7; k++) leaf += `<ellipse cx="${k % 2 ? 6 : -6}" cy="${-k * 6.5}" rx="7" ry="2.6" fill="${c}" transform="rotate(${k % 2 ? -30 : 30} ${k % 2 ? 6 : -6} ${-k * 6.5})"/>`; s += `<g transform="rotate(${a})">${leaf}</g>`; } return sh(18) + s; },
  footprint: r => `<g fill="#6b4a3a" opacity=".16" transform="rotate(${Math.floor(r() * 60) - 30} 0 -10)"><ellipse cx="0" cy="-8" rx="10" ry="8"/><ellipse cx="-9" cy="-22" rx="3.5" ry="6" transform="rotate(-25 -9 -22)"/><ellipse cx="0" cy="-25" rx="3.5" ry="6.5"/><ellipse cx="9" cy="-22" rx="3.5" ry="6" transform="rotate(25 9 -22)"/></g>`,
  dinoegg: r => sh(14) + `<path d="M-12-10Q-14 0-6 0H6Q14 0 12-10" fill="#c8a983"/><ellipse cx="0" cy="-18" rx="11" ry="15" fill="#fff6e4"/>${[[-4, -24, 3], [5, -16, 2.5], [-3, -12, 2], [4, -27, 2]].map(([x, y, rr]) => `<circle cx="${x}" cy="${y}" r="${rr}" fill="${pick(r, ['#7fd6a6', '#8fc9ff', '#ffb36b'])}"/>`).join('')}<path d="M-11-10l4-3 3 3 4-3 3 3 4-3 4 3" stroke="#e6d5b8" stroke-width="2" fill="none"/>`,
  puddle: r => `<ellipse cx="0" cy="-4" rx="24" ry="7" fill="#a9d4ef" opacity=".8"/><ellipse cx="-6" cy="-5" rx="9" ry="2" fill="#fff" opacity=".6"/><ellipse cx="8" cy="-3" rx="5" ry="1.6" fill="none" stroke="#fff" stroke-width="1.2" opacity=".7"/>`,
  rainarc: r => ['#ff9fb8', '#ffc98a', '#fff09a', '#a8e6b4', '#9fd2ff'].map((c, i) => `<path d="M${-28 + i * 5} 0A${28 - i * 5} ${28 - i * 5} 0 0 1 ${28 - i * 5} 0" stroke="${c}" stroke-width="5" fill="none"/>`).join('') + `<use href="#ma-cloud" x="-42" y="-14" width="30" height="16"/><use href="#ma-cloud" x="13" y="-14" width="30" height="16"/>`,
  shelf: r => { let s = sh(22) + `<rect x="-22" y="-56" width="44" height="56" rx="3" fill="#b07a55"/>`; for (const y of [-52, -34, -16]) { s += `<rect x="-19" y="${y}" width="38" height="15" fill="#8a5a44"/>`; let x = -18; while (x < 15) { const w = 4 + Math.floor(r() * 4), hh = 10 + Math.floor(r() * 5); s += `<rect x="${x}" y="${y + 15 - hh}" width="${w}" height="${hh}" rx="1" fill="${pick(r, PINKS)}"/>`; x += w + 1; } } return s; },
  bookstack: r => { let s = sh(16), y = 0; for (let k = 0; k < 4; k++) { const w = 26 + Math.floor(r() * 8), h = 6 + Math.floor(r() * 3), dx = Math.floor(r() * 6) - 3; s += `<rect x="${-w / 2 + dx}" y="${y - h}" width="${w}" height="${h}" rx="2" fill="${pick(r, PINKS)}"/><rect x="${w / 2 + dx - 3}" y="${y - h + 1.5}" width="2" height="${h - 3}" fill="#fff" opacity=".7"/>`; y -= h; } return s; },
  desklamp: r => sh(12) + `<ellipse cx="0" cy="-3" rx="11" ry="3.5" fill="#8a7a9a"/><path d="M0-3L-6-26L8-38" stroke="#8a7a9a" stroke-width="3.5" fill="none" stroke-linecap="round"/><path d="M2-44L18-34L10-28Z" fill="${pick(r, ['#ff8fb8', '#7fd6a6', '#ffd45c'])}"/><path d="M14-30L4 0" stroke="#ffe28a" stroke-width="16" opacity=".18"/>`,
  bread: r => sh(18) + `<path d="M-20 0Q-24-20 0-22Q24-20 20 0Z" fill="#d9954a"/><path d="M-18-2Q-20-18 0-19Q20-18 18-2Z" fill="#efb96f"/>${[-9, 0, 9].map(x => `<path d="M${x - 4}-8L${x + 3}-17" stroke="#fff1d0" stroke-width="3" stroke-linecap="round"/>`).join('')}`,
  ovenprop: r => sh(24) + `<path d="M-24 0V-26Q-24-48 0-48Q24-48 24-26V0Z" fill="#e8b89a"/><path d="M-24-26Q-24-48 0-48Q24-48 24-26" stroke="#c98f6b" stroke-width="3" fill="none"/><path d="M-12 0V-16Q-12-28 0-28Q12-28 12-16V0Z" fill="#5a3424"/><path d="M-8 0Q-6-10 0-12Q6-10 8 0Z" fill="#ffb02e"/><path d="M-3 0Q-2-6 0-7Q2-6 3 0Z" fill="#ffe28a"/><rect x="10" y="-62" width="9" height="16" rx="2" fill="#c98f6b"/>`,
  flourbag: r => sh(14) + `<path d="M-13 0Q-16-20-10-28H10Q16-20 13 0Z" fill="#fffaf0" stroke="#e6d8c4" stroke-width="2"/><path d="M-10-28L-6-34H6L10-28" fill="#fffaf0" stroke="#e6d8c4" stroke-width="2"/><path d="M-6-34Q0-30 6-34" stroke="#c98f6b" stroke-width="2" fill="none"/><path d="${star(0, -14, 6, 2.6)}" fill="#ffd45c"/>`,
  easel: r => sh(16) + `<path d="M-14 0L-2-50M14 0L2-50M0-12V0" stroke="#b07a55" stroke-width="3.5" stroke-linecap="round"/><rect x="-17" y="-46" width="34" height="28" rx="2" fill="#fff" stroke="#e6d3b4" stroke-width="2"/><circle cx="-6" cy="-34" r="5" fill="${pick(r, ['#ff8fb8', '#ffd45c'])}"/><path d="M-12-24Q-2-34 6-26T14-30" stroke="${pick(r, ['#8fc9ff', '#7fd6a6'])}" stroke-width="3" fill="none" stroke-linecap="round"/><rect x="-17" y="-20" width="34" height="3" rx="1.5" fill="#b07a55"/>`,
  palette: r => `<path d="M-20-8Q-22-24 0-24Q22-24 20-10Q18-2 8-6Q2-8 0-2Q-4 4-14 0Q-20-2-20-8Z" fill="#f3d7b0"/>${[['#ff6b8a', -12, -16], ['#ffd45c', -2, -19], ['#5bb8ff', 9, -17], ['#7fd6a6', 13, -10]].map(([c, x, y]) => `<circle cx="${x}" cy="${y}" r="3.6" fill="${c}"/>`).join('')}<ellipse cx="-8" cy="-6" rx="3.5" ry="2.5" fill="#fff" opacity=".7"/>`,
  crayon: r => { const c = pick(r, ['#ff6b8a', '#5bb8ff', '#ffd45c', '#7fd6a6', '#b99bff']); return `<g transform="rotate(${Math.floor(r() * 40) - 70} 0 -4)"><rect x="-14" y="-8" width="24" height="8" rx="2" fill="${c}"/><path d="M10-8L18-4L10 0Z" fill="${c}"/><rect x="-8" y="-8" width="10" height="8" fill="#fff" opacity=".55"/></g>`; },
  icecream: r => sh(14) + `<path d="M-14-16H14L10 0H-10Z" fill="${pick(r, ['#ff8fb8', '#8fc9ff', '#ffd45c'])}"/><path d="M-12-10H12" stroke="#fff" stroke-width="2" opacity=".6"/><circle cx="-6" cy="-21" r="9" fill="#fff4f8"/><circle cx="7" cy="-22" r="9" fill="${pick(r, ['#ffc6dc', '#c9f0d8', '#fff0b0'])}"/><circle cx="0" cy="-31" r="9" fill="${pick(r, ['#b98257', '#ffc6dc', '#d8c8ff'])}"/><circle cx="2" cy="-42" r="3.5" fill="#ff4f7b"/>`,
  cone: r => `<path d="M-11-24L0 0L11-24Z" fill="#e8b46a"/><path d="M-7-20L4-8M-2-24L7-14M5-24L-5-12" stroke="#c98f45" stroke-width="1.4"/><circle cx="0" cy="-30" r="11" fill="${pick(r, ['#ffc6dc', '#c9f0d8', '#fff0b0', '#d8c8ff'])}"/><path d="M-11-26Q-6-20-2-26Q3-20 7-26Q10-22 11-26" fill="${pick(r, ['#ffc6dc', '#c9f0d8', '#fff0b0'])}"/><circle cx="-4" cy="-34" r="2.5" fill="#fff" opacity=".7"/>`,
  awning: r => { const c = pick(r, ['#ff8fb8', '#8fc9ff', '#7fd6a6']); return sh(24) + `<rect x="-22" y="-26" width="44" height="26" rx="3" fill="#fff4e6"/><rect x="-16" y="-20" width="14" height="14" rx="2" fill="#bfe6ff"/><rect x="4" y="-20" width="12" height="20" rx="2" fill="#c98f6b"/>${[-24, -12, 0, 12].map((x, i) => `<path d="M${x} -38h12v8a6 6 0 0 1-12 0Z" fill="${i % 2 ? '#fff' : c}"/>`).join('')}<circle cx="0" cy="-48" r="7" fill="#fff0b0"/><path d="M-4-48L0-40L4-48" fill="#e8b46a"/>`; },
  float: r => { const c = pick(r, ['#ff8fb8', '#b99bff', '#8fc9ff']); return sh(30) + `<rect x="-30" y="-20" width="60" height="16" rx="6" fill="${c}"/><path d="M-30-16H30" stroke="#fff" stroke-width="3" opacity=".5"/>${[-18, 0, 18].map(x => `<circle cx="${x}" cy="-4" r="5" fill="#5a4a6e"/>`).join('')}${[-18, -6, 6, 18].map((x, i) => `<circle cx="${x}" cy="${-27 - (i % 2) * 4}" r="${7 + (i % 2) * 2}" fill="${['#ffd45c', '#fff', '#ff6b8a', '#7fd6a6'][i]}"/>`).join('')}<path d="M0-34V-56" stroke="#a5657f" stroke-width="2"/><path d="M0-56L14-51L0-46Z" fill="#ffd45c"/>`; },
  streamer: r => `<path d="M-16-8Q-8-24 0-12T16-20" stroke="${pick(r, PINKS)}" stroke-width="3.5" fill="none" stroke-linecap="round"/><path d="M-12-30Q-4-40 4-30T18-34" stroke="${pick(r, PINKS)}" stroke-width="3" fill="none" stroke-linecap="round"/>`,
  minibridge: r => sh(30) + `<path d="M-30 0Q0-30 30 0" stroke="#d6a874" stroke-width="10" fill="none"/><path d="M-30-2Q0-32 30-2" stroke="#fff" stroke-width="2" fill="none" opacity=".5"/>${[-20, -10, 0, 10, 20].map(x => { const y = -30 * (1 - (x / 30) ** 2) + 2; return `<path d="M${x} ${y.toFixed(1)}v-12" stroke="#b9875a" stroke-width="2.5" stroke-linecap="round"/>`; }).join('')}<path d="M-20-12Q0-42 20-12" stroke="#b9875a" stroke-width="2" fill="none"/>`,
  telescope: r => sh(16) + `<path d="M-12 0L0-22L12 0M0-22V0" stroke="#8a7a9a" stroke-width="3" stroke-linecap="round" fill="none"/><g transform="rotate(-32 0 -24)"><rect x="-22" y="-31" width="40" height="13" rx="5" fill="${pick(r, ['#ff8fb8', '#8fc9ff', '#ffd45c'])}"/><rect x="16" y="-33" width="9" height="17" rx="3" fill="#fff"/><rect x="-26" y="-28" width="6" height="7" rx="2" fill="#6b5a7a"/></g>`,
  starmap: r => sh(18) + `<path d="M0 0V-14" stroke="#a87650" stroke-width="3"/><rect x="-20" y="-46" width="40" height="32" rx="4" fill="#3c4290" stroke="#ffe9b0" stroke-width="2.5"/><path d="M-12-36L-2-26L8-38L14-24" stroke="#ffe9b0" stroke-width="1.4" fill="none" opacity=".8"/>${[[-12, -36], [-2, -26], [8, -38], [14, -24]].map(([x, y]) => `<path d="${star(x, y, 3.2, 1.3)}" fill="#ffe27a"/>`).join('')}`,
  dome: r => sh(28) + `<rect x="-24" y="-20" width="48" height="20" rx="3" fill="#e8e4f7"/><path d="M-26-20A26 24 0 0 1 26-20Z" fill="#f6f3ff"/><path d="M-4-44L4-44L6-20H-6Z" fill="#6a5aa0"/><path d="M-2-42L14-58" stroke="#8a7a9a" stroke-width="5" stroke-linecap="round"/><rect x="-5" y="-14" width="10" height="14" rx="5" fill="#c9bde6"/><circle cx="-14" cy="-10" r="3" fill="#ffe28a"/><circle cx="14" cy="-10" r="3" fill="#ffe28a"/>`,
  pennant: r => sh(8) + `<path d="M0 0V-52" stroke="#a5657f" stroke-width="3" stroke-linecap="round"/><path d="M1-52Q14-50 24-44Q14-40 1-38Z" fill="${pick(r, ['#ff6b8a', '#ffd45c', '#8fc9ff', '#b99bff'])}"/><circle cx="0" cy="-54" r="3" fill="#ffd45c"/>`,
  crown: r => sh(18) + `<path d="M-18 0V-10L-20-30L-9-18L0-34L9-18L20-30L18-10V0Z" fill="#ffd45c" stroke="#f0b93a" stroke-width="3" stroke-linejoin="round"/><rect x="-18" y="-10" width="36" height="10" rx="2" fill="#f0b93a"/>${[[-20, -30, '#ff6b8a'], [0, -34, '#5bb8ff'], [20, -30, '#7fd6a6']].map(([x, y, c]) => `<circle cx="${x}" cy="${y}" r="3.6" fill="${c}"/>`).join('')}<circle cx="0" cy="-5" r="3" fill="#ff6b8a"/><circle cx="-10" cy="-5" r="2.2" fill="#fff"/><circle cx="10" cy="-5" r="2.2" fill="#fff"/>`,
  citygate: r => sh(32) + `<rect x="-32" y="-46" width="20" height="46" rx="3" fill="#f6ead6"/><rect x="12" y="-46" width="20" height="46" rx="3" fill="#f6ead6"/><path d="M-12-40H12V0H6V-18A6 6 0 0 0-6-18V0H-12Z" fill="#efdcc0"/>${[-32, -24, -18, 12, 18, 26].map(x => `<rect x="${x}" y="-52" width="6" height="7" fill="#f6ead6"/>`).join('')}<path d="M-6 0V-18A6 6 0 0 1 6-18V0Z" fill="#c98f6b"/><path d="M-22-46V-60M22-46V-60" stroke="#a5657f" stroke-width="2"/><path d="M-22-60L-10-56L-22-52ZM22-60L34-56L22-52Z" fill="#ff8fb8"/><circle cx="0" cy="-30" r="5" fill="#ffd45c"/>`,
};

/* ---------- 各站（from～to 是這一站的關卡；關卡還沒做到的站不會畫出來） ---------- */
const R = [
  { name: '蛋蛋碼頭', from: 1, to: 15, stops: [[0, '#8fd3ef'], [.1, '#b8e6f4'], [.13, '#ffecc8'], [.27, '#fdeccb'], [.38, '#d4f1bd'], [1, '#cdeeb4']],
    zones: [[.01, .1, ['wave', 'wave', 'boat']], [.14, .28, ['palm', 'shell', 'egg', 'starfish', 'umbrella']], [.36, .99, ['flower', 'bush', 'egg', 'hashbrown', 'flower', 'house']]], dens: 1.15,
    link: '矮柵欄，路從柵欄門穿過去', bridge: 'fence' },
  { name: '毛毛村', from: 16, to: 20, stops: [[0, '#cdeeb4'], [1, '#e1f3c2']], props: ['house', 'doghouse', 'paw', 'fence', 'flower', 'egg'], link: '一排圓圓的樹叢', bridge: 'hedge' },
  { name: '果樹林', from: 21, to: 25, stops: [[0, '#e1f3c2'], [1, '#bfe4a6']], props: ['fruittree', 'fruittree', 'basket', 'bush', 'flower'], link: '城牆和城門', bridge: 'wall' },
  { name: '薯餅城堡', from: 26, to: 30, stops: [[0, '#bfe4a6'], [.25, '#f1e6cf'], [1, '#f3e7cf']], props: ['tower', 'hashbrown', 'hashbrown', 'egg', 'flower'], link: '出了城門是沙丘', bridge: 'dune' },
  { name: '海邊', from: 31, to: 35, stops: [[0, '#f3e7cf'], [1, '#fff1d6']], props: ['shell', 'umbrella', 'starfish', 'ball', 'palm'], extra: 'sea', link: '沙灘慢慢變成糖霜，上面滴下奶油', bridge: 'drip' },
  { name: '甜點', from: 36, to: 40, stops: [[0, '#ffd3e3'], [.35, '#ffe2ec'], [1, '#ffdbe8']], props: ['cupcake', 'donut', 'cookie', 'sprinkle', 'sprinkle'], link: '棉花糖雲往上堆，走進天空', bridge: 'clouds' },
  { name: '天空', from: 41, to: 45, drift: 4, stops: [[0, '#ffdbe8'], [.35, '#e6e4ff'], [1, '#d6ebff']], props: ['cloud', 'cloud', 'balloon', 'bird'], link: '彩虹從雲上落到花圃', bridge: 'rainbow' },
  { name: '花園', from: 46, to: 50, stops: [[0, '#d6ebff'], [.25, '#dcf3d0'], [1, '#ece4ff']], props: ['tulip', 'flower', 'butterfly', 'bush', 'tulip'], link: '積木排成矮牆，進到玩具屋', bridge: 'blocks' },
  { name: '玩具屋', from: 51, to: 55, stops: [[0, '#ece4ff'], [.2, '#f8e4cc'], [1, '#f6dec4']], props: ['block', 'ball', 'rug', 'block', 'balloon'], extra: 'planks', link: '玩具屋的木門打開，外面是山路', bridge: 'door' },
  { name: '大冒險', from: 56, to: 60, stops: [[0, '#f6dec4'], [.3, '#e3e9c8'], [.75, '#dce6dc'], [1, '#e4eef7']], props: ['rock', 'signpost', 'tent', 'pine', 'rock'], link: '山脊積雪，進入雪地', bridge: 'mountains' },
  { name: '雪地', from: 61, to: 65, stops: [[0, '#e4eef7'], [1, '#f7fbff']], props: ['snowpine', 'snowegg', 'flake', 'snowpine', 'flake'], link: '雪地盡頭掛滿彩旗，是遊樂園入口', bridge: 'bunting' },
  { name: '遊樂園', from: 66, to: 70, stops: [[0, '#f7fbff'], [.25, '#ffeef5'], [.7, '#ffe4ef'], [1, '#d6edc6']], props: ['ferris', 'carousel', 'balloon', 'balloon'], link: '遊樂園後面是一排大樹', bridge: 'treeline' },
  { name: '森林', from: 71, to: 75, stops: [[0, '#d6edc6'], [1, '#bfe0ae']], props: ['bigtree', 'mushroom', 'bigtree', 'mushroom', 'bush'], link: '林間空地掛起燈泡，變成舞台', bridge: 'lights' },
  { name: '音樂會', from: 76, to: 80, stops: [[0, '#bfe0ae'], [.3, '#efe6f5'], [.75, '#e6d9fb'], [1, '#bfe8f7']], props: ['note', 'note', 'speaker', 'spot'], link: '舞台搭在海邊，往下跳進海裡', bridge: 'wave' },
  { name: '海底', from: 81, to: 85, stops: [[0, '#bfe8f7'], [.55, '#86cbe9'], [1, '#5a98d2']], props: ['seaweed', 'coral', 'fish', 'fish', 'bubble'], extra: 'rays', link: '泡泡往上飄，漸漸變成星星', bridge: 'bubbles' },
  { name: '宇宙', from: 86, to: 90, stops: [[0, '#5a98d2'], [.3, '#40478f'], [1, '#2e2f6d']], props: ['planet', 'star', 'moon', 'rocket', 'star'], extra: 'stars', link: '夜空下面出現城市的剪影', bridge: 'skyline' },
  { name: '城市', from: 91, to: 95, stops: [[0, '#2e2f6d'], [.45, '#8b6fae'], [1, '#ffd8c4']], props: ['building', 'building', 'lamp', 'building'], link: '天亮了，城市後面是最後一座山', bridge: 'hills' },
  { name: '終極冒險', from: 96, to: 100, stops: [[0, '#ffd8c4'], [1, '#fff0b6']], props: ['peak', 'firework', 'trophy', 'firework', 'rock'], link: '山頂放煙火，彩色紙片飄到工廠', bridge: 'confetti' },
  { name: '玩具工廠', from: 101, to: 105, stops: [[0, '#fff0b6'], [.3, '#f0ecdf'], [1, '#e5e8f5']], props: ['chimney', 'box', 'gear', 'block', 'belt'], link: '工廠的齒輪一路接到鐘錶店', bridge: 'gears' },
  { name: '鐘錶店', from: 106, to: 110, stops: [[0, '#e5e8f5'], [.3, '#f2e5d6'], [1, '#efdfcb']], props: ['clock', 'grandclock', 'gear', 'clock'], extra: 'planks', link: '鐘錶店地下室通往礦坑洞口', bridge: 'cave' },
  { name: '糖果礦坑', from: 111, to: 115, stops: [[0, '#8f7393'], [1, '#6c557a']], props: ['crystal', 'crystal', 'cart', 'lantern', 'crystal'], extra: 'sparks', link: '礦坑深處流出巧克力', bridge: 'chocdrip' },
  { name: '巧克力工坊', from: 116, to: 120, stops: [[0, '#93644f'], [.45, '#c99677'], [.8, '#ecd0ba'], [1, '#ffe3ee']], props: ['chocpot', 'chocobar', 'chocpot', 'cookie'], extra: 'river', link: '巧克力外面綁上緞帶，進到包裝室', bridge: 'ribbon' },
  { name: '禮物包裝室', from: 121, to: 125, stops: [[0, '#ffe3ee'], [1, '#fff1f6']], props: ['gift', 'gift', 'roll', 'gift'], link: '緞帶上的星星飄向夢幻工廠', bridge: 'starband' },
  { name: '夢幻工廠', from: 126, to: 130, stops: [[0, '#fff1f6'], [.4, '#efe7ff'], [1, '#e2f1ff']], props: ['pipe', 'belt', 'sparkle', 'cloud', 'gear'], extra: 'sparkles', drift: 3, link: '夢幻工廠的輸送帶接上星光車站的鐵軌', bridge: 'rails' },
  // ---- 第 25–44 站（工作單9） ----
  { name: '星光車站', from: 131, to: 135, stops: [[0, '#e2f1ff'], [.4, '#e8e4f7'], [1, '#f3e9f0']], props: ['train', 'platsign', 'platlamp', 'platsign'], link: '鐵軌旁邊是一片小山坡', bridge: 'hills' },
  { name: '熱氣球草原', from: 136, to: 140, stops: [[0, '#f3e9f0'], [.3, '#e0f2cc'], [1, '#d3eebb']], props: ['hotair', 'windmill', 'grass', 'hotair', 'flower'], link: '熱氣球降落在蜂巢旁邊', bridge: 'honeycomb' },
  { name: '蜂蜜森林', from: 141, to: 145, stops: [[0, '#d3eebb'], [.4, '#f6e3a6'], [1, '#f3dba0']], props: ['hive', 'honeypot', 'bigtree', 'flower'], link: '森林外面圍著木柵欄，裡面種滿南瓜', bridge: 'fence' },
  { name: '南瓜田', from: 146, to: 150, stops: [[0, '#f3dba0'], [.5, '#f6d6aa'], [1, '#f2dcc0']], props: ['pumpkin', 'scarecrow', 'pumpkin', 'fence'], link: '田邊冒出白白的熱氣，是溫泉', bridge: 'steam' },
  { name: '溫泉山谷', from: 151, to: 155, stops: [[0, '#f2dcc0'], [.4, '#d9ecea'], [1, '#cfe8e3']], props: ['onsen', 'steam', 'bucket', 'rock'], link: '溫泉後面長出一整排竹子', bridge: 'bamboo' },
  { name: '竹林', from: 156, to: 160, stops: [[0, '#cfe8e3'], [.4, '#c8e6bf'], [1, '#b9dca8']], props: ['bamboo', 'bambasket', 'stonelamp', 'bamboo'], link: '竹林外天黑了，燈籠一盞盞亮起', bridge: 'lanterns' },
  { name: '燈籠夜市', from: 161, to: 165, stops: [[0, '#b9dca8'], [.28, '#5e4f80'], [1, '#43386a']], props: ['paperlantern', 'stall', 'flags', 'paperlantern'], extra: 'stars', link: '夜市走到底是海邊的碼頭', bridge: 'wave' },
  { name: '水族館', from: 166, to: 170, stops: [[0, '#43386a'], [.3, '#5f9fd0'], [.6, '#7cc4e6'], [1, '#a8dcee']], props: ['tank', 'fish', 'seaweed', 'bubble', 'coral'], extra: 'rays', link: '水族館外面長滿大蕨葉', bridge: 'ferns' },
  { name: '恐龍谷', from: 171, to: 175, stops: [[0, '#a8dcee'], [.3, '#c8e2b0'], [1, '#e6dcb8']], props: ['fern', 'footprint', 'dinoegg', 'rock'], link: '恐龍谷上空飄來雨雲', bridge: 'raincloud' },
  { name: '雨天小鎮', from: 176, to: 180, stops: [[0, '#e6dcb8'], [.3, '#d5dfea'], [1, '#e9eaf2']], props: ['umbrella', 'puddle', 'house', 'rainarc'], extra: 'rain', link: '躲雨躲進了圖書館', bridge: 'books' },
  { name: '圖書館', from: 181, to: 185, stops: [[0, '#e9eaf2'], [.3, '#efe2cf'], [1, '#ead8c2']], props: ['shelf', 'bookstack', 'desklamp', 'bookstack'], extra: 'planks', link: '圖書館旁邊是一片麥田', bridge: 'wheat' },
  { name: '麵包店', from: 186, to: 190, stops: [[0, '#ead8c2'], [.4, '#fbe7c8'], [1, '#f8dfc0']], props: ['bread', 'ovenprop', 'flourbag', 'bread'], link: '麵包店樓上是美術教室', bridge: 'crayons' },
  { name: '美術教室', from: 191, to: 195, stops: [[0, '#f8dfc0'], [.4, '#fdf1e4'], [.7, '#f3ecfb'], [1, '#ecf3fb']], props: ['easel', 'palette', 'crayon', 'crayon'], link: '顏料滴下來，變成冰淇淋', bridge: 'drip' },
  { name: '冰淇淋店', from: 196, to: 200, stops: [[0, '#ecf3fb'], [.35, '#ffe3ec'], [.7, '#e6f6f0'], [1, '#fff0d8']], props: ['icecream', 'cone', 'awning', 'cone'], link: '街上掛起彩旗，遊行要開始了', bridge: 'bunting' },
  { name: '遊行大街', from: 201, to: 205, stops: [[0, '#fff0d8'], [.5, '#ffe6ee'], [1, '#f1e2ff']], props: ['float', 'balloon', 'streamer', 'balloon'], link: '遊行的彩色紙片一路飄到月亮島', bridge: 'confetti' },
  { name: '月亮島', from: 206, to: 210, stops: [[0, '#f1e2ff'], [.3, '#4a5596'], [.6, '#33397a'], [1, '#2f3370']], props: ['moon', 'star', 'boat', 'star'], extra: 'stars', link: '天快亮時，月亮旁邊出現彩虹', bridge: 'rainbow' },
  { name: '彩虹橋', from: 211, to: 215, drift: 3, stops: [[0, '#2f3370'], [.3, '#c9c4ef'], [.6, '#fdeef6'], [1, '#e8f4ff']], props: ['rainarc', 'cloud', 'minibridge', 'cloud'], link: '走過彩虹，雲上就是天文台', bridge: 'clouds' },
  { name: '天文台', from: 216, to: 220, stops: [[0, '#e8f4ff'], [.3, '#4a4f92'], [1, '#2a2d66']], props: ['telescope', 'starmap', 'dome', 'star'], extra: 'stars', link: '望遠鏡看到的星星後面是一座城堡', bridge: 'starband' },
  { name: '雲上城堡', from: 221, to: 225, drift: 3, stops: [[0, '#2a2d66'], [.35, '#d9cff5'], [.6, '#f5f0ff'], [1, '#fff4e6']], props: ['tower', 'cloud', 'pennant', 'tower'], link: '城堡的城門打開，就是薯餅王國', bridge: 'wall' },
  { name: '薯餅王國', from: 226, to: 230, stops: [[0, '#fff4e6'], [.5, '#ffefc4'], [1, '#ffe6a8']], props: ['crown', 'citygate', 'firework', 'hashbrown'], extra: 'sparkles', link: '', bridge: null },
];

/* ---------- 站內的固定花樣 ---------- */
function extra(r, W, h, rng) {
  switch (r.extra) {
    case 'sea': return `<defs><linearGradient id="seaf" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a9e0f3" stop-opacity="0"/><stop offset=".2" stop-color="#a9e0f3"/><stop offset=".85" stop-color="#a9e0f3"/><stop offset="1" stop-color="#a9e0f3" stop-opacity="0"/></linearGradient></defs><path d="M${W} 0H${W * .9}${Array.from({ length: 12 }, (_, i) => `Q${W * (i % 2 ? .93 : .87)} ${h * (i + .5) / 12} ${W * .9} ${h * (i + 1) / 12}`).join('')}H${W}Z" fill="url(#seaf)"/>${Array.from({ length: 6 }, (_, i) => `<path d="M${W * .93} ${h * (.2 + i * .12)}q5-5 10 0t10 0" stroke="#fff" stroke-width="2.5" fill="none" stroke-linecap="round" opacity=".8"/>`).join('')}`;
    case 'river': return `<defs><linearGradient id="rivf" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6e3f2c" stop-opacity="0"/><stop offset=".25" stop-color="#7a4632"/><stop offset=".9" stop-color="#7a4632"/><stop offset="1" stop-color="#7a4632" stop-opacity="0"/></linearGradient></defs><path d="M0 0H${W * .1}${Array.from({ length: 10 }, (_, i) => `Q${W * (i % 2 ? .07 : .14)} ${h * (i + .5) / 10} ${W * .1} ${h * (i + 1) / 10}`).join('')}H0Z" fill="url(#rivf)"/>${Array.from({ length: 5 }, (_, i) => `<path d="M${W * .02} ${h * (.3 + i * .12)}q5-4 10 0" stroke="#b47c62" stroke-width="2.5" fill="none" stroke-linecap="round"/>`).join('')}`;
    case 'stars': { let s = ''; for (let i = 0; i < 70; i++) s += `<circle cx="${(rng() * W).toFixed(1)}" cy="${(rng() * h).toFixed(1)}" r="${(rng() * 1.4 + .5).toFixed(1)}" fill="#fff" opacity="${(Math.min(1, (h - (i * 7 % h)) / h + .2) * (.4 + rng() * .6)).toFixed(2)}"/>`; return s; }
    case 'sparks': case 'sparkles': { let s = ''; for (let i = 0; i < 26; i++) s += `<path d="${star(rng() * W, rng() * h, 4 + rng() * 3, 1.2, 4)}" fill="#fff" opacity="${(.35 + rng() * .5).toFixed(2)}"/>`; return s; }
    case 'rays': return [.15, .42, .7].map(f => `<path d="M${W * f} 0L${W * (f + .12)} 0L${W * (f + .02)} ${h}L${W * (f - .08)} ${h}Z" fill="#fff" opacity=".1"/>`).join('');
    case 'rain': { let s = ''; for (let i = 0; i < 64; i++) { const x = rng() * W, y = rng() * h; s += `<path d="M${x.toFixed(1)} ${y.toFixed(1)}l-4 11" stroke="#9ec3e6" stroke-width="2" stroke-linecap="round" opacity="${(.35 + rng() * .4).toFixed(2)}"/>`; } return s; }
    case 'planks': { let s = ''; for (let y = 30; y < h; y += 38) s += `<path d="M0 ${y}H${W}" stroke="#d9b58f" stroke-width="1.4" opacity=".45"/>`; return s; }
  }
  return '';
}

/* ---------- 兩站交界的銜接物（畫在180px高的帶子裡，中線就是交界） ---------- */
function bridge(type, W, gx, rng, a, b) {
  const cy = 90, gap = (x, w = 40) => Math.abs(x - gx) < w;
  let s = '';
  switch (type) {
    case 'fence': {
      for (let x = 8; x < W; x += 15) if (!gap(x, 34)) s += `<path d="M${x - 5} ${cy + 18}V${cy - 6}L${x} ${cy - 12}L${x + 5} ${cy - 6}V${cy + 18}Z" fill="#fffaf2" stroke="#e3c7b0" stroke-width="1.5"/>`;
      s += `<path d="M0 ${cy}H${gx - 34}M${gx + 34} ${cy}H${W}M0 ${cy + 10}H${gx - 34}M${gx + 34} ${cy + 10}H${W}" stroke="#f1dcc8" stroke-width="4"/>`;
      s += `<path d="M${gx - 36} ${cy + 20}V${cy - 22}Q${gx} ${cy - 54} ${gx + 36} ${cy - 22}V${cy + 20}" stroke="#fffaf2" stroke-width="7" fill="none" stroke-linecap="round"/>`;
      for (const x of [gx - 30, gx - 18, gx + 18, gx + 30]) s += `<circle cx="${x}" cy="${cy - 30 + Math.abs(x - gx) * .25}" r="4.5" fill="${pick(rng, ['#ff8fb8', '#ffd45c', '#fff'])}"/>`;
      return s;
    }
    case 'hedge': for (let x = -6; x < W + 10; x += 20) if (!gap(x, 36)) s += `<circle cx="${x}" cy="${cy + 6 + Math.sin(x / 30) * 5}" r="${15 + rng() * 6}" fill="${pick(rng, ['#6fc48c', '#7fcf98', '#62b981'])}"/>`; return s;
    case 'wall': case 'door': {
      const c1 = type === 'wall' ? '#e9dcc4' : '#e3b98d', c2 = type === 'wall' ? '#d6c4a6' : '#c9976a';
      s += `<path d="M0 ${cy - 16}H${gx - 34}V${cy + 22}H0Z M${gx + 34} ${cy - 16}H${W}V${cy + 22}H${gx + 34}Z" fill="${c1}"/>`;
      if (type === 'wall') { for (let x = 0; x < W; x += 20) if (!gap(x + 6, 40)) s += `<rect x="${x}" y="${cy - 26}" width="12" height="11" fill="${c1}"/>`; for (let x = 10; x < W; x += 26) if (!gap(x, 44)) s += `<path d="M${x} ${cy - 4}h14M${x + 8} ${cy + 8}h14" stroke="${c2}" stroke-width="2"/>`; }
      else { for (let x = 0; x < W; x += 16) if (!gap(x, 40)) s += `<path d="M${x} ${cy - 16}V${cy + 22}" stroke="${c2}" stroke-width="1.6"/>`; }
      s += `<path d="M${gx - 38} ${cy + 22}V${cy - 20}Q${gx} ${cy - 60} ${gx + 38} ${cy - 20}V${cy + 22}" stroke="${c2}" stroke-width="9" fill="none"/>`;
      if (type === 'door') s += `<path d="M${gx + 38} ${cy + 22}L${gx + 62} ${cy + 30}V${cy - 14}L${gx + 38} ${cy - 20}Z" fill="#d9a878"/><circle cx="${gx + 56}" cy="${cy + 8}" r="3" fill="#ffd45c"/>`;
      else s += `<path d="M${gx - 46} ${cy - 30}V${cy - 52}L${gx - 30} ${cy - 47}L${gx - 46} ${cy - 42}" stroke="#a5657f" stroke-width="2" fill="#ff8fb8"/><path d="M${gx + 46} ${cy - 30}V${cy - 52}L${gx + 62} ${cy - 47}L${gx + 46} ${cy - 42}" stroke="#a5657f" stroke-width="2" fill="#ffd45c"/>`;
      return s;
    }
    case 'dune': for (let k = 0; k < 3; k++) { const o = k * 14; s += `<path d="M0 ${cy + 30 - o}${Array.from({ length: 6 }, (_, i) => `Q${W * (i + .5) / 6} ${cy - 4 - o - rng() * 10} ${W * (i + 1) / 6} ${cy + 26 - o}`).join('')}V${cy + 60}H0Z" fill="${['#f6e8c9', '#fbeccc', '#fff0d2'][k]}" opacity=".9"/>`; } return s;
    case 'drip': {
      s += `<path d="M0 0H${W}V${cy + 6}`;
      for (let x = W; x > 0; x -= 26) { const d = 8 + rng() * 22; s += `Q${x - 6} ${cy + 6} ${x - 7} ${cy + d + 6}A6 6 0 0 1 ${x - 19} ${cy + d + 6}Q${x - 20} ${cy + 6} ${x - 26} ${cy + 6}`; }
      s += `V0Z" fill="#ffd3e3"/>`;
      for (let i = 0; i < 26; i++) s += `<g transform="translate(${(rng() * W).toFixed(1)} ${(cy + 10 + rng() * 70).toFixed(1)})">${PR.sprinkle(rng)}</g>`;
      return s;
    }
    case 'clouds': { // 兩排立體雲，路從中間的空隙穿過去
      for (let row = 0; row < 2; row++) for (let x = -50 + row * 40; x < W + 40; x += 78 + rng() * 14) {
        const w = 96 + rng() * 34; if (gap(x + w / 2, 30 + w / 2)) continue;
        s += `<use href="#ma-cloud" x="${x.toFixed(1)}" y="${(cy - 46 + row * 30 + rng() * 10).toFixed(1)}" width="${w.toFixed(1)}" height="${(w * .525).toFixed(1)}"/>`;
      }
      return s;
    }
    case 'starband': { // 一排淡淡的立體雲，上面飄著星星
      for (let x = -40; x < W + 30; x += 70 + rng() * 12) {
        const w = 82 + rng() * 26; if (gap(x + w / 2, 26 + w / 2)) continue;
        s += `<use href="#ma-cloud" x="${x.toFixed(1)}" y="${(cy - 14 + rng() * 12).toFixed(1)}" width="${w.toFixed(1)}" height="${(w * .525).toFixed(1)}" opacity=".75"/>`;
      }
      for (let i = 0; i < 9; i++) s += `<path d="${star(rng() * W, cy - 30 + rng() * 30, 7, 3)}" fill="#ffd45c"/>`;
      return s;
    }
    case 'rainbow': {
      const cx = W * .22; ['#ff9fb8', '#ffc98a', '#fff09a', '#a8e6b4', '#9fd2ff', '#c8b0ff'].forEach((c, i) => { s += `<path d="M${cx - 130 + i * 9} ${cy + 40}A${130 - i * 9} ${110 - i * 9} 0 0 1 ${cx + 130 - i * 9} ${cy + 40}" stroke="${c}" stroke-width="9" fill="none" opacity=".9"/>`; });
      for (const x of [cx - 128, cx + 128]) s += `<use href="#ma-cloud" x="${(x - 44).toFixed(1)}" y="${cy + 12}" width="92" height="48"/>`;   // 彩虹兩端落在立體雲上
      return s;
    }
    case 'blocks': for (let x = 4; x < W; x += 27) if (!gap(x + 12, 36)) s += `<g transform="translate(${x + 12} ${cy + 18 + (rng() < .3 ? -26 : 0)})">${PR.block(rng)}</g>`; return s;
    case 'mountains': {
      for (let k = 0; k < 2; k++) {
        const peaks = []; let d = `M-60 ${cy + 40}`;
        for (let x = -40 + k * 45; x < W + 90; x += 90) { const pk = cy - 28 - rng() * 34 + k * 22; peaks.push([x + 45, pk]); d += `L${x + 45} ${pk}L${x + 90} ${cy + 12 + k * 14}`; }
        d += `L${W + 60} ${cy + 40}`;
        for (let x = W + 60; x > -60; x -= 40) d += `Q${x - 20} ${cy + 50 + k * 8} ${x - 40} ${cy + 40}`;
        s += `<path d="${d}Z" fill="${k ? '#c7d5d9' : '#b5c5ce'}"/>`;
        for (const [x, y] of peaks) s += `<path d="M${x - 15} ${y + 20}L${x} ${y}L${x + 15} ${y + 20}Q${x + 7} ${y + 15} ${x} ${y + 20}Q${x - 7} ${y + 15} ${x - 15} ${y + 20}Z" fill="#fff"/>`;
      }
      return s;
    }
    case 'bunting': {
      s += `<path d="M0 ${cy + 40}${Array.from({ length: 6 }, (_, i) => `Q${W * (i + .5) / 6} ${cy + 22} ${W * (i + 1) / 6} ${cy + 40}`).join('')}V${cy + 90}H0Z" fill="#fff"/>`;
      for (const row of [0, 1]) { const y0 = cy - 30 + row * 30; s += `<path d="M0 ${y0}Q${W / 2} ${y0 + 26} ${W} ${y0}" stroke="#c49ab0" stroke-width="1.4" fill="none"/>`; for (let x = 10 + row * 12; x < W; x += 24) { const t = x / W, y = y0 + 26 * 4 * t * (1 - t) * .5 * 2 * .5 + (26 * 2 * t * (1 - t)); s += `<path d="M${x - 7} ${y - 1}L${x + 7} ${y - 1}L${x} ${y + 13}Z" fill="${pick(rng, PINKS)}"/>`; } }
      return s;
    }
    case 'treeline': for (let x = -8; x < W + 10; x += 26) if (!gap(x, 32)) s += `<rect x="${x - 3}" y="${cy + 8}" width="6" height="22" fill="#8f6143"/><circle cx="${x}" cy="${cy}" r="${18 + rng() * 8}" fill="${pick(rng, ['#4fae7c', '#3f9b6c', '#5cbc8b'])}"/>`; return s;
    case 'lights': for (const row of [0, 1]) { const y0 = cy - 20 + row * 34; s += `<path d="M0 ${y0}Q${W / 2} ${y0 + 30} ${W} ${y0}" stroke="#6a5a70" stroke-width="1.4" fill="none"/>`; for (let x = 14 + row * 10; x < W; x += 26) { const t = x / W, y = y0 + 30 * 2 * t * (1 - t) + 4; const c = pick(rng, ['#ffe28a', '#ff9fc6', '#9fd2ff']); s += `<circle cx="${x}" cy="${y}" r="8" fill="${c}" opacity=".3"/><circle cx="${x}" cy="${y}" r="4" fill="${c}"/>`; } } return s;
    case 'wave': {
      s += `<path d="M0 ${cy + 8}${Array.from({ length: 12 }, (_, i) => `Q${W * (i + .5) / 12} ${cy - 2} ${W * (i + 1) / 12} ${cy + 8}`).join('')}" stroke="#fff" stroke-width="3" fill="none" opacity=".7"/>`;
      s += `<path d="M0 ${cy - 6}${Array.from({ length: 10 }, (_, i) => `Q${W * (i + .5) / 10} ${cy - 18} ${W * (i + 1) / 10} ${cy - 6}`).join('')}" stroke="#fff" stroke-width="4" fill="none"/>`;
      const px = gx > W / 2 ? 0 : W * .62;
      for (let i = 0; i < 4; i++) s += `<rect x="${px + 10 + i * 30}" y="${cy - 20}" width="7" height="50" rx="3" fill="#b88a64"/>`;
      s += `<rect x="${px}" y="${cy - 26}" width="${W * .38}" height="10" rx="4" fill="#d6a679"/>`;
      return s;
    }
    case 'bubbles': for (let i = 0; i < 26; i++) { const y = cy + 60 - rng() * 150; const isStar = y < cy - 10; s += isStar ? `<path d="${star(rng() * W, y, 4, 1.6)}" fill="#fff" opacity=".8"/>` : `<circle cx="${(rng() * W).toFixed(1)}" cy="${y.toFixed(1)}" r="${(3 + rng() * 7).toFixed(1)}" fill="#fff" fill-opacity=".15" stroke="#fff" stroke-width="1.6" opacity=".8"/>`; } return s;
    case 'skyline': {
      let x = -6; while (x < W) { const w = 22 + rng() * 22, h = 30 + rng() * 50; if (!gap(x + w / 2, 30)) { s += `<rect x="${x}" y="${cy + 60 - h}" width="${w}" height="${h + 30}" fill="#25265c"/>`; for (let yy = cy + 66 - h; yy < cy + 80; yy += 10) for (let xx = x + 4; xx < x + w - 6; xx += 9) if (rng() < .35) s += `<rect x="${xx}" y="${yy}" width="4" height="4" fill="#ffe28a" opacity=".8"/>`; } x += w + 2; }
      s += `<g transform="translate(${W * .8} ${cy - 30})">${PR.rocket(rng)}</g>`;
      return s;
    }
    case 'hills': { for (let k = 0; k < 2; k++) s += `<path d="M0 ${cy + 50 - k * 16}${Array.from({ length: 4 }, (_, i) => `Q${W * (i + .5) / 4} ${cy - 6 - k * 16 - rng() * 14} ${W * (i + 1) / 4} ${cy + 46 - k * 16}`).join('')}V${cy + 90}H0Z" fill="${k ? '#ffe3c8' : '#ffd6bd'}"/>`; s += `<circle cx="${W * .78}" cy="${cy - 40}" r="20" fill="#fff2b0"/><circle cx="${W * .78}" cy="${cy - 40}" r="32" fill="#fff2b0" opacity=".35"/>`; return s; }
    case 'confetti': for (let i = 0; i < 46; i++) s += `<g transform="translate(${(rng() * W).toFixed(1)} ${(cy - 70 + rng() * 140).toFixed(1)})">${PR.confetti(rng)}</g>`; return s;
    case 'gears': for (let x = 6; x < W; x += 40) if (!gap(x, 34)) { const r0 = 14 + rng() * 9; s += `<path d="${gear(x, cy + 6 + (rng() - .5) * 20, r0, 8)}" fill="${pick(rng, ['#c8cde8', '#e3c79a', '#d8c0d0'])}"/><circle cx="${x}" cy="${cy + 6}" r="${r0 * .35}" fill="#fff" opacity=".5"/>`; } return s;
    case 'cave': {
      s += `<path d="M0 ${cy - 4}Q${W * .25} ${cy - 30} ${gx - 44} ${cy - 12}V${cy + 90}H0Z M${gx + 44} ${cy - 12}Q${W * .75} ${cy - 30} ${W} ${cy - 4}V${cy + 90}H${gx + 44}Z" fill="#9b8a98"/>`;
      s += `<path d="M${gx - 44} ${cy + 90}V${cy - 6}Q${gx} ${cy - 56} ${gx + 44} ${cy - 6}V${cy + 90}Z" fill="#4f3e5c"/>`;
      s += `<path d="M${gx - 48} ${cy + 60}V${cy - 14}H${gx + 48}V${cy + 60}" stroke="#a8784e" stroke-width="8" fill="none"/><circle cx="${gx + 32}" cy="${cy + 2}" r="5" fill="#ffd45c"/><circle cx="${gx + 32}" cy="${cy + 2}" r="12" fill="#ffd45c" opacity=".25"/>`;
      return s;
    }
    case 'chocdrip': {
      s += `<path d="M0 0H${W}V${cy + 8}`;
      for (let x = W; x > 0; x -= 30) { const d = 10 + rng() * 26; s += `Q${x - 7} ${cy + 8} ${x - 8} ${cy + 8 + d}A7 7 0 0 1 ${x - 22} ${cy + 8 + d}Q${x - 23} ${cy + 8} ${x - 30} ${cy + 8}`; }
      s += `V0Z" fill="#93644f"/>`;
      return s;
    }
    case 'ribbon': {
      s += `<path d="M0 ${cy + 4}Q${W * .25} ${cy - 22} ${W * .5} ${cy + 4}T${W} ${cy + 4}V${cy + 26}Q${W * .75} ${cy + 52} ${W * .5} ${cy + 26}T0 ${cy + 26}Z" fill="#ff8fb8"/>`;
      s += `<path d="M0 ${cy + 14}Q${W * .25} ${cy - 12} ${W * .5} ${cy + 14}T${W} ${cy + 14}" stroke="#fff" stroke-width="2" stroke-dasharray="6 6" fill="none" opacity=".7"/>`;
      const bx = gx + (gx > W / 2 ? -70 : 70);
      s += `<path d="M${bx} ${cy + 14}Q${bx - 34} ${cy - 16} ${bx - 26} ${cy + 22}Q${bx - 10} ${cy + 26} ${bx} ${cy + 14}Q${bx + 10} ${cy + 26} ${bx + 26} ${cy + 22}Q${bx + 34} ${cy - 16} ${bx} ${cy + 14}Z" fill="#ff6fa3"/><circle cx="${bx}" cy="${cy + 14}" r="6" fill="#ffc2dc"/>`;
      return s;
    }
    // ---- 第 25–44 站的銜接物 ----
    case 'rails': {
      for (let x = 4; x < W; x += 14) if (!gap(x, 30)) s += `<rect x="${x - 3}" y="${cy - 12}" width="6" height="26" rx="2" fill="#c9a27e"/>`;
      for (const y of [cy - 6, cy + 8]) s += `<path d="M0 ${y}H${gx - 30}M${gx + 30} ${y}H${W}" stroke="#9aa2c6" stroke-width="3.5" stroke-linecap="round"/>`;
      const sx = gx + (gx > W / 2 ? -54 : 54);
      s += `<path d="M${sx} ${cy + 30}V${cy - 34}" stroke="#8a7a9a" stroke-width="3"/><g transform="translate(${sx} ${cy - 42})"><path d="M-12-6L12 6M-12 6L12-6" stroke="#fff" stroke-width="7" stroke-linecap="round"/><path d="M-12-6L12 6M-12 6L12-6" stroke="#ff6b8a" stroke-width="3.5" stroke-linecap="round"/></g>`;
      for (let i = 0; i < 8; i++) s += `<path d="${star(rng() * W, cy - 66 + rng() * 26, 3.5, 1.4)}" fill="#fff" opacity=".85"/>`;
      return s;
    }
    case 'honeycomb': {
      const hx = (x, y, q) => `M${x} ${y - q}L${(x + q * .87).toFixed(1)} ${y - q / 2}V${y + q / 2}L${x} ${y + q}L${(x - q * .87).toFixed(1)} ${y + q / 2}V${y - q / 2}Z`;
      for (let row = 0; row < 2; row++) for (let x = row ? 11 : 0; x < W + 14; x += 21) if (!gap(x, 30)) s += `<path d="${hx(x, cy - 6 + row * 18, 12)}" fill="${pick(rng, ['#ffd45c', '#f6c14f', '#ffe08a'])}" stroke="#fff3c4" stroke-width="2"/>`;
      for (let x = 20; x < W; x += 64) if (!gap(x, 36)) s += `<path d="M${x} ${cy + 18}q2 10 0 16" stroke="#f6b93a" stroke-width="5" stroke-linecap="round" fill="none"/>`;
      return s;
    }
    case 'steam': for (let i = 0; i < 24; i++) { const x = rng() * W; if (gap(x, 30)) continue; s += `<circle cx="${x.toFixed(1)}" cy="${(cy - 30 + rng() * 60).toFixed(1)}" r="${(12 + rng() * 14).toFixed(1)}" fill="#fff" opacity="${(.45 + rng() * .3).toFixed(2)}"/>`; } return s;
    case 'bamboo':
      for (let x = 6; x < W; x += 12) if (!gap(x, 32)) { const h = 40 + rng() * 30; s += `<rect x="${x - 4}" y="${(cy + 24 - h).toFixed(1)}" width="8" height="${h.toFixed(1)}" rx="3" fill="${pick(rng, ['#7cc77e', '#8fd68a', '#6cbc72'])}"/><rect x="${x - 4.5}" y="${(cy + 6 - h * .4).toFixed(1)}" width="9" height="2.5" fill="#5aa860"/>`; }
      s += `<path d="M0 ${cy}H${gx - 32}M${gx + 32} ${cy}H${W}" stroke="#c8a96a" stroke-width="3"/>`;
      return s;
    case 'lanterns':
      for (const row of [0, 1]) {
        const y0 = cy - 28 + row * 34; s += `<path d="M0 ${y0}Q${W / 2} ${y0 + 26} ${W} ${y0}" stroke="#6a4a3a" stroke-width="1.4" fill="none"/>`;
        for (let x = 16 + row * 14; x < W; x += 30) { const t = x / W, y = y0 + 26 * 2 * t * (1 - t) + 2, c = pick(rng, ['#ff6b6b', '#ff8fb8', '#ffb36b']); s += `<circle cx="${x}" cy="${(y + 9).toFixed(1)}" r="14" fill="#ffd45c" opacity=".18"/><ellipse cx="${x}" cy="${(y + 10).toFixed(1)}" rx="7" ry="6.5" fill="${c}"/><rect x="${x - 3.5}" y="${(y + 2.5).toFixed(1)}" width="7" height="2" fill="#d6a63a"/><rect x="${x - 3.5}" y="${(y + 15.5).toFixed(1)}" width="7" height="2" fill="#d6a63a"/>`; }
      }
      return s;
    case 'ferns': for (let x = 10; x < W; x += 34) if (!gap(x, 36)) s += `<g transform="translate(${x} ${cy + 26}) scale(${(.7 + rng() * .3).toFixed(2)})">${PR.fern(rng)}</g>`; return s;
    case 'raincloud':
      for (let x = -10; x < W + 20; x += 62) { if (gap(x + 35, 46)) continue; s += `<use href="#ma-cloud" x="${x}" y="${cy - 46}" width="72" height="38"/>`; for (let j = 0; j < 4; j++) s += `<path d="M${x + 16 + j * 13} ${(cy + 2 + rng() * 10).toFixed(1)}l-3 9" stroke="#8fb7e0" stroke-width="2.4" stroke-linecap="round"/>`; }
      return s;
    case 'books': {
      let x = -4; while (x < W) { const w = 9 + rng() * 7, h = 26 + rng() * 22; if (!gap(x + w / 2, 30)) s += `<rect x="${x.toFixed(1)}" y="${(cy + 26 - h).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="1.5" fill="${pick(rng, PINKS)}"/><rect x="${x.toFixed(1)}" y="${(cy + 30 - h * .7).toFixed(1)}" width="${w.toFixed(1)}" height="2.5" fill="#fff" opacity=".6"/>`; x += w + 1.5; }
      s += `<rect x="0" y="${cy + 26}" width="${Math.max(0, gx - 30).toFixed(1)}" height="6" fill="#b07a55"/><rect x="${(gx + 30).toFixed(1)}" y="${cy + 26}" width="${Math.max(0, W - gx - 30).toFixed(1)}" height="6" fill="#b07a55"/>`;
      return s;
    }
    case 'wheat':
      for (let x = 6; x < W; x += 11) if (!gap(x, 32)) { const h = 34 + rng() * 20, b = (rng() - .5) * 8; s += `<path d="M${x} ${cy + 28}Q${(x + b / 2).toFixed(1)} ${(cy + 28 - h / 2).toFixed(1)} ${(x + b).toFixed(1)} ${(cy + 28 - h).toFixed(1)}" stroke="#d9b45e" stroke-width="2" fill="none"/>`; for (let k = 0; k < 4; k++) s += `<ellipse cx="${(x + b + (k % 2 ? 3 : -3)).toFixed(1)}" cy="${(cy + 32 - h + k * 5).toFixed(1)}" rx="2.6" ry="4.5" fill="#f0c96a"/>`; }
      return s;
    case 'crayons':
      for (let x = 8; x < W; x += 20) if (!gap(x, 32)) { const c = pick(rng, ['#ff6b8a', '#5bb8ff', '#ffd45c', '#7fd6a6', '#b99bff', '#ffb36b']), h = 36 + rng() * 20, y = cy + 28 - h; s += `<rect x="${x - 7}" y="${y.toFixed(1)}" width="14" height="${h.toFixed(1)}" rx="2" fill="${c}"/><path d="M${x - 7} ${y.toFixed(1)}L${x} ${(y - 12).toFixed(1)}L${x + 7} ${y.toFixed(1)}Z" fill="${c}"/><rect x="${x - 7}" y="${(y + 8).toFixed(1)}" width="14" height="${(h * .4).toFixed(1)}" fill="#fff" opacity=".5"/>`; }
      return s;
  }
  return s;
}

/* ---------- 放進遊戲的部分 ---------- */
// 座標跟 main.js 的 MAP_GAP / MAP_BOTTOM 一樣（第 i 關在 H - 110 - i × 116，i 從 0 起算）
const GAP = 116, BOT = 110;
// 立體雲（跟 style.css 的 --cloud 同一朵：上白下淡紫、底部柔和陰影），地圖上的雲都用這個 <use href="#ma-cloud">
function cloudDefs(p) {
  return '<linearGradient id="' + p + 'cg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff"/><stop offset=".5" stop-color="#f8f5ff"/><stop offset="1" stop-color="#cbbfff"/></linearGradient>'
  + '<clipPath id="' + p + 'cc"><circle cx="42" cy="54" r="24"/><circle cx="72" cy="38" r="30"/><circle cx="106" cy="42" r="26"/><circle cx="130" cy="56" r="20"/><rect x="20" y="50" width="128" height="28" rx="14"/></clipPath>'
  + '<filter id="' + p + 'cb" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="5"/></filter>'
  + '<filter id="' + p + 'cs" x="-20%" y="-30%" width="150%" height="170%"><feDropShadow dx="0" dy="0" stdDeviation="2.5" flood-color="#fff" flood-opacity=".75"/><feDropShadow dx="4" dy="7" stdDeviation="3.5" flood-color="#8f3352" flood-opacity=".2"/></filter>'
  + '<symbol id="' + p + 'cloud" viewBox="0 0 160 84" overflow="visible"><g filter="url(#' + p + 'cs)"><g clip-path="url(#' + p + 'cc)"><rect width="160" height="84" fill="url(#' + p + 'cg)"/>'
  + '<ellipse cx="86" cy="88" rx="78" ry="22" fill="#8b76ef" opacity=".5" filter="url(#' + p + 'cb)"/><ellipse cx="68" cy="17" rx="22" ry="9" fill="#fff" filter="url(#' + p + 'cb)"/>'
  + '<ellipse cx="108" cy="24" rx="15" ry="7" fill="#fff" opacity=".85" filter="url(#' + p + 'cb)"/><ellipse cx="40" cy="36" rx="12" ry="6" fill="#fff" opacity=".8" filter="url(#' + p + 'cb)"/></g></g></symbol>';
}
const CLOUD_DEFS = '<svg class="ma-defs" width="0" height="0" aria-hidden="true" focusable="false"><defs>' + cloudDefs('ma-') + '</defs></svg>';
const sinX = t => 50 + 27 * Math.sin(t * 1.05 + 0.4);

// 路的橫向位置（%）：跟 main.js 的 smoothPath 是同一條曲線（關卡點之間的三次貝茲）。t 是第幾關，可以有小數
function roadX(t, n) {
  if (!(t > 0 && t < n - 1)) return sinX(t);   // 第 1 關下面、最後一關上面沒有路，照原本的弧線往外延伸
  const P = j => sinX(Math.max(0, Math.min(n - 1, j)));
  const i = Math.floor(t), s = t - i, u = 1 - s;
  const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
  const c1 = p1 + (p2 - p0) / 6, c2 = p2 - (p3 - p1) / 6;
  return u * u * u * p1 + 3 * u * u * s * c1 + 3 * u * s * s * c2 + s * s * s * p2;
}

// 目前有幾關就畫到第幾站；最後一站延伸到地圖最上面，不畫往下一站的銜接物
export function mapStations(n, H) {
  const yOf = i => H - BOT - i * GAP;
  const list = R.filter(r => r.from <= n);
  return list.map((r, k) => {
    const last = k === list.length - 1, to = Math.min(r.to, n);
    return {
      name: r.name, k: k + 1, from: r.from, to, stops: r.stops, zones: r.zones, dens: r.dens, props: r.props, extra: r.extra, drift: r.drift,
      bridge: last ? null : r.bridge,
      bottom: r.from === 1 ? H : yOf(r.from - 1) + GAP / 2,
      top: last ? 0 : yOf(to - 1) - GAP / 2,
    };
  });
}
export function stationAt(st, y) { return st.find(r => y >= r.top && y < r.bottom) || st[0]; }

// 駐站娃娃，兩種擺法輪流出現（第 1 站和最後一站各兩組，其他站一組）：
//   ph＝雲台合照：assets/deco 的合照貼紙站在雲朵台上，慢慢左右晃
//   pk＝雲後探頭：2～3 隻娃娃躲在立體雲後面探頭，前面的雲一高一低
// [寬度 px, 高÷寬]
const PHOTO = { group: [100, 676 / 720], pig: [56, 360 / 292], sloth_bed: [92, 370 / 512], sloth_orange: [80, 512 / 500], sloth_pig: [86, 403 / 512], snoopy_sloth: [64, 512 / 348] };
const SPOTS = [
  [['ph', 'group'], ['pk', 'egg', 'sloth']], [['pk', 'dog', 'piggy']], [['ph', 'pig']], [['ph', 'sloth_orange']],
  [['pk', 'moodeng', 'egg', 'dog']], [['ph', 'snoopy_sloth']], [['pk', 'nyanko', 'snoopy']], [['ph', 'sloth_pig']],
  [['pk', 'piggy', 'dino']], [['ph', 'sloth_bed']], [['pk', 'snoopy', 'dog']], [['ph', 'group']],
  [['pk', 'dino', 'sloth', 'nyanko']], [['ph', 'snoopy_sloth']], [['pk', 'moodeng', 'piggy']], [['pk', 'dino', 'egg']],
  [['ph', 'pig']], [['ph', 'sloth_orange']], [['pk', 'piggy', 'nyanko']], [['ph', 'sloth_pig']],
  [['pk', 'dino', 'dog']], [['ph', 'sloth_bed']], [['pk', 'moodeng', 'snoopy', 'egg']], [['ph', 'group']],
  // 第 25–44 站
  [['pk', 'nyanko', 'egg']], [['ph', 'sloth_orange']], [['pk', 'piggy', 'sloth']], [['ph', 'pig']],
  [['ph', 'sloth_bed']], [['pk', 'moodeng', 'dog']], [['pk', 'snoopy', 'nyanko', 'egg']], [['ph', 'snoopy_sloth']],
  [['pk', 'dino', 'egg', 'piggy']], [['ph', 'sloth_pig']], [['pk', 'sloth', 'nyanko']], [['ph', 'group']],
  [['pk', 'dog', 'moodeng']], [['ph', 'pig']], [['pk', 'snoopy', 'piggy', 'dog']], [['ph', 'sloth_bed']],
  [['pk', 'egg', 'dino']], [['ph', 'snoopy_sloth']], [['pk', 'moodeng', 'sloth']], [['ph', 'group'], ['pk', 'dog', 'egg', 'sloth']]];
// 每組放在那一段路彎得最外面的地方（離中線最遠），擺在路的另一側（23% 或 77%）
// 回傳的 y 是娃娃的底邊；關卡還沒做到的那一段不放
function dollSpots(st, n, H) {
  const out = [];
  st.forEach(r => {
    const list = SPOTS[r.k - 1] || [];
    const t0 = r.from - 1, span = (r.to - r.from + 1) / list.length, tEnd = Math.min(r.to, n) - 1 + .4;
    list.forEach((sp, j) => {
      const a = t0 + span * j + .3, b = Math.min(t0 + span * (j + 1) - .3, tEnd);
      if (a > b) return;
      // 這段路彎得最外面的地方；一段裡有好幾個一樣彎的，挑最靠近這段中間的，娃娃才會平均分開（第1站第一組也會落在剛進遊戲看得到的地方）
      const mid = (a + b) / 2, dx = t => Math.abs(roadX(t, n) - 50);
      let far = 0, best = Math.min(mid, b);
      for (let t = a; t <= b + 1e-9; t += .1) far = Math.max(far, dx(t));
      for (let t = a; t <= b + 1e-9; t += .1) if (dx(t) >= far - 1.5 && (dx(best) < far - 1.5 || Math.abs(t - mid) < Math.abs(best - mid))) best = t;
      const pct = roadX(best, n) > 50 ? 23 : 77;
      let w, h;
      if (sp[0] === 'ph') { w = PHOTO[sp[1]][0]; h = Math.round(w * PHOTO[sp[1]][1]); } else { w = 36 * (sp.length - 1) + 50; h = 76; }
      out.push({ sp, y: Math.round(H - BOT - best * GAP + h / 2), pct, w, h, from: r.from, k: out.length });
    });
  });
  return out;
}
function signSpots(st, n, H) {
  return st.map(r => {
    const i = r.from - 1, left = roadX(i, n) > 50;
    return { r, y: H - BOT - i * GAP - 4, left };
  });
}

// 背景（底色、物件、銜接物）：只跟地圖寬度和關卡數有關，同樣的寬度不用重畫
export function mapArtHTML(W, n, H) {
  const st = mapStations(n, H), spots = dollSpots(st, n, H), signs = signSpots(st, n, H);
  const tOfY = y => (H - BOT - y) / GAP;
  let html = CLOUD_DEFS;
  st.forEach((r, k) => {
    const h = r.bottom - r.top, rng = rngOf(k * 977 + 13);
    const stops = r.stops.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('');
    let art = extra(r, W, h, rng);
    const placed = [];
    const zones = r.zones || [[.03, .97, r.props]];
    const total = Math.round(h / 56 * (r.dens || 1));
    zones.forEach(([f0, f1, list]) => {
      const cnt = Math.max(2, Math.round(total * (f1 - f0)));
      for (let i = 0; i < cnt; i++) {
        for (let tries = 0; tries < 24; tries++) {
          const ly = h - (f0 + (f1 - f0) * (i + rng()) / cnt) * h;
          const y = r.top + ly, x = W * (.05 + rng() * .9);
          if (Math.abs(x - W * roadX(tOfY(y), n) / 100) < W * .17) continue;
          if (placed.some(p => Math.hypot(p[0] - x, p[1] - ly) < 46)) continue;
          if (spots.some(s => Math.abs(W * s.pct / 100 - x) < s.w / 2 + 22 && y > s.y - s.h - 26 && y < s.y + 30)) continue;
          // 站牌（離邊 5%、寬約 96px）和最上面「更多關卡製作中」的立牌前面不放
          if (signs.some(g => Math.abs(g.y - y + 16) < 34 && (g.left ? x < W * .05 + 112 : x > W * .95 - 112))) continue;
          if (y < 150 && Math.abs(x - W / 2) < 130) continue;
          placed.push([x, ly]);
          const kind = pick(rng, list), sc = (.72 + rng() * .34).toFixed(2);
          art += `<g transform="translate(${x.toFixed(1)} ${ly.toFixed(1)}) scale(${sc})">${PR[kind](rng)}</g>`;
          break;
        }
      }
    });
    html += `<svg style="top:${r.top}px;height:${h}px" viewBox="0 0 ${W} ${h}" preserveAspectRatio="none"><defs><linearGradient id="ma-g${k}" x1="0" y1="1" x2="0" y2="0">${stops}</linearGradient></defs><rect width="${W}" height="${h}" fill="url(#ma-g${k})"/>${art}</svg>`;
    if (r.bridge) {
      const by = r.top, gx = W * roadX(tOfY(by), n) / 100;
      html += `<svg class="ma-bridge" style="top:${by - 90}px;height:180px" viewBox="0 0 ${W} 180"><defs><linearGradient id="ma-fg${k}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".14" stop-color="#fff"/><stop offset=".86" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient><mask id="ma-fm${k}" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="180"><rect width="${W}" height="180" fill="url(#ma-fg${k})"/></mask></defs><g mask="url(#ma-fm${k})">${bridge(r.bridge, W, gx, rngOf(k * 31 + 7), r, st[k + 1])}</g></svg>`;
    }
  });
  // 有 drift 的站（天空、夢幻工廠、彩虹橋、雲上城堡）有幾朵立體雲慢慢飄過去（減少動態時停在畫面裡的 --x，不會停在畫面外）
  st.forEach((r, k) => {
    const cnt = r.drift; if (!cnt) return;
    const rng = rngOf(k * 53 + 5), span = W + 280;
    for (let j = 0; j < cnt; j++) {
      const w = 70 + rng() * 50, y = r.top + 40 + (r.bottom - r.top - 120) * (j + rng() * .6) / cnt, d = 46 + rng() * 30, f = rng();
      html += `<div class="ma-drift" style="top:${y.toFixed(0)}px;width:${w.toFixed(0)}px;height:${(w * .525).toFixed(0)}px;--w:${span}px;--x:${(140 + f * (W - w)).toFixed(0)}px;--d:${d.toFixed(0)}s;--k:${(-f * d).toFixed(1)}s"></div>`;
    }
  });
  return html;
}

// 站牌和駐站娃娃：還沒走到的站（第一關還沒解鎖），娃娃是灰色的
export function mapSignsHTML(n, H, unlocked) {
  const st = mapStations(n, H);
  let html = '';
  signSpots(st, n, H).forEach(g => {
    html += `<div class="map-sign" style="top:${g.y}px;${g.left ? 'left:5%' : 'right:5%'}"><b>第${g.r.k}站</b>${g.r.name}</div>`;
  });
  dollSpots(st, n, H).forEach(s => {
    html += spotHTML(s.sp, `left:${s.pct}%;top:${s.y}px;width:${s.w}px;height:${s.h}px;--k:${s.k}`, s.k, s.from > unlocked ? ' lock' : '');
  });
  return html;
}

/* ---------- 駐站娃娃的畫法（地圖、開頭動畫、封面共用） ---------- */
// sp：['ph', 合照] 或 ['pk', 娃娃1, 娃娃2…]；pos 是 style 字串（位置和寬高），k 決定晃動的錯開時間
export function spotSize(sp) {
  if (sp[0] === 'ph') { const w = PHOTO[sp[1]][0]; return [w, Math.round(w * PHOTO[sp[1]][1])]; }
  return [36 * (sp.length - 2) + 50, 76];
}
export function spotHTML(sp, pos, k = 0, lock = '') {
  if (sp[0] === 'ph') return `<div class="map-spot ph${lock}" style="${pos}"><img src="assets/deco/${sp[1]}.webp" alt="" decoding="async" draggable="false"></div>`;
  const ids = sp.slice(1), m = ids.length, w = 36 * (m - 1) + 50;
  const imgs = ids.map((id, j) => `<img src="assets/sprites/${id}_n.png" alt="" decoding="async" draggable="false" style="left:${(w - 36 * m - 14) / 2 + 36 * j}px;--k:${(-j * 1.1 - k * .4).toFixed(1)}s">`).join('');
  const clouds = ids.map((_, j) => `<i style="left:${((w - 36 * (m - 1) - 86) / 2 + 36 * j).toFixed(0)}px;bottom:${j % 2 * 5}px"></i>`).join('');
  return `<div class="map-spot pk${lock}" style="${pos}">${imgs}${clouds}</div>`;
}

// 同一頁放第二份地圖或封面時，SVG 裡的 id 換一個開頭，才不會跟地圖的 #ma-… 撞在一起
export function prefixIds(html, p) {
  return html.replace(/id="ma-/g, `id="${p}`).replace(/url\(#ma-/g, `url(#${p}`).replace(/href="#ma-/g, `href="#${p}`);
}
const fx = v => v.toFixed(1);
function closedCurve(P) {   // 封閉的平滑曲線（Catmull-Rom 換成三次貝茲）
  const n = P.length;
  let d = `M${fx(P[0][0])} ${fx(P[0][1])}`;
  for (let i = 0; i < n; i++) {
    const p0 = P[(i - 1 + n) % n], p1 = P[i], p2 = P[(i + 1) % n], p3 = P[(i + 2) % n];
    d += `C${fx(p1[0] + (p2[0] - p0[0]) / 6)} ${fx(p1[1] + (p2[1] - p0[1]) / 6)} ${fx(p2[0] - (p3[0] - p1[0]) / 6)} ${fx(p2[1] - (p3[1] - p1[1]) / 6)} ${fx(p2[0])} ${fx(p2[1])}`;
  }
  return d + 'Z';
}
function openCurve(P) {
  const n = P.length, Q = j => P[Math.max(0, Math.min(n - 1, j))];
  let d = `M${fx(P[0][0])} ${fx(P[0][1])}`;
  for (let i = 0; i < n - 1; i++) {
    const p0 = Q(i - 1), p1 = P[i], p2 = P[i + 1], p3 = Q(i + 2);
    d += `C${fx(p1[0] + (p2[0] - p0[0]) / 6)} ${fx(p1[1] + (p2[1] - p0[1]) / 6)} ${fx(p2[0] - (p3[0] - p1[0]) / 6)} ${fx(p2[1] - (p3[1] - p1[1]) / 6)} ${fx(p2[0])} ${fx(p2[1])}`;
  }
  return d;
}
const place = (x, y, sc, inner) => `<g transform="translate(${fx(x)} ${fx(y)}) scale(${sc})">${inner}</g>`;

/* ---------- 全島縮圖（開頭動畫第二段、封面 B 的背景） ---------- */
// 各站的顏色由下往上疊成一座小島，中間一條彎彎的路，每站一顆圓點；下面是碼頭和船
// n＝目前有幾關（只畫已經有關卡的站）；沒給就畫全部的站
export function islandMiniHTML(W, H, p = 'oi-', n = 0) {
  // 視窗被藏起來時 innerWidth／innerHeight 可能是 0，島會除以 0 變成 NaN；先用手機直式的大小畫（viewBox 會縮放）
  if (!(W > 0)) W = 390;
  if (!(H > 0)) H = 844;
  const rng = rngOf(2411), cx = W / 2, cy = H * .5;
  const rx = Math.min(W * .42, H * .3), ry = Math.min(H * .4, rx * 2.1);
  const blob = Array.from({ length: 16 }, (_, i) => { const a = i / 16 * Math.PI * 2, k = 1 + (rng() - .5) * .14; return [cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]; });
  const isl = closedCurve(blob);
  const half = y => { const t = (y - cy) / ry; return rx * Math.sqrt(Math.max(0, 1 - t * t)); };
  const RS = n > 0 ? R.filter(r => r.from <= n) : R, NS = RS.length, many = NS > 30;
  const y0 = cy + ry * .86, y1 = cy - ry * .86, band = (y0 - y1) / Math.max(1, NS - 1);
  const road = RS.map((_, k) => { const y = y0 - k * band; return [cx + half(y) * .45 * Math.sin(k * 1.05 + .4), y]; });
  // 第 1 站在小島最下面，從沙灘開始（海水畫在島外面）
  const st1 = [[0, '#ffecc8'], [.35, '#fdeccb'], [.55, '#d4f1bd'], [1, '#cdeeb4']];
  let stops = '';
  RS.forEach((r, k) => (k ? r.stops : st1).forEach(([o, c]) => { stops += `<stop offset="${((k + o) / NS).toFixed(4)}" stop-color="${c}"/>`; }));
  let s = `<defs>${cloudDefs('ma-')}<linearGradient id="ma-ig" gradientUnits="userSpaceOnUse" x1="0" y1="${fx(y0 + band / 2)}" x2="0" y2="${fx(y0 + band / 2 - NS * band)}">${stops}</linearGradient></defs>`;
  s += `<rect width="${W}" height="${H}" fill="#8fd3ef"/>`;
  // 海浪
  for (let i = 0, n = 0; i < 60 && n < 12; i++) {
    const x = W * (.05 + rng() * .9), y = H * (.04 + rng() * .92);
    if (((x - cx) / (rx + 34)) ** 2 + ((y - cy) / (ry + 34)) ** 2 < 1) continue;
    s += place(x, y, (.45 + rng() * .2).toFixed(2), PR.wave(rng)); n++;
  }
  // 島：淺海、浪花、沙邊，再填各站的顏色
  s += `<path d="${isl}" fill="none" stroke="#b8e6f4" stroke-width="34" stroke-linejoin="round"/><path d="${isl}" fill="none" stroke="#fff" stroke-width="16" opacity=".6" stroke-linejoin="round"/>`;
  s += `<path d="${isl}" fill="#fbe3b4" stroke="#fbe3b4" stroke-width="8" stroke-linejoin="round"/><path d="${isl}" fill="url(#ma-ig)"/>`;
  // 碼頭和船（島的最下面）
  const px = road[0][0], py = cy + ry * .95;
  s += `<path d="M${fx(px - 7)} ${fx(py - 10)}h14v${fx(ry * .14 + 10)}h-14Z" fill="#d6a874"/>`;
  for (let j = 0; j < 5; j++) s += `<path d="M${fx(px - 7)} ${fx(py - 4 + j * (ry * .14 / 5))}h14" stroke="#b9875a" stroke-width="1.4"/>`;
  s += place(px + 30, py + ry * .12, .5, PR.boat(rng));
  // 每站兩個小物件，放在路的兩邊（站很多時每站一個，左右輪流）
  RS.forEach((r, k) => {
    const list = (k ? r.props : ['palm', 'umbrella', 'shell', 'starfish']).filter(id => id !== 'spot');
    (many ? [k % 2 ? 1 : -1] : [-1, 1]).forEach(side => {
      const y = road[k][1] + (rng() - .5) * band * .5 + band * .35, hw = half(y);
      const x = cx + side * hw * (.5 + rng() * .28);
      if (Math.abs(x - road[k][0]) < 22 || hw < 30) return;
      s += place(x, y, .42, PR[pick(rng, list)](rng));
    });
  });
  const rd = openCurve(road);
  s += `<path d="${rd}" fill="none" stroke="rgba(87,31,50,.2)" stroke-width="9" stroke-linecap="round" transform="translate(0 2)"/><path d="${rd}" fill="none" stroke="#f1d9c4" stroke-width="8" stroke-linecap="round"/><path d="${rd}" fill="none" stroke="#fffaf3" stroke-width="5.5" stroke-linecap="round"/><path d="${rd}" fill="none" stroke="#ecc6b2" stroke-width="2.4" stroke-dasharray="0 7" stroke-linecap="round"/>`;
  road.forEach(([x, y], k) => { s += `<circle cx="${fx(x)}" cy="${fx(y)}" r="${many ? 3.4 : 4.2}" fill="${PINKS[k % 6]}" stroke="#fff" stroke-width="1.6"/>`; });
  // 四角的立體雲
  [[.1, .12], [.86, .2], [.08, .78], [.9, .86]].forEach(([a, b], j) => {
    const w = 78 + j * 6;
    s += `<use href="#ma-cloud" x="${fx(W * a - w / 2)}" y="${fx(H * b - w * .26)}" width="${w}" height="${fx(w * .525)}"/>`;
  });
  return prefixIds(`<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">${s}</svg>`, p);
}

/* ---------- 封面 A：第 1 站的碼頭風景 ---------- */
// 上面草地、中間沙灘、下面海；o.sandY / o.seaY 是沙灘和海開始的高度，o.avoid 是不放物件的區塊（logo、娃娃、按鈕）[左,上,右,下]
export function coverArtHTML(W, H, o = {}, p = 'cv-') {
  const rng = rngOf(77), sandY = o.sandY ?? H * .55, seaY = o.seaY ?? H * .8, avoid = o.avoid || [];
  const wavy = (y0, amp, n) => { let d = `M0 ${fx(y0)}`; for (let i = 0; i < n; i++) d += `Q${fx(W * (i + .5) / n)} ${fx(y0 + (i % 2 ? amp : -amp))} ${fx(W * (i + 1) / n)} ${fx(y0)}`; return d; };
  const sandTop = wavy(sandY, 9, 4), seaTop = wavy(seaY, 6, 6);
  let s = `<defs>${cloudDefs('ma-')}`
    + `<linearGradient id="ma-cvg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c6eaa9"/><stop offset="1" stop-color="#d7f2c0"/></linearGradient>`
    + `<linearGradient id="ma-cvs" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fdeccb"/><stop offset="1" stop-color="#ffe3b6"/></linearGradient>`
    + `<linearGradient id="ma-cvw" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b8e6f4"/><stop offset="1" stop-color="#7fcbeb"/></linearGradient></defs>`;
  s += `<rect width="${W}" height="${H}" fill="url(#ma-cvg)"/>`;
  s += `<path d="${sandTop}V${H}H0Z" fill="url(#ma-cvs)"/><path d="${sandTop}" fill="none" stroke="#bde5a0" stroke-width="7"/>`;
  s += `<path d="${seaTop}" fill="none" stroke="#f2d3a2" stroke-width="12" transform="translate(0 -5)"/><path d="${seaTop}V${H}H0Z" fill="url(#ma-cvw)"/><path d="${seaTop}" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" opacity=".85"/>`;
  const placed = [];
  const free = (x, y, w, h) => !avoid.some(([l, t, r, b]) => x + w / 2 > l && x - w / 2 < r && y > t && y - h < b) && !placed.some(([px, py]) => Math.hypot(px - x, py - y) < 44);
  const put = (list, y0, y1, cnt, sc0, xs) => {
    let out = '';
    for (let i = 0, n = 0; i < cnt * 30 && n < cnt; i++) {
      const kind = list[n % list.length], sc = sc0 + rng() * .14;
      const x = xs ? W * xs[n % xs.length] + (rng() - .5) * 16 : W * (.05 + rng() * .9), y = y0 + rng() * (y1 - y0);
      if (y1 <= y0 || !free(x, y, 52 * sc, 56 * sc)) continue;
      placed.push([x, y]); n++;
      out += place(x, y, sc.toFixed(2), PR[kind](rng));
    }
    return out;
  };
  // 沙灘：兩邊一定有椰子樹，再撒貝殼、海星、陽傘
  s += put(['palm', 'palm'], sandY + 30, seaY - 8, 2, .9, [.07, .93]);
  s += put(['shell', 'starfish', 'umbrella', 'shell', 'egg', 'starfish'], sandY + 16, seaY - 10, Math.round(W / 70), .8);
  // 草地：一間房子、花、樹叢、蛋、薯餅
  s += put(['house'], 70, sandY - 12, 1, .95, [.14, .86]);
  s += put(['flower', 'bush', 'egg', 'flower', 'hashbrown', 'bush', 'flower', 'house'], 60, sandY - 10, Math.min(14, Math.round(W * sandY / 11000)), .78);
  // 海：會晃的船和浪
  let sea = '';
  // 船先試海面附近，被按鈕擋住就放到畫面最下面
  boat: for (const by of [seaY + Math.min(54, (H - seaY) * .55) + 10, H - 22]) {
    if (by > H - 12) continue;
    for (const bx of [.12, .88, .5]) { const x = W * bx; if (free(x, by, 64, 56)) { sea += `<g transform="translate(${fx(x)} ${fx(by)}) scale(.85)"><g class="cv-boat">${PR.boat(rng)}</g></g>`; placed.push([x, by]); break boat; } }
  }
  for (let i = 0, n = 0; i < 80 && n < Math.round(W / 50); i++) {
    const x = W * (.04 + rng() * .92), y = seaY + 18 + rng() * Math.max(0, H - seaY - 24);
    if (placed.some(([px, py]) => Math.hypot(px - x, py - y) < 40)) continue;
    placed.push([x, y]); n++;
    sea += `<g transform="translate(${fx(x)} ${fx(y)}) scale(${(.7 + rng() * .3).toFixed(2)})"><g class="cv-wv" style="--k:${(-rng() * 3).toFixed(1)}s">${PR.wave(rng)}</g></g>`;
  }
  s += sea;
  return prefixIds(`<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">${s}</svg>`, p);
}
