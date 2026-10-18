# 用無頭瀏覽器 + three.js 把 glb 渲染成透明背景 PNG（Python 版，不需要 Node，也不用另外開伺服器）
# 先裝: pip install playwright && python -m playwright install chromium
# 用法（在 tools/ 目錄）: python render/shoot.py render/jobs.example.json out/sprites
# job 裡加 "frames": N 會把模型原地轉一圈，輸出 <name>_00.png ... <name>_{N-1}.png
# 也可以當模組用（build_assets.py）:
#   with Renderer() as R: png_bytes = R.shot([{"url": "/out/models/dog.glb"}], {"yaw": 300, "w": 512, "h": 512})
# url 是相對 tools/ 目錄的網址路徑。
import base64, functools, http.server, json, os, sys, threading
from playwright.sync_api import sync_playwright

TOOLS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


class Renderer:
    """一個瀏覽器分頁 + 本機伺服器（根目錄 = tools/），可以連續拍很多張。"""

    def __init__(self, timeout=120000):
        self.srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=TOOLS))
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        self.pw = sync_playwright().start()
        self.browser = self.pw.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
        self.page = self.browser.new_page()
        self.errors = []
        self.page.on('pageerror', lambda e: (self.errors.append(str(e)), print('page error:', e)))
        self.page.set_default_timeout(timeout)
        self.page.goto(f'http://127.0.0.1:{self.srv.server_port}/render/render.html')
        self.page.wait_for_function('window.ready', timeout=timeout)

    def shot(self, items, view):
        """回傳 PNG bytes。items/view 的欄位見 render.html。"""
        d = self.page.evaluate('([i, v]) => window.shot(i, v)', [items, view])
        return base64.b64decode(d.split(',')[1])

    def close(self):
        try:
            self.browser.close()
            self.pw.stop()
        finally:
            self.srv.shutdown()

    def __enter__(self):
        return self

    def __exit__(self, *a):
        self.close()


def spin_items(items, i, n):
    """第 i 格（共 n 格）：每個 item 的 yaw 加上 360*i/n。"""
    out = [dict(it) for it in items]
    for it in out:
        it['yaw'] = it.get('yaw', 0) + 360 * i / n
    return out


def run_jobs(jobs, outdir, renderer=None):
    os.makedirs(outdir, exist_ok=True)
    R = renderer or Renderer()
    try:
        for j in jobs:
            n = j.get('frames', 0)
            for i in range(max(n, 1)):
                items = spin_items(j['items'], i, n) if n else j['items']
                name = f"{j['name']}_{i:02d}" if n else j['name']
                with open(os.path.join(outdir, name + '.png'), 'wb') as f:
                    f.write(R.shot(items, j['view']))
            print('saved', j['name'], f'({n} frames)' if n else '')
    finally:
        if renderer is None:
            R.close()


def main(jobfile, outdir):
    run_jobs(json.load(open(jobfile, encoding='utf-8')), outdir)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
