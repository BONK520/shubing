// Web Worker for tests/sim.js: plays a slice of games and posts the compact results back.
//   in : { id, level, profile, a0, a1, fixed }   attempts a0 .. a1-1, or (fixed = n) attempt n with player salts a0 .. a1-1
//   out: { id, games: [[won, used, left, atGoal, final, stars], ...] }  or { id, error }
import { playLevel } from './sim.bots.js';

self.onmessage = ev => {
  const { id, level, profile, a0, a1, fixed } = ev.data;
  try {
    const games = [];
    for (let k = a0; k < a1; k++) {
      const g = fixed == null ? playLevel(level, profile, k) : playLevel(level, profile, fixed, k);
      games.push([g.won ? 1 : 0, g.used, g.left, g.atGoal, g.final, g.stars]);
    }
    self.postMessage({ id, games });
  } catch (err) {
    self.postMessage({ id, error: String(err && err.stack || err) });
  }
};
