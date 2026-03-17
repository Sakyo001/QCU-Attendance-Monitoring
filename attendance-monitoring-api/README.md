# Face Recognition + Anti-Spoofing ML Backend

Modular Python backend for the attendance monitoring system.
Uses **RetinaFace** (detection) · **ArcFace** (recognition) · **MiniFASNet** (anti-spoofing).

---

## Project Structure

```
face-ml-training/
│
├── 1_collect_data/
│   └── collect_faces.py          ← webcam-based dataset capture tool
│
├── training/
│   ├── train_arcface.py          ← ArcFace fine-tuning script
│   └── train_antispoof.py        ← MiniFASNet training script
│
├── recognition/
│   ├── face_detector.py          ← RetinaFace wrapper (insightface)
│   ├── face_embedding.py         ← ArcFace embedding extractor (ONNX / PyTorch)
│   ├── anti_spoof.py             ← MiniFASNet ensemble (V2 + V1SE)
│   └── recognition_engine.py    ← Full pipeline orchestrator
│
├── database/
│   └── db_manager.py             ← Async SQLite (SQLAlchemy + aiosqlite)
│
├── api/
│   ├── server.py                 ← FastAPI app + lifespan hooks
│   └── routes.py                 ← All API endpoints
│
├── utils/
│   ├── preprocessing.py          ← Alignment, augmentation, tensor conversion
│   └── similarity.py             ← Cosine similarity, FAISS index
│
├── datasets/
│   ├── faces/                    ← Recognition dataset (one folder per person)
│   └── spoof/                    ← Anti-spoof dataset (real / print / replay)
│
├── models/
│   ├── arcface/                  ← Trained ArcFace weights go here
│   └── antispoof/                ← Pretrained MiniFASNet weights go here
│
└── requirements.txt
```

---

## 1 · Environment Setup

### Python version

Python 3.10 or 3.11 is recommended.

### Create a virtual environment

```bash
python -m venv .venv
# Windows
.venv\Scripts\activate
# Linux / macOS
source .venv/bin/activate
```

### Install PyTorch for CUDA 12.x (GTX 1650)

```bash
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121
```

Verify GPU is detected:

```bash
python -c "import torch; print(torch.cuda.is_available(), torch.cuda.get_device_name(0))"
```

### Install all remaining dependencies

```bash
pip install -r requirements.txt
```

---

## 2 · Download Pretrained Models

### 2a · insightface (RetinaFace + ArcFace ONNX)

insightface auto-downloads model packs on first use.
The default pack used is **buffalo_sc** (fast) or **buffalo_l** (accurate).

Force a download now:

```bash
python -c "
from insightface.app import FaceAnalysis
app = FaceAnalysis(name='buffalo_l')
app.prepare(ctx_id=0, det_size=(640,640))
print('Models downloaded.')
"
```

Models are cached in `~/.insightface/models/`.

### 2b · MiniFASNet anti-spoofing weights

Download the two pretrained weight files from the official repository:

```
https://github.com/minivision-ai/Silent-Face-Anti-Spoofing
  → resources/anti_spoof_models/
      2.7_80x80_MiniFASNetV2.pth
      4_0_0_80x80_MiniFASNetV1SE.pth
```

Place both files in:

```
face-ml-training/models/antispoof/
```

Direct download (requires git-lfs or manual GitHub download):

```bash
mkdir -p models/antispoof
# Then copy both .pth files into models/antispoof/
```

---

## 3 · Collect Training Data

All commands below should be run from inside `face-ml-training/`.

### 3a · Face Recognition Dataset

Collect 20 images for each person to be registered:

```bash
python 1_collect_data/collect_faces.py recognition \
    --identity "John_Doe" \
    --num_images 20 \
    --output_dir datasets/faces
```

This creates:  `datasets/faces/John_Doe/00000.jpg … 00019.jpg`

Repeat for every identity you want to train on.

Controls:
- **SPACE** — capture current frame
- **A** — toggle auto-capture every N frames
- **Q / ESC** — quit

### 3b · Anti-Spoof Dataset

```bash
# Real face (sit normally in front of camera)
python 1_collect_data/collect_faces.py antispoof \
    --class_name real \
    --num_images 500 \
    --auto_interval 5

# Print attack (hold printed photo)
python 1_collect_data/collect_faces.py antispoof \
    --class_name print_attack \
    --num_images 500

# Replay attack (hold phone/tablet showing face video)
python 1_collect_data/collect_faces.py antispoof \
    --class_name replay_attack \
    --num_images 500
```

Dataset layout after collection:

```
datasets/spoof/
    real/           ← 500+ jpg files
    print_attack/   ← 500+ jpg files
    replay_attack/  ← 500+ jpg files
```

**Tip:** Collect varied lighting, angles, and distances for best generalisation.

---

## 4 · Train the Models

### 4a · Train ArcFace (face recognition)

```bash
python training/train_arcface.py \
    --data_dir datasets/faces \
    --output_dir models/arcface \
    --backbone r50 \
    --epochs 50 \
    --batch_size 64 \
    --device cuda
```

For the full ResNet100 backbone (slower, more accurate):

```bash
python training/train_arcface.py --backbone r100 --epochs 80 --batch_size 32
```

Output:  `models/arcface/arcface_model.pth`

Track training in TensorBoard:

```bash
tensorboard --logdir runs/arcface
```

### 4b · Train Anti-Spoofing (MiniFASNet)

Two model variants can be trained independently:

```bash
# MiniFASNetV2
python training/train_antispoof.py \
    --model v2 \
    --epochs 60 \
    --device cuda

# MiniFASNetV1SE
python training/train_antispoof.py \
    --model v1se \
    --epochs 60 \
    --device cuda
```

Output:
- `models/antispoof/antispoof_model_v2.pth`
- `models/antispoof/antispoof_model_v1se.pth`

The inference pipeline uses both models as an ensemble.

**Note:** If you use the pretrained MiniFASNet weights (step 2b), you can skip
this step entirely. Only train from scratch if you need better accuracy for
your specific camera / lighting conditions.

---

## 5 · Run the API Server

### Quick start (uses insightface pretrained models)

```bash
cd face-ml-training
python api/server.py
```

OR with uvicorn:

```bash
uvicorn api.server:app --host 0.0.0.0 --port 8000
```

The server starts at:  `http://localhost:8000`
Interactive docs:       `http://localhost:8000/docs`

### Run with custom-trained PyTorch ArcFace weights

```bash
ARCFACE_MODE=pytorch \
ARCFACE_MODEL_PATH=models/arcface/arcface_model.pth \
ARCFACE_BACKBONE=r50 \
python api/server.py
```

### Environment variables

| Variable             | Default                     | Description                             |
|----------------------|-----------------------------|-----------------------------------------|
| `DB_PATH`            | `database/embeddings.db`    | SQLite database file path               |
| `ARCFACE_MODE`       | `insightface`               | `insightface` or `pytorch`              |
| `ARCFACE_MODEL_PATH` | *(none)*                    | Path to custom `.pth` (pytorch mode)    |
| `ARCFACE_BACKBONE`   | `r100`                      | `r50` or `r100`                         |
| `ANTISPOOF_MODEL_DIR`| `models/antispoof`          | Directory with MiniFASNet `.pth` files  |
| `DET_MODEL_NAME`     | `buffalo_sc`                | `buffalo_sc` (fast) or `buffalo_l`      |
| `DEVICE`             | `cuda` (if available)       | `cuda` or `cpu`                         |
| `SIM_THRESHOLD`      | `0.6`                       | Cosine similarity threshold [0, 1]      |
| `REAL_THRESHOLD`     | `0.7`                       | Anti-spoof real-face confidence [0, 1]  |
| `ALLOWED_ORIGINS`    | `*`                         | CORS origins (comma-separated)          |

Create a `.env` file in `face-ml-training/` to persist these settings.

---

## 6 · API Endpoints

Base URL: `http://localhost:8000/api/v1`

### POST `/register`

Register a new user.

```http
POST /api/v1/register
Content-Type: multipart/form-data

name=John Doe
user_id=emp_001       (optional)
images[]=face01.jpg
images[]=face02.jpg
... (10–20 images recommended)
```

Response:

```json
{
  "success": true,
  "user_id": "emp_001",
  "name": "John Doe",
  "message": "User registered successfully.",
  "num_images_used": 16
}
```

### POST `/recognize`

Recognize a face in a camera frame.

```http
POST /api/v1/recognize
Content-Type: multipart/form-data

image=frame.jpg
```

Response:

```json
{
  "user_id": "emp_001",
  "name": "John Doe",
  "spoof_detected": false,
  "spoof_label": "real",
  "real_confidence": 0.94,
  "confidence": 0.87,
  "is_recognized": true,
  "bbox": [142, 89, 312, 298],
  "processing_ms": 18.4
}
```

### POST `/attendance`

Log attendance after recognition:

```json
{
  "user_id": "emp_001",
  "status": "present",
  "confidence": 0.87
}
```

### GET `/attendance`

Query attendance with optional filters:

```
GET /api/v1/attendance?user_id=emp_001&date_from=2026-03-01&date_to=2026-03-09
```

### GET `/users`

List all registered users.

### DELETE `/users/{user_id}`

Remove a user and all their attendance records.

---

## 7 · Frontend Integration

From the React / Next.js frontend, send frames to `/recognize` at the desired
rate. A typical loop:

```js
async function recognizeFrame(blob) {
  const form = new FormData();
  form.append("image", blob, "frame.jpg");
  const res = await fetch("http://localhost:8000/api/v1/recognize", {
    method: "POST",
    body: form,
  });
  return res.json();
}
```

After getting a recognized result, call `/attendance` to persist it:

```js
if (result.is_recognized && !result.spoof_detected) {
  await fetch("http://localhost:8000/api/v1/attendance", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      user_id: result.user_id,
      confidence: result.confidence,
      status: "present",
    }),
  });
}
```

---

## 8 · Performance

| Component            | GTX 1650 (4 GB) | CPU only     |
|----------------------|-----------------|--------------|
| Face detection       | ~4 ms/frame     | ~25 ms/frame |
| Embedding (ArcFace)  | ~5 ms/face      | ~30 ms/face  |
| Anti-spoof           | ~3 ms/face      | ~15 ms/face  |
| **Total pipeline**   | **~15–20 ms**   | **~80 ms**   |
| **Effective FPS**    | **~50–65 FPS**  | **~12 FPS**  |

Expected attendance FPS at the kiosk: **20–30 FPS** (detection on every Nth frame).

---

## 9 · Recognition Thresholds Guide

| `SIM_THRESHOLD` | Behaviour                                           |
|-----------------|-----------------------------------------------------|
| 0.4             | Permissive — more matches, higher false positive    |
| **0.6**         | **Balanced — recommended for indoor controlled**    |
| 0.7             | Strict — fewer false positives, more false unknowns |

| `REAL_THRESHOLD` | Anti-spoof strictness                          |
|------------------|------------------------------------------------|
| 0.5              | Lenient — passes some marginal cases           |
| **0.7**          | **Balanced — recommended**                     |
| 0.85             | Strict — rejects marginal lighting conditions  |

---

## 10 · Troubleshooting

**"insightface not found"**
```bash
pip install insightface onnxruntime-gpu
```

**"No CUDA device"**
```bash
# Verify CUDA toolkit is installed
nvcc --version
# Reinstall PyTorch with matching CUDA version
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu121
```

**Anti-spoof model not found**
Download `.pth` files from the Silent-Face-Anti-Spoofing repository and place
them in `models/antispoof/`. See step 2b above.

**Low recognition accuracy**
- Increase `--num_images` during registration (aim for 15–20 varied images).
- Ensure consistent lighting between registration and recognition.
- Lower `SIM_THRESHOLD` slightly (e.g., to 0.55).

**FAISS not installed**
The system falls back to numpy brute-force search automatically.
For large user bases (>500 users), install FAISS for faster search:
```bash
pip install faiss-cpu   # or faiss-gpu
```
