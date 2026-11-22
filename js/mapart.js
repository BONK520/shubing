// 薯餅蛋蛋島 — 關卡地圖的 24 站背景：每站的底色和物件、兩站交界的銜接物、站牌、駐站娃娃
// 畫法照 shubing夜間/草稿/大地圖示意/island-map.html 的 A 樣式（完整風景）搬過來；全部用程式畫 SVG，不用另外載圖
import { PIECES } from './pieces.js?v=20261123g';

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
  cloud: r => `<g fill="#fff" opacity=".95"><circle cx="-15" cy="-10" r="11"/><circle cx="0" cy="-17" r="15"/><circle cx="16" cy="-11" r="11"/><rect x="-26" y="-12" width="52" height="12" rx="6"/></g>`,
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
};

/* ---------- 24站 ---------- */
const R = [
  { name: '蛋蛋碼頭', from: 1, to: 15, isNew: true, stops: [[0, '#8fd3ef'], [.1, '#b8e6f4'], [.13, '#ffecc8'], [.27, '#fdeccb'], [.38, '#d4f1bd'], [1, '#cdeeb4']],
    zones: [[.01, .1, ['wave', 'wave', 'boat']], [.14, .28, ['palm', 'shell', 'egg', 'starfish', 'umbrella']], [.36, .99, ['flower', 'bush', 'egg', 'hashbrown', 'flower', 'house']]], dens: 1.15,
    link: '矮柵欄，路從柵欄門穿過去', bridge: 'fence' },
  { name: '毛毛村', from: 16, to: 20, isNew: true, stops: [[0, '#cdeeb4'], [1, '#e1f3c2']], props: ['house', 'doghouse', 'paw', 'fence', 'flower', 'egg'], link: '一排圓圓的樹叢', bridge: 'hedge' },
  { name: '果樹林', from: 21, to: 25, isNew: true, stops: [[0, '#e1f3c2'], [1, '#bfe4a6']], props: ['fruittree', 'fruittree', 'basket', 'bush', 'flower'], link: '城牆和城門', bridge: 'wall' },
  { name: '薯餅城堡', from: 26, to: 30, isNew: true, stops: [[0, '#bfe4a6'], [.25, '#f1e6cf'], [1, '#f3e7cf']], props: ['tower', 'hashbrown', 'hashbrown', 'egg', 'flower'], link: '出了城門是沙丘', bridge: 'dune' },
  { name: '海邊', from: 31, to: 35, stops: [[0, '#f3e7cf'], [1, '#fff1d6']], props: ['shell', 'umbrella', 'starfish', 'ball', 'palm'], extra: 'sea', link: '沙灘慢慢變成糖霜，上面滴下奶油', bridge: 'drip' },
  { name: '甜點', from: 36, to: 40, stops: [[0, '#ffd3e3'], [.35, '#ffe2ec'], [1, '#ffdbe8']], props: ['cupcake', 'donut', 'cookie', 'sprinkle', 'sprinkle'], link: '棉花糖雲往上堆，走進天空', bridge: 'clouds' },
  { name: '天空', from: 41, to: 45, stops: [[0, '#ffdbe8'], [.35, '#e6e4ff'], [1, '#d6ebff']], props: ['cloud', 'cloud', 'balloon', 'bird'], link: '彩虹從雲上落到花圃', bridge: 'rainbow' },
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
  { name: '玩具工廠', from: 101, to: 105, isPlan: true, stops: [[0, '#fff0b6'], [.3, '#f0ecdf'], [1, '#e5e8f5']], props: ['chimney', 'box', 'gear', 'block', 'belt'], link: '工廠的齒輪一路接到鐘錶店', bridge: 'gears' },
  { name: '鐘錶店', from: 106, to: 110, isPlan: true, stops: [[0, '#e5e8f5'], [.3, '#f2e5d6'], [1, '#efdfcb']], props: ['clock', 'grandclock', 'gear', 'clock'], extra: 'planks', link: '鐘錶店地下室通往礦坑洞口', bridge: 'cave' },
  { name: '糖果礦坑', from: 111, to: 115, isPlan: true, stops: [[0, '#8f7393'], [1, '#6c557a']], props: ['crystal', 'crystal', 'cart', 'lantern', 'crystal'], extra: 'sparks', link: '礦坑深處流出巧克力', bridge: 'chocdrip' },
  { name: '巧克力工坊', from: 116, to: 120, isPlan: true, stops: [[0, '#93644f'], [.45, '#c99677'], [.8, '#ecd0ba'], [1, '#ffe3ee']], props: ['chocpot', 'chocobar', 'chocpot', 'cookie'], extra: 'river', link: '巧克力外面綁上緞帶，進到包裝室', bridge: 'ribbon' },
  { name: '禮物包裝室', from: 121, to: 125, isPlan: true, stops: [[0, '#ffe3ee'], [1, '#fff1f6']], props: ['gift', 'gift', 'roll', 'gift'], link: '緞帶上的星星飄向夢幻工廠', bridge: 'starband' },
  { name: '夢幻工廠', from: 126, to: 130, isPlan: true, stops: [[0, '#fff1f6'], [.4, '#efe7ff'], [1, '#e2f1ff']], props: ['pipe', 'belt', 'sparkle', 'cloud', 'gear'], extra: 'sparkles', link: '', bridge: null },
];

/* ---------- 站內的固定花樣 ---------- */
function extra(r, W, h, rng) {
  switch (r.extra) {
    case 'sea': return `<defs><linearGradient id="seaf" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a9e0f3" stop-opacity="0"/><stop offset=".2" stop-color="#a9e0f3"/><stop offset=".85" stop-color="#a9e0f3"/><stop offset="1" stop-color="#a9e0f3" stop-opacity="0"/></linearGradient></defs><path d="M${W} 0H${W * .9}${Array.from({ length: 12 }, (_, i) => `Q${W * (i % 2 ? .93 : .87)} ${h * (i + .5) / 12} ${W * .9} ${h * (i + 1) / 12}`).join('')}H${W}Z" fill="url(#seaf)"/>${Array.from({ length: 6 }, (_, i) => `<path d="M${W * .93} ${h * (.2 + i * .12)}q5-5 10 0t10 0" stroke="#fff" stroke-width="2.5" fill="none" stroke-linecap="round" opacity=".8"/>`).join('')}`;
    case 'river': return `<defs><linearGradient id="rivf" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6e3f2c" stop-opacity="0"/><stop offset=".25" stop-color="#7a4632"/><stop offset=".9" stop-color="#7a4632"/><stop offset="1" stop-color="#7a4632" stop-opacity="0"/></linearGradient></defs><path d="M0 0H${W * .1}${Array.from({ length: 10 }, (_, i) => `Q${W * (i % 2 ? .07 : .14)} ${h * (i + .5) / 10} ${W * .1} ${h * (i + 1) / 10}`).join('')}H0Z" fill="url(#rivf)"/>${Array.from({ length: 5 }, (_, i) => `<path d="M${W * .02} ${h * (.3 + i * .12)}q5-4 10 0" stroke="#b47c62" stroke-width="2.5" fill="none" stroke-linecap="round"/>`).join('')}`;
    case 'stars': { let s = ''; for (let i = 0; i < 70; i++) s += `<circle cx="${(rng() * W).toFixed(1)}" cy="${(rng() * h).toFixed(1)}" r="${(rng() * 1.4 + .5).toFixed(1)}" fill="#fff" opacity="${(Math.min(1, (h - (i * 7 % h)) / h + .2) * (.4 + rng() * .6)).toFixed(2)}"/>`; return s; }
    case 'sparks': case 'sparkles': { let s = ''; for (let i = 0; i < 26; i++) s += `<path d="${star(rng() * W, rng() * h, 4 + rng() * 3, 1.2, 4)}" fill="#fff" opacity="${(.35 + rng() * .5).toFixed(2)}"/>`; return s; }
    case 'rays': return [.15, .42, .7].map(f => `<path d="M${W * f} 0L${W * (f + .12)} 0L${W * (f + .02)} ${h}L${W * (f - .08)} ${h}Z" fill="#fff" opacity=".1"/>`).join('');
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
    case 'clouds': case 'starband': {
      for (let x = -10; x < W + 20; x += 34) s += `<circle cx="${x}" cy="${cy + 8 + rng() * 14}" r="${22 + rng() * 10}" fill="#fff" opacity="${type === 'clouds' ? .95 : .7}"/>`;
      if (type === 'starband') for (let i = 0; i < 9; i++) s += `<path d="${star(rng() * W, cy - 30 + rng() * 30, 7, 3)}" fill="#ffd45c"/>`;
      return s;
    }
    case 'rainbow': {
      const cx = W * .22; ['#ff9fb8', '#ffc98a', '#fff09a', '#a8e6b4', '#9fd2ff', '#c8b0ff'].forEach((c, i) => { s += `<path d="M${cx - 130 + i * 9} ${cy + 40}A${130 - i * 9} ${110 - i * 9} 0 0 1 ${cx + 130 - i * 9} ${cy + 40}" stroke="${c}" stroke-width="9" fill="none" opacity=".9"/>`; });
      for (const x of [cx - 128, cx + 128]) s += `<circle cx="${x - 14}" cy="${cy + 44}" r="15" fill="#fff"/><circle cx="${x + 6}" cy="${cy + 38}" r="19" fill="#fff"/><circle cx="${x + 24}" cy="${cy + 46}" r="13" fill="#fff"/>`;
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
  }
  return s;
}

/* ---------- 放進遊戲的部分 ---------- */
// 座標跟 main.js 的 MAP_GAP / MAP_BOTTOM 一樣（第 i 關在 H - 110 - i × 116，i 從 0 起算）
const GAP = 116, BOT = 110;
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
      name: r.name, k: k + 1, from: r.from, to, stops: r.stops, zones: r.zones, dens: r.dens, props: r.props, extra: r.extra,
      bridge: last ? null : r.bridge,
      bottom: r.from === 1 ? H : yOf(r.from - 1) + GAP / 2,
      top: last ? 0 : yOf(to - 1) - GAP / 2,
    };
  });
}
export function stationAt(st, y) { return st.find(r => y >= r.top && y < r.bottom) || st[0]; }

// 駐站娃娃：遊戲裡原本的 8 隻，每站一隻（第 1 站和最後一站兩隻）
const DOLL_NAME = Object.fromEntries(PIECES.map(p => [p.id, p.name]));
DOLL_NAME.dino = '龍龍';
const DOLLS = [['egg', 'sloth'], ['dog'], ['piggy'], ['sloth'], ['moodeng'], ['egg'], ['nyanko'], ['snoopy'], ['piggy'], ['dog'], ['snoopy'], ['nyanko'],
  ['dino'], ['sloth'], ['moodeng'], ['dino'], ['nyanko'], ['dog'], ['piggy'], ['snoopy'], ['dino'], ['egg'], ['moodeng'], ['sloth', 'egg']];
// 娃娃站在兩關中間、路的另一側
function dollSpots(st, n, H) {
  const out = [];
  st.forEach(r => {
    const ids = DOLLS[r.k - 1] || [];
    const offs = ids.length === 2 ? (r.to - r.from >= 10 ? [3, 9] : [1, 3]) : [2];
    ids.forEach((id, j) => {
      const i = r.from - 1 + offs[j];
      if (i > r.to - 2) return;                 // 這站的關卡還沒做到那裡
      const y = H - BOT - i * GAP - GAP / 2;
      out.push({ id, y, pct: roadX(i + .5, n) > 50 ? 19 : 81, from: r.from });
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
  let html = '';
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
          if (spots.some(s => Math.abs(W * s.pct / 100 - x) < 66 && Math.abs(s.y - 10 - y) < 72)) continue;
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
    const lock = s.from > unlocked;
    html += `<div class="map-doll${lock ? ' lock' : ''}" style="left:${s.pct}%;top:${s.y}px"><img src="assets/sprites/${s.id}_n.png" alt="" decoding="async" draggable="false"><i></i><span>${DOLL_NAME[s.id] || ''}</span></div>`;
  });
  return html;
}
