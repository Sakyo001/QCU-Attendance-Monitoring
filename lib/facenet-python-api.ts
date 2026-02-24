/**
 * Face Recognition Python Server API Client
 * Interfaces with Python facenet-server.py for face recognition.
 *
 * Supports:
 * - Legacy single-face and multi-face detection (MTCNN-based, slower)
 * - Real-time multi-face recognition via session cache + fast detection + WebSocket
 */

const PRODUCTION_URL = 'https://qcu-attendance-monitoring-production.up.railway.app'
const FACENET_API_URL = process.env.NEXT_PUBLIC_FACENET_API_URL || PRODUCTION_URL
const FACENET_WS_URL = FACENET_API_URL.replace(/^https/, 'wss').replace(/^http/, 'ws')

// ============ Retry helper ============

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/**
 * fetch() wrapper that automatically retries on 503 (model still loading).
 * Uses exponential backoff: 2s, 4s, 8s … up to maxRetries attempts.
 */
async function fetchWithRetry(
  url: string,
  init: RequestInit,
  maxRetries = 6,
  baseDelayMs = 2000
): Promise<Response> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, init)
    if (response.status !== 503) return response

    if (attempt < maxRetries) {
      const delay = baseDelayMs * Math.pow(1.5, attempt)
      console.log(`⏳ Model loading — retrying in ${Math.round(delay / 1000)}s (attempt ${attempt + 1}/${maxRetries})`)
      await sleep(delay)
    }
  }
  // Return the last 503 response so callers can handle it
  return fetch(url, init)
}

/**
 * Poll /health until the model is ready or timeout is reached.
 * Useful to call once on page load before kicking off recognition.
 *
 * @param timeoutMs  Total time to wait (default 120s)
 * @param intervalMs Poll interval (default 3s)
 * @returns true if model became ready, false on timeout
 */
export async function waitForModelReady(
  timeoutMs = 120_000,
  intervalMs = 3_000
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${FACENET_API_URL}/health`)
      if (res.ok) {
        const data = await res.json()
        if (data.ready === true) {
          console.log('✅ FaceNet model ready')
          return true
        }
        console.log(`⏳ Model loading… (status: ${data.status})`)
      }
    } catch {
      // server not yet reachable — keep polling
    }
    await sleep(intervalMs)
  }
  console.warn('⚠️ waitForModelReady timed out')
  return false
}

export interface FaceNetEmbedding {
  detected: boolean
  embedding?: number[]
  embedding_size?: number
  confidence?: number
  box?: number[]
  num_faces?: number
  error?: string
}

export interface MultiFaceResult {
  detected: boolean
  faces: DetectedFace[]
  num_faces: number
  processing_time_ms?: number
  error?: string
}

export interface DetectedFace {
  index: number
  embedding: number[]
  embedding_size: number
  box: {
    left: number
    top: number
    right: number
    bottom: number
    width: number
    height: number
  }
}

export interface FaceNetVerification {
  verified: boolean
  similarity: number
  threshold: number
  confidence: number
  face_confidence?: number
  error?: string
}

/**
 * Extract face embedding from base64 image
 */
export async function extractFaceNetEmbedding(
  base64Image: string
): Promise<FaceNetEmbedding> {
  try {
    const response = await fetchWithRetry(`${FACENET_API_URL}/extract-embedding`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ image: base64Image }),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.detail || `API error: ${response.status}`)
    }

    const data = await response.json()
    return {
      detected: true,
      embedding: data.embedding,
      embedding_size: data.dimension,
      confidence: data.confidence
    }
  } catch (error) {
    console.error('❌ FaceNet extraction error:', error)
    return {
      detected: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

/**
 * Extract face embedding from video element
 */
export async function extractFaceNetFromVideo(
  videoElement: HTMLVideoElement
): Promise<FaceNetEmbedding> {
  try {
    // Create canvas and capture current frame
    const canvas = document.createElement('canvas')
    canvas.width = videoElement.videoWidth
    canvas.height = videoElement.videoHeight
    
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      throw new Error('Failed to get canvas context')
    }
    
    // Draw video frame to canvas
    ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height)
    
    // Convert to base64
    const base64Image = canvas.toDataURL('image/jpeg', 0.95)
    
    // Extract embedding via API
    return await extractFaceNetEmbedding(base64Image)
  } catch (error) {
    console.error('❌ Video extraction error:', error)
    return {
      detected: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

/**
 * Verify captured face against stored embedding
 */
export async function verifyFaceNetEmbedding(
  base64Image: string,
  storedEmbedding: number[]
): Promise<FaceNetVerification> {
  try {
    const response = await fetchWithRetry(`${FACENET_API_URL}/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        image: base64Image,
        stored_embedding: storedEmbedding,
      }),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.detail || `API error: ${response.status}`)
    }

    const data = await response.json()
    return data
  } catch (error) {
    console.error('❌ FaceNet verification error:', error)
    return {
      verified: false,
      similarity: 0,
      threshold: 0.70,
      confidence: 0,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

/**
 * Compare two embeddings
 */
export async function compareFaceNetEmbeddings(
  embedding1: number[],
  embedding2: number[]
): Promise<{ similarity: number; match: boolean; confidence: number }> {
  try {
    const response = await fetchWithRetry(`${FACENET_API_URL}/compare-embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        embedding1,
        embedding2,
      }),
    })

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`)
    }

    const data = await response.json()
    return data
  } catch (error) {
    console.error('❌ FaceNet comparison error:', error)
    throw error
  }
}

/**
 * Extract embeddings for ALL faces detected in a base64 image.
 * Returns an array of faces with their embeddings and bounding boxes.
 */
export async function extractMultipleFaceEmbeddings(
  base64Image: string
): Promise<MultiFaceResult> {
  try {
    const response = await fetchWithRetry(`${FACENET_API_URL}/extract-multiple-embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: base64Image }),
    })

    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.detail || `API error: ${response.status}`)
    }

    const data = await response.json()
    return {
      detected: data.detected,
      faces: data.faces || [],
      num_faces: data.num_faces || 0,
      processing_time_ms: data.processing_time_ms
    }
  } catch (error) {
    console.error('❌ Multi-face extraction error:', error)
    return {
      detected: false,
      faces: [],
      num_faces: 0,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

/**
 * Extract multiple face embeddings from a video element.
 * Captures the current frame and sends it for multi-face detection.
 */
export async function extractMultipleFacesFromVideo(
  videoElement: HTMLVideoElement
): Promise<MultiFaceResult> {
  try {
    const canvas = document.createElement('canvas')
    canvas.width = videoElement.videoWidth
    canvas.height = videoElement.videoHeight

    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Failed to get canvas context')

    ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height)
    const base64Image = canvas.toDataURL('image/jpeg', 0.95)

    return await extractMultipleFaceEmbeddings(base64Image)
  } catch (error) {
    console.error('❌ Multi-face video extraction error:', error)
    return {
      detected: false,
      faces: [],
      num_faces: 0,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

/**
 * Check if FaceNet server is healthy
 */
export async function checkFaceNetHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${FACENET_API_URL}/health`)
    if (!response.ok) return false
    const data = await response.json()
    // Return true only when server is up (model may still be loading)
    // Use waitForModelReady() if you need to wait for full readiness
    return true
  } catch (error) {
    console.error('❌ FaceNet health check failed:', error)
    return false
  }
}


// ============ Real-Time Recognition Types ============

export interface FaceBox {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

export interface RecognizedFace {
  index: number
  matched: boolean
  studentId?: string
  name: string
  studentNumber?: string
  confidence: number | null
  box: FaceBox
}

export interface RecognitionResult {
  detected: boolean
  faces: RecognizedFace[]
  num_faces: number
  processing_time_ms?: number
  error?: string
}

// ============ Session Management ============

/**
 * Load enrolled student face descriptors into the Python server's memory
 * for fast in-memory matching during real-time recognition.
 * Call this once when a class session starts.
 */
export async function loadSessionEncodings(
  sectionId: string,
  students: Array<{ id: string; name: string; student_number?: string; embedding: number[] }>
): Promise<boolean> {
  try {
    const response = await fetchWithRetry(`${FACENET_API_URL}/load-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sectionId, students }),
    })
    const data = await response.json()
    console.log(`📚 Session loaded: ${data.students_loaded} students`)
    return data.success === true
  } catch (error) {
    console.error('❌ Failed to load session encodings:', error)
    return false
  }
}

/**
 * Clear the Python server's session cache.
 */
export async function clearSessionEncodings(): Promise<void> {
  try {
    await fetch(`${FACENET_API_URL}/clear-session`, { method: 'POST' })
  } catch {
    // ignore
  }
}

// ============ HTTP Recognize (fallback) ============

/** Resolution to downscale frames to before sending to the server */
const SEND_WIDTH = 640
const SEND_HEIGHT = 480

/**
 * Single-call frame recognition via HTTP POST.
 * Captures video frame, downscales to 640x480, sends to /recognize-frame.
 * Scales returned box coordinates back to the video's native resolution.
 */
export async function recognizeFrameFromVideo(
  videoElement: HTMLVideoElement
): Promise<RecognitionResult> {
  try {
    const canvas = document.createElement('canvas')
    canvas.width = SEND_WIDTH
    canvas.height = SEND_HEIGHT
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('No canvas context')

    ctx.drawImage(videoElement, 0, 0, SEND_WIDTH, SEND_HEIGHT)
    const base64 = canvas.toDataURL('image/jpeg', 0.7)

    const response = await fetchWithRetry(`${FACENET_API_URL}/recognize-frame`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: base64 }),
    })

    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const result: RecognitionResult = await response.json()

    // Scale box coordinates from SEND resolution back to video native resolution
    const scaleX = videoElement.videoWidth / SEND_WIDTH
    const scaleY = videoElement.videoHeight / SEND_HEIGHT
    for (const face of result.faces) {
      if (face.box) {
        face.box.left = Math.round(face.box.left * scaleX)
        face.box.top = Math.round(face.box.top * scaleY)
        face.box.right = Math.round(face.box.right * scaleX)
        face.box.bottom = Math.round(face.box.bottom * scaleY)
        face.box.width = Math.round(face.box.width * scaleX)
        face.box.height = Math.round(face.box.height * scaleY)
      }
    }

    return result
  } catch (error) {
    return {
      detected: false,
      faces: [],
      num_faces: 0,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

// ============ WebSocket Real-Time Recognizer ============

/**
 * WebSocket-based real-time face recognizer.
 *
 * Uses natural backpressure: only sends a new frame after receiving
 * the result for the previous one. This gives maximum throughput
 * without frame queuing (~5-10 fps depending on server speed).
 *
 * Usage:
 *   const recognizer = new RealtimeRecognizer()
 *   recognizer.start(videoElement, (result) => { ... })
 *   // later:
 *   recognizer.stop()
 */
export class RealtimeRecognizer {
  private ws: WebSocket | null = null
  private isProcessing = false
  private animationId: number | null = null
  private videoElement: HTMLVideoElement | null = null
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D | null = null
  private onResult: ((result: RecognitionResult) => void) | null = null
  private stopped = false
  private videoScaleX = 1
  private videoScaleY = 1

  constructor() {
    this.canvas = document.createElement('canvas')
    this.canvas.width = SEND_WIDTH
    this.canvas.height = SEND_HEIGHT
    this.ctx = this.canvas.getContext('2d')
  }

  /**
   * Start real-time recognition.
   * Opens a WebSocket to the Python server and begins streaming frames.
   */
  start(
    videoElement: HTMLVideoElement,
    onResult: (result: RecognitionResult) => void
  ): void {
    this.stopped = false
    this.videoElement = videoElement
    this.onResult = onResult
    this.videoScaleX = videoElement.videoWidth / SEND_WIDTH
    this.videoScaleY = videoElement.videoHeight / SEND_HEIGHT

    const wsUrl = `${FACENET_WS_URL}/ws/recognize`
    console.log(`🔌 Connecting WebSocket to ${wsUrl}`)
    console.log(`   API URL: ${FACENET_API_URL}`)
    console.log(`   WS URL: ${FACENET_WS_URL}`)
    
    try {
      this.ws = new WebSocket(wsUrl)
    } catch (error) {
      console.error('❌ Failed to create WebSocket:', error)
      console.error('   Make sure Python server is running: python facenet-server.py')
      return
    }

    this.ws.onopen = () => {
      // If stop() was called while we were still connecting, close cleanly now
      if (this.stopped) {
        this.ws?.close()
        this.ws = null
        return
      }
      console.log('✅ WebSocket connected — starting real-time recognition')
      this.sendLoop()
    }

    this.ws.onmessage = (event) => {
      this.isProcessing = false
      try {
        const result: RecognitionResult = JSON.parse(event.data)
        // Scale box coordinates back to video's native resolution
        if (result.faces) {
          for (const face of result.faces) {
            if (face.box) {
              face.box.left = Math.round(face.box.left * this.videoScaleX)
              face.box.top = Math.round(face.box.top * this.videoScaleY)
              face.box.right = Math.round(face.box.right * this.videoScaleX)
              face.box.bottom = Math.round(face.box.bottom * this.videoScaleY)
              face.box.width = Math.round(face.box.width * this.videoScaleX)
              face.box.height = Math.round(face.box.height * this.videoScaleY)
            }
          }
        }
        this.onResult?.(result)
      } catch {
        // ignore parse errors
      }
    }

    this.ws.onerror = () => {
      console.error('❌ WebSocket connection error')
      console.error('   Possible causes:')
      console.error('   - Python server not running (start with: python facenet-server.py)')
      console.error('   - Server running on different port')
      console.error('   - CORS or firewall blocking connection')
    }

    this.ws.onclose = (event) => {
      console.log(`🔌 WebSocket closed (code: ${event.code}, reason: ${event.reason || 'none'})`)
      // Auto-reconnect if not explicitly stopped and close wasn't clean
      if (!this.stopped && this.videoElement && this.onResult) {
        if (event.code === 1006) {
          console.error('❌ Abnormal closure - server may be down')
        }
        console.log('🔌 Reconnecting in 2s...')
        setTimeout(() => {
          if (!this.stopped) this.start(this.videoElement!, this.onResult!)
        }, 2000)
      }
    }
  }

  private sendLoop = (): void => {
    if (this.stopped || !this.ws || this.ws.readyState !== WebSocket.OPEN || !this.videoElement) {
      return
    }

    if (!this.isProcessing && this.ctx) {
      this.isProcessing = true
      this.ctx.drawImage(this.videoElement, 0, 0, SEND_WIDTH, SEND_HEIGHT)
      const base64 = this.canvas.toDataURL('image/jpeg', 0.7)
      try {
        this.ws.send(JSON.stringify({ image: base64 }))
      } catch {
        this.isProcessing = false
      }
    }

    this.animationId = requestAnimationFrame(this.sendLoop)
  }

  /** Stop recognition and close the WebSocket. */
  stop(): void {
    this.stopped = true
    if (this.animationId) {
      cancelAnimationFrame(this.animationId)
      this.animationId = null
    }
    if (this.ws) {
      this.ws.onclose = null // prevent auto-reconnect
      // Only call close() when already open — calling it on a CONNECTING socket
      // triggers the "WebSocket closed before connection was established" browser warning.
      // For CONNECTING sockets, onopen will detect stopped=true and close cleanly.
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.close()
      }
      this.ws = null
    }
    this.videoElement = null
    this.onResult = null
    this.isProcessing = false
  }
}
