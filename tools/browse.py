# 無頭瀏覽器小工具：在專案根目錄開臨時伺服器，打開頁面、執行 JS、截圖、印出 console 錯誤
# 用法（在專案根目錄）:
#   python tools/browse.py index.html --shot tools/out/check/a.png --w 390 --h 844 --wait 1500
#   python tools/browse.py /index.html --eval "document.title"
#   python tools/browse.py /index.html --script my_steps.py   # my_steps.py 裡定義 run(page, base_url)
import argparse, functools, http.server, json, os, sys, threading, runpy
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


def serve():
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=ROOT))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('path', nargs='?', default='/index.html')
    ap.add_argument('--shot')
    ap.add_argument('--w', type=int, default=390)
    ap.add_argument('--h', type=int, default=844)
    ap.add_argument('--wait', type=int, default=1000)
    ap.add_argument('--eval', action='append', default=[])
    ap.add_argument('--script')
    ap.add_argument('--touch', action='store_true')
    a = ap.parse_args()
    # Git Bash 會把 /index.html 改寫成 C:/Program Files/Git/index.html，所以也接受不加斜線的寫法
    a.path = '/' + a.path.replace('\\', '/').split('/Git/', 1)[-1].lstrip('/')
    srv = serve()
    base = f'http://127.0.0.1:{srv.server_port}'
    logs = []
    with sync_playwright() as p:
        b = p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'])
        ctx = b.new_context(viewport={'width': a.w, 'height': a.h}, device_scale_factor=2, has_touch=a.touch, is_mobile=a.touch)
        pg = ctx.new_page()
        pg.on('console', lambda m: logs.append(f'[{m.type}] {m.text}'))
        pg.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
        pg.on('requestfailed', lambda r: logs.append(f'[requestfailed] {r.url}'))
        pg.goto(base + a.path)
        pg.wait_for_timeout(a.wait)
        for e in a.eval:
            try:
                print('eval:', json.dumps(pg.evaluate(e), ensure_ascii=False)[:4000])
            except Exception as ex:
                print('eval error:', ex)
        if a.script:
            runpy.run_path(a.script)['run'](pg, base)
        if a.shot:
            os.makedirs(os.path.dirname(os.path.abspath(a.shot)), exist_ok=True)
            pg.screenshot(path=a.shot)
            print('screenshot:', a.shot)
        b.close()
    srv.shutdown()
    for l in logs:
        print(l)


if __name__ == '__main__':
    main()
