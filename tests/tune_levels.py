# 新關卡的步數和星星門檻找初值（無頭 Chromium 跑 tests/sim.html?mode=api）。在專案根目錄：
#   python tests/tune_levels.py                  # 第 16–30 關
#   python tests/tune_levels.py 16 17 30         # 只調這幾關
#   python tests/tune_levels.py --games 600      # 每次模擬的局數（越多越穩，預設 400）
# 做法（目標 = tests/sim.js 的 targetsFor，兩組盤面「各種盤面 / 第 0 個盤面」都要達到）：
#   1. 步數：找「casual 和 decent 的過關率都比目標高 MARGIN」的最少步數（步數越少越難）
#   2. 種子：試 level.seed、+1、+2 …，挑第 0 個盤面（第一次玩一定是它）最像平常盤面、又達標的那個
#   3. 星星：找「decent 三星比例比目標高 S3_MARGIN」的最高門檻 s（千位取整），stars = [s, 2s, 3s]
# 印出建議值；照著改 js/levels.js，再跑 python tests/run_tests.py --sim 確認。
import argparse, os, sys
from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from run_tests import serve   # noqa: E402

MARGIN, S3_MARGIN = 0.03, 0.05

SEARCH = r"""
async ({ ids, games, margin, s3margin, seeds }) => {
  const { targetsFor, summarize } = await import('/tests/sim.js');
  // fixed = null：第 0…games-1 次玩的盤面各一局；fixed = 0：每次打開都先看到的第 0 個盤面玩 games 次
  const run = async (L, fixed) => (await window.simLevels([L], { games, fixed }))[L.id];
  const sum = (L, R) => ({ casual: summarize(L, R.casual), decent: summarize(L, R.decent), raw: R });
  const out = [];
  for (const id of ids) {
    const L0 = window.LEVELS.find(L => L.id === id);
    const T = targetsFor(id);
    const ok = S => S.casual.pass >= T.casual.pass + margin && S.decent.pass >= T.decent.pass + margin;
    // 1. 步數：在「各種盤面」上二分搜尋最少步數（過關率大致隨步數遞增）
    let lo = 10, hi = 60, m = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1, L = { ...L0, moves: mid };
      if (ok(sum(L, await run(L, null)))) { m = mid; hi = mid - 1; } else lo = mid + 1;
    }
    if (m == null) { out.push({ id, error: '60 步也達不到過關目標' }); continue; }
    // 2. 種子：第 0 個盤面要像「平常的盤面」（不會特別難、也不會特別簡單），而且兩組都達標；都不行就多給一步再找
    let pick = null;
    for (let mm = m; mm <= m + 3 && !pick; mm++) {
      for (let k = 0; k < seeds; k++) {
        const L = { ...L0, moves: mm, seed: L0.seed + k };
        const A = sum(L, await run(L, null)), F = sum(L, await run(L, 0));
        if (!ok(A) || !ok(F)) continue;
        const d = Math.abs(F.casual.pass - A.casual.pass) + Math.abs(F.decent.pass - A.decent.pass)
          + Math.abs(F.decent.p50 - A.decent.p50) / Math.max(1, A.decent.p50);
        if (!pick || d < pick.d) pick = { d, L, A, F };
      }
    }
    if (!pick) { out.push({ id, error: `${m}–${m + 3} 步試了 ${seeds} 個種子，第 0 個盤面都達不到目標` }); continue; }
    // 3. 星星：最高的 s（千位）讓兩組的 decent 三星比例都 ≥ 目標 + s3margin
    //    過關時分數會先補到 stars[0]，所以門檻改了最終分數也會變：最終 = 原本 − 原本補的 + 新的要補的
    const s0 = pick.L.stars[0], bump = (g, s) => Math.max(0, s - g[3]);
    const rate = (gs, s) => gs.filter(g => g[0] && g[4] - bump(g, s0) + bump(g, s) >= 3 * s).length / gs.length;
    const want = Math.max(0, T.decent.s3) + s3margin;
    let s = 1000;
    for (let c = 1000; c <= 200000; c += 1000) {
      if (rate(pick.A.raw.decent, c) >= want && rate(pick.F.raw.decent, c) >= want) s = c; else break;
    }
    const L = { ...pick.L, stars: [s, 2 * s, 3 * s] };
    const A = sum(L, await run(L, null)), F = sum(L, await run(L, 0));
    const row = S => ({ casual: S.casual, decent: S.decent });
    out.push({ id, moves: L.moves, seed: L.seed, stars: L.stars, was: { moves: L0.moves, stars: L0.stars, seed: L0.seed }, T,
      all: row(A), first: row(F) });
  }
  return out;
}
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('ids', nargs='*', type=int)
    ap.add_argument('--games', type=int, default=400)
    ap.add_argument('--seeds', type=int, default=12, help='每關試幾個種子（level.seed, +1, +2 …）')
    a = ap.parse_args()
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    ids = a.ids or list(range(16, 31))
    srv = serve()
    pct = lambda x: f'{round(100 * x):3d}%'
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page()
        errors = []
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.goto(f'http://127.0.0.1:{srv.server_port}/tests/sim.html?mode=api')
        pg.wait_for_function('() => window.__simReady === true', timeout=60000)
        problems = pg.evaluate('() => window.validateLevels()')
        print('validateLevels:', '; '.join(problems) if problems else 'OK')
        res = pg.evaluate(SEARCH, {'ids': ids, 'games': a.games, 'margin': MARGIN, 's3margin': S3_MARGIN, 'seeds': a.seeds})
        b.close()
    srv.shutdown()
    for e in errors:
        print('[pageerror]', e)
    print(f'每次 {a.games} 局；過關率要比目標高 {round(MARGIN * 100)} 個百分點、decent 三星要比目標高 {round(S3_MARGIN * 100)} 個百分點')
    print(' 關  步數 星星門檻              |  各種盤面 casual 過關/★3  decent 過關/★3 |  第0盤面 casual 過關/★3  decent 過關/★3 | 目標 casual 過關 / decent 過關 / decent ★3')
    for r in res:
        if 'error' in r:
            print(f"{r['id']:3d}  {r['error']}")
            continue
        A, F, T = r['all'], r['first'], r['T']
        print(f"{r['id']:3d}  {r['moves']:4d} {'/'.join(map(str, r['stars'])):21s} |"
              f"  {pct(A['casual']['pass'])} {pct(A['casual']['s3'])}   {pct(A['decent']['pass'])} {pct(A['decent']['s3'])}   |"
              f"  {pct(F['casual']['pass'])} {pct(F['casual']['s3'])}   {pct(F['decent']['pass'])} {pct(F['decent']['s3'])}   |"
              f"  {pct(T['casual']['pass'])} / {pct(T['decent']['pass'])} / {pct(max(0, T['decent']['s3']))}"
              f"   seed {r['seed']}（原本 {r['was']['moves']} 步 {r['was']['stars'][0]} seed {r['was']['seed']}）")


if __name__ == '__main__':
    main()
