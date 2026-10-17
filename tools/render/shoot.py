# 用無頭瀏覽器 + three.js 把 glb 渲染成透明背景 PNG（Python 版，不需要 Node，也不用另外開伺服器）
# 先裝: pip install playwright && python -m playwright install chromium
# 用法（在 tools/ 目錄）: python render/shoot.py render/jobs.example.json out/sprites
# job 裡加 "frames": N 會把模型原地轉一圈，輸出 <name>_00.png ... <name>_{N-1}.png
import base64, functools, http.server, json, os, sys, threading
from playwright.sync_api import sync_playwright

TOOLS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


def main(jobfile, outdir):
    jobs = json.load(open(jobfile, encoding='utf-8'))
    os.makedirs(outdir, exist_ok=True)
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=TOOLS))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    with sync_playwright() as p:
        b = p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
        pg = b.new_page()
        pg.on('pageerror', lambda e: print('page error:', e))
        pg.goto(f'http://127.0.0.1:{srv.server_port}/render/render.html')
        pg.wait_for_function('window.ready', timeout=60000)
        for j in jobs:
            n = j.get('frames', 0)
            for i in range(max(n, 1)):
                items = [dict(it) for it in j['items']]
                if n:
                    for it in items:
                        it['yaw'] = it.get('yaw', 0) + 360 * i / n
                d = pg.evaluate('([i, v]) => window.shot(i, v)', [items, j['view']])
                name = f"{j['name']}_{i:02d}" if n else j['name']
                with open(os.path.join(outdir, name + '.png'), 'wb') as f:
                    f.write(base64.b64decode(d.split(',')[1]))
            print('saved', j['name'], f'({n} frames)' if n else '')
        b.close()
    srv.shutdown()


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
