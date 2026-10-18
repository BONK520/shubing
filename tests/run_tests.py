# 跑引擎測試（無頭 Chromium）。在專案根目錄：
#   python tests/run_tests.py                 # 單元測試 + fuzz，失敗時 exit code 1
#   python tests/run_tests.py --fuzz 20       # 加大 fuzz（每組設定的局數，預設 6）
#   python tests/run_tests.py --only combo    # 只跑名稱含 combo 的測試
#   python tests/run_tests.py --sim           # 平衡模擬表（tests/sim.html）
#   python tests/run_tests.py --sim --games 80 --moves 25
#   python tests/run_tests.py --shot tools/out/tests/t.png   # 另存結果頁截圖
import argparse, functools, http.server, os, sys, threading, time, urllib.parse
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


Quiet.extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, '.js': 'text/javascript'}


def serve():
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=ROOT))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--fuzz', type=int)
    ap.add_argument('--only')
    ap.add_argument('--engine', help='engine module URL path to test instead of /js/engine.js')
    ap.add_argument('--sim', action='store_true')
    ap.add_argument('--games', type=int)
    ap.add_argument('--moves', type=int)
    ap.add_argument('--shot')
    ap.add_argument('--timeout', type=int, default=600)
    a = ap.parse_args()
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')

    q = {}
    if a.sim:
        page, var = '/tests/sim.html', '__sim'
        if a.games: q['games'] = a.games
        if a.moves: q['moves'] = a.moves
    else:
        page, var = '/tests/engine.test.html', '__results'
        if a.fuzz: q['fuzz'] = a.fuzz
        if a.only: q['only'] = a.only
    if a.engine: q['engine'] = a.engine
    srv = serve()
    url = f'http://127.0.0.1:{srv.server_port}{page}' + ('?' + urllib.parse.urlencode(q) if q else '')
    errors = []
    code = 0
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(viewport={'width': 900, 'height': 1200})
        pg.on('pageerror', lambda e: errors.append(f'[pageerror] {e}'))
        pg.on('console', lambda m: errors.append(f'[console.{m.type}] {m.text}') if m.type == 'error' else None)
        t0 = time.time()
        pg.goto(url)
        pg.wait_for_function(f'() => window.{var} !== undefined', timeout=a.timeout * 1000, polling=250)
        res = pg.evaluate(f'() => window.{var}')
        dt = time.time() - t0
        if a.shot:
            os.makedirs(os.path.dirname(os.path.abspath(a.shot)), exist_ok=True)
            pg.screenshot(path=a.shot, full_page=True)
        b.close()
    srv.shutdown()

    for e in errors:
        print(e)
    if a.sim:
        print(res.get('text', ''))
        code = 1 if res.get('error') else 0
        if res.get('error'):
            print('ERROR:', res['error'])
    else:
        for n in res.get('notes', []):
            print('  ·', n)
        for f in res['failures']:
            print(f"FAIL {f['name']}\n     " + f['message'].replace('\n', '\n     '))
        print(f"{res['passed']} passed, {res['failed']} failed in {dt:.1f}s")
        code = 1 if res['failed'] or errors else 0
    sys.exit(code)


if __name__ == '__main__':
    main()
