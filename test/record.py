# Record the guided tour frame by frame (virtual clock, so it is exact and smooth)
#   python3 test/record.py <url-with-?video> <outdir> [fps] [maxsec] [every]
# every = 1 saves every frame; >1 saves only every n-th (for previews)
import sys, os, time
from playwright.sync_api import sync_playwright
url, out = sys.argv[1], sys.argv[2]
fps = float(sys.argv[3]) if len(sys.argv) > 3 else 30
maxsec = float(sys.argv[4]) if len(sys.argv) > 4 else 120
every = int(sys.argv[5]) if len(sys.argv) > 5 else 1
W = int(os.environ.get('W', 1280)); H = int(os.environ.get('H', 720)); DPR = float(os.environ.get('DPR', 1))
os.makedirs(out, exist_ok=True)
# the page's web fonts cannot be fetched here: stand in with close local fonts
FONT_CSS = """
@font-face { font-family: "Chakra Petch"; font-weight: 400 500; src: local("Poppins Medium"), local("Poppins-Medium"); }
@font-face { font-family: "Chakra Petch"; font-weight: 600 900; src: local("Poppins Bold"), local("Poppins-Bold"); }
@font-face { font-family: "IBM Plex Sans"; font-weight: 100 450; src: local("TeX Gyre Heros"), local("TeXGyreHeros-Regular"); }
@font-face { font-family: "IBM Plex Sans"; font-weight: 451 900; src: local("TeX Gyre Heros Bold"), local("TeXGyreHeros-Bold"); }
@font-face { font-family: "Martian Mono"; src: local("DejaVu Sans Mono"), local("DejaVuSansMono"); }
@font-face { font-family: "Noto Sans SC"; font-weight: 100 450; src: local("Noto Sans CJK SC"), local("NotoSansCJKsc-Regular"); }
@font-face { font-family: "Noto Sans SC"; font-weight: 451 900; src: local("Noto Sans CJK SC Bold"), local("NotoSansCJKsc-Bold"); }
"""
with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
    pg = b.new_page(viewport={"width": W, "height": H}, device_scale_factor=DPR)
    logs = []
    pg.on("console", lambda m: logs.append(f"[{m.type}] {m.text}"))
    pg.on("pageerror", lambda e: logs.append(f"[pageerror] {e}"))
    pg.route("**/fonts.googleapis.com/**", lambda r: r.fulfill(status=200, content_type="text/css", body=FONT_CSS, headers={"Access-Control-Allow-Origin": "*"}))
    pg.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    pg.goto(url)
    pg.wait_for_function("window.__nand && window.__nand.tour && window.__nand.tour.on", timeout=180000)
    pg.wait_for_timeout(1200)          # boot overlay fades out
    dt = 1000.0 / fps
    n = int(maxsec * fps)
    t0 = time.time(); saved = 0; tail = -1
    for i in range(n):
        shoot = i % every == 0
        path = f"{out}/f{saved:05d}.jpg"
        have = shoot and os.path.exists(path) and os.path.getsize(path) > 0   # resuming: frames already on disk
        done = pg.evaluate("([ms, d]) => { __nand.stepFrame(ms, d); return !!__nand.tourDone; }", [dt, shoot and not have])
        if shoot:
            if not have:
                tmp = path + ".tmp.jpg"
                pg.screenshot(path=tmp, type="jpeg", quality=93)
                os.replace(tmp, path)
            saved += 1
        if done and tail < 0: tail = int(fps * 0.6)
        if tail >= 0:
            tail -= 1
            if tail < 0: break
        if i % 60 == 0:
            st = pg.evaluate("[__nand.tour.i, __nand.mode(), __nand.MACH.cycles]")
            print(f"frame {i} t={i/fps:.1f}s stop={st[0]} mode={st[1]} cyc={st[2]} wall={time.time()-t0:.0f}s", flush=True)
    print("frames saved", saved, "wall", round(time.time() - t0), "s")
    print("\n".join(logs[-20:]))
    b.close()
