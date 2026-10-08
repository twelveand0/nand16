import sys
from playwright.sync_api import sync_playwright
path, out = sys.argv[1], sys.argv[2]
with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
    pg = b.new_page(viewport={"width": 400, "height": 820})
    logs = []
    pg.on("console", lambda m: logs.append(f"[{m.type}] {m.text}"))
    pg.on("pageerror", lambda e: logs.append(f"[pageerror] {e}"))
    pg.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    pg.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    pg.goto("file://" + path)
    pg.wait_for_timeout(9000)
    pg.screenshot(path=out + "_m1.png")
    print(pg.evaluate("document.documentElement.scrollWidth + ' x ' + document.body.scrollWidth"))
    print("\n".join(logs[-10:]))
    b.close()
