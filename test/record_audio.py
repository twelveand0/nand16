# Render the tour's soundtrack offline, on the same virtual clock as test/record.py
#   python3 test/record_audio.py <url-with-?video> <out.wav> [fps] [maxsec]
import sys, base64, wave, time
from playwright.sync_api import sync_playwright
url, out = sys.argv[1], sys.argv[2]
fps = float(sys.argv[3]) if len(sys.argv) > 3 else 30
maxsec = float(sys.argv[4]) if len(sys.argv) > 4 else 110
with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"])
    pg = b.new_page(viewport={"width": 1280, "height": 720})
    logs = []
    pg.on("console", lambda m: logs.append(f"[{m.type}] {m.text}"))
    pg.on("pageerror", lambda e: logs.append(f"[pageerror] {e}"))
    pg.route("**/fonts.googleapis.com/**", lambda r: r.abort())
    pg.route("**/fonts.gstatic.com/**", lambda r: r.abort())
    pg.goto(url)
    pg.wait_for_function("window.__nand && window.__nand.tour && window.__nand.tour.on", timeout=180000)
    pg.wait_for_timeout(1200)
    pg.evaluate(f"__nand.recordAudio({maxsec})")
    t0 = time.time(); n = 0; tail = -1
    for i in range(int(maxsec * fps) - 10):
        done = pg.evaluate("(ms) => { __nand.stepFrame(ms, false); return !!__nand.tourDone; }", 1000.0 / fps)
        n += 1
        if done and tail < 0: tail = int(fps * 0.6)
        if tail >= 0:
            tail -= 1
            if tail < 0: break
    print("frames", n, "sim wall", round(time.time() - t0), "s", flush=True)
    total = pg.evaluate("__nand.renderAudio()")
    print("samples", total, "render wall", round(time.time() - t0), "s", flush=True)
    keep = int(n / fps * 44100 + 44100 * 2) * 2          # the tour plus two seconds of reverb tail
    keep = min(keep, total)
    data = bytearray()
    step = 1 << 20
    for i in range(0, keep, step):
        data += base64.b64decode(pg.evaluate("([i, n]) => __nand.pcmChunk(i, n)", [i, min(step, keep - i)]))
    with wave.open(out, "wb") as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(44100); w.writeframes(bytes(data))
    print("wrote", out, len(data), "bytes;", "\n".join(logs[-10:]))
    b.close()
