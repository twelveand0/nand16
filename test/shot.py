# Render the page in headless Chromium and take screenshots at a few moments
import sys, time, json
from playwright.sync_api import sync_playwright
path = sys.argv[1]
out = sys.argv[2]
actions = json.loads(sys.argv[3]) if len(sys.argv) > 3 else []
with sync_playwright() as p:
    b = p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
    pg = b.new_page(viewport={"width": 1440, "height": 900})
    logs = []
    pg.on("console", lambda m: logs.append(f"[{m.type}] {m.text}"))
    pg.on("pageerror", lambda e: logs.append(f"[pageerror] {e}"))
    # fonts cannot load offline: fail fast
    pg.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    pg.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    pg.goto("file://" + path)
    for i, a in enumerate(actions):
        kind = a[0]
        if kind == "wait": pg.wait_for_timeout(a[1])
        elif kind == "shot": pg.screenshot(path=f"{out}_{a[1]}.png")
        elif kind == "js": print("js:", pg.evaluate(a[1]))
        elif kind == "click": pg.click(a[1])
        elif kind == "key": pg.keyboard.press(a[1])
        elif kind == "down": pg.keyboard.down(a[1])
        elif kind == "up": pg.keyboard.up(a[1])
        elif kind == "wheel": pg.mouse.move(a[1], a[2]); pg.mouse.wheel(0, a[3])
        elif kind == "dbl": pg.mouse.dblclick(a[1], a[2])
    print("\n".join(logs[-40:]))
    b.close()
