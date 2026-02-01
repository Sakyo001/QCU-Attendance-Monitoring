# FaceNet Python Server Integration

## Overview

The system now uses **keras-facenet** (Python) for face recognition instead of browser-based face-api.js. This provides:

- **512D embeddings** (vs 128D browser-based)
- **Higher accuracy** using Keras FaceNet model
- **70% similarity threshold** (same security level)
- **Server-side processing** for better performance

## Setup Instructions

### 1. Install Python Dependencies

```bash
pip install -r requirements-facenet.txt
```

This installs:
- `keras-facenet==0.3.2` - FaceNet model
- `tensorflow==2.14.0` - Backend
- `opencv-python` - Image processing
- `fastapi` & `uvicorn` - API server

### 2. Start the FaceNet Server

```bash
python facenet-server.py
```

You should see:
```
============================================================
🚀 Starting FaceNet Face Recognition API Server
============================================================
📍 URL: http://localhost:8000
📖 Docs: http://localhost:8000/docs
🔧 Model: keras-facenet (FaceNet)
🎯 Embedding Size: 512 dimensions
📊 Threshold: 70% cosine similarity
============================================================
```

**Keep this terminal running!**

### 3. Start Next.js App

In another terminal:

```bash
npm run dev
```

## Architecture

```
┌─────────────────┐
│   Next.js App   │
│   (Frontend)    │
└────────┬────────┘
         │
         │ HTTP API Calls
         │ (base64 images)
         ▼
┌─────────────────┐
│ Python Server   │
│ facenet-server  │
│   Port 8000     │
└────────┬────────┘
         │
         │ Face Processing
         ▼
┌─────────────────┐
│  keras-facenet  │
│  (FaceNet)      │
│  512D embeddings│
└─────────────────┘
```

## What Changed?

### Before (Browser FaceNet):
- **128D embeddings** from face-api.js
- **Browser processing** (slower, limited models)
- **Models downloaded** to browser (~8MB)
- **70% threshold**

### After (Python FaceNet):
- **512D embeddings** from keras-facenet
- **Server processing** (faster, better models)
- **No browser downloads** (models on server)
- **70% threshold** (same security)

## Database Schema

Both tables now store **512D embeddings**:

### student_face_registrations
- `face_descriptor` JSONB - 512-element array

### professor_face_registrations  
- `face_descriptor` JSONB - 512-element array

## API Endpoints

### Python Server (Port 8000)

**POST** `/extract-embedding`
- Input: `{ "image": "base64..." }`
- Output: `{ "detected": true, "embedding": [...512 floats], "confidence": 0.95 }`

**POST** `/verify`
- Input: `{ "image": "base64...", "stored_embedding": [...512 floats] }`
- Output: `{ "verified": true, "similarity": 0.85, "confidence": 85.0 }`

**POST** `/health`
- Output: `{ "status": "healthy", "model": "keras-facenet" }`

### Next.js API (Port 3000)

**POST** `/api/professor/face-registration/register`
- Expects 512D array in `faceDescriptor`
- Saves to `professor_face_registrations` table

**POST** `/api/professor/face-registration/verify`
- Validates 512D arrays
- Uses cosine similarity with 70% threshold

## Testing

1. **Register a face:**
   - Go to professor attendance page
   - Click "Register Face"
   - Capture your face (3 frames required)
   - Check console: should show "512 dimensions"

2. **Verify face:**
   - Try entering classroom with face verification
   - Should capture 3 frames
   - Check console for similarity scores

3. **Check logs:**
   - Python server terminal: see embedding extractions
   - Browser console: see verification results

## Troubleshooting

### "FaceNet Python server is not responding"
- Make sure `python facenet-server.py` is running
- Check port 8000 is not blocked
- Verify `.env.local` has `NEXT_PUBLIC_FACENET_API_URL=http://localhost:8000`

### "No face detected"
- Improve lighting
- Face camera directly
- Remove glasses/masks if possible
- Check webcam permissions

### "Invalid face descriptor: expected 512"
- Server not running - start `python facenet-server.py`
- Old data in database - re-register faces
- Check server logs for errors

### TensorFlow warnings
- Safe to ignore most TensorFlow info messages
- If you see CUDA warnings, that's normal (using CPU mode)

## Performance Tips

- **First run**: Model download takes 1-2 minutes
- **CPU mode**: ~1-2 seconds per face extraction
- **GPU mode**: Change `ctx_id=-1` to `ctx_id=0` in server (requires CUDA)

## Migration from Old Data

Existing registrations with 128D embeddings need to be re-registered:

1. All professors must re-register faces
2. All students must re-register faces
3. Old 128D embeddings won't work with new 512D system

## Security

✅ **Multi-capture validation** - 3 frames required  
✅ **Diversity checks** - Minimum 2.0 difference threshold  
✅ **Variance checks** - Detects synthetic/manipulated faces  
✅ **Confidence scores** - Face detection quality  
✅ **Server-side processing** - More secure than browser  

## Benefits

- **Better accuracy** - keras-facenet is state-of-the-art
- **More secure** - 512D embeddings harder to spoof
- **Faster processing** - Server has more compute power
- **Consistent results** - Same model for all users
- **Easy updates** - Update model on server only
