"""Quick test: hit live server with real, print-attack, and replay-attack samples."""
import os, base64, requests, cv2

URL = "http://localhost:8000"

def test_image(path, label):
    img = cv2.imread(path)
    if img is None:
        print(f"  [{label}] cannot read {path}")
        return
    _, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 95])
    b64 = "data:image/jpeg;base64," + base64.b64encode(buf).decode()
    r = requests.post(f"{URL}/extract-embedding", json={"image": b64}, timeout=30)
    d = r.json()
    emb_status = "RETURNED" if d.get("embedding") else "BLOCKED"
    print(
        f"  [{label}] detected={d.get('detected')} "
        f"spoof={d.get('spoof_detected')} "
        f"label={d.get('spoof_label')} "
        f"real_conf={round(d.get('real_confidence', 0), 4)} "
        f"embedding={emb_status}"
    )

samples = {"REAL": None, "PRINT": None, "REPLAY": None}
for root, dirs, files in os.walk("datasets"):
    for f in files:
        if not f.lower().endswith((".jpg", ".jpeg", ".png")):
            continue
        full = os.path.join(root, f)
        tag = root.lower()
        if samples["REAL"] is None and ("real" in tag or "live" in tag):
            samples["REAL"] = full
        if samples["PRINT"] is None and "print" in tag:
            samples["PRINT"] = full
        if samples["REPLAY"] is None and ("replay" in tag or "phone" in tag):
            samples["REPLAY"] = full
    if all(v is not None for v in samples.values()):
        break

h = requests.get(f"{URL}/health").json()
print("Health:", h)
print()

for label, path in samples.items():
    if path:
        print(f"{label} sample: {path}")
        test_image(path, label)
    else:
        print(f"{label} sample: NOT FOUND")
