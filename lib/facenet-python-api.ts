/**
 * Face Recognition Python Server API Client
 * Interfaces with Python facenet-server.py for face recognition.
 *
 * Supports:
 * - Legacy single-face and multi-face detection (MTCNN-based, slower)
 * - Real-time multi-face recognition via session cache + fast detection + WebSocket
 */

// Default Railway deployment for the face-recognition backend.
// Override in Vercel/locally via NEXT_PUBLIC_FACENET_API_URL.
const PRODUCTION_URL = 'https://attendance-monitoring-api-production.up.railway.app'
const LOCAL_FALLBACK_URL = process.env.NEXT_PUBLIC_LOCAL_API_URL || 'http://localhost:8000'

// Runtime-mutable — switches to local fallback automatically when Railway is unreachable
let FACENET_API_URL = process.env.NEXT_PUBLIC_FACENET_API_URL || PRODUCTION_URL
let _fallbackActive = false

/** Returns the active WebSocket base URL (derived from current FACENET_API_URL). */
function getWsUrl(): string {
  return FACENET_API_URL.replace(/^https/, 'wss').replace(/^http/, 'ws')
}

/** Switch to the local server. Called automatically on connection failure. */
function activateFallback(): void {
  if (!_fallbackActive && LOCAL_FALLBACK_URL !== FACENET_API_URL) {
    _fallbackActive = true
    FACENET_API_URL = LOCAL_FALLBACK_URL
    console.warn(`⚠️ Railway API unreachable — switched to local fallback: ${LOCAL_FALLBACK_URL}`)
  }
}

/**
 * Reset the active URL back to the primary/production URL.
 * Call this if Railway recovers and you want to switch back.
 */
export function resetToProductionUrl(): void {
  const primaryUrl = process.env.NEXT_PUBLIC_FACENET_API_URL || PRODUCTION_URL
  _fallbackActive = false
  FACENET_API_URL = primaryUrl
  console.log(`🔄 Reset to primary API: ${primaryUrl}`)
}

// ============ Retry helper ============

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/**
 * fetch() wrapper that automatically retries on 503 (model still loading).
 * Uses exponential backoff: 2s, 4s, 8s … up to maxRetries attempts.
 * On network-level failure (Railway down), switches to the local fallback and retries.
 */
async function fetchWithRetry(
  url: string,
  init: RequestInit,
  maxRetries = 6,
  baseDelayMs = 2000
): Promise<Response> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, init)
      if (response.status !== 503) return response

      if (attempt < maxRetries) {
        const delay = baseDelayMs * Math.pow(1.5, attempt)
        console.log(`⏳ Model loading — retrying in ${Math.round(delay / 1000)}s (attempt ${attempt + 1}/${maxRetries})`)
        await sleep(delay)
      }
    } catch (networkError) {
      // Network-level failure (server unreachable) — try local fallback once
      if (!_fallbackActive && LOCAL_FALLBACK_URL !== FACENET_API_URL) {
        activateFallback()
        const fallbackUrl = url.replace(/^https?:\/\/[^/]+/, LOCAL_FALLBACK_URL)
        console.log(`🔄 Retrying with local fallback: ${fallbackUrl}`)
        return fetchWithRetry(fallbackUrl, init, maxRetries, baseDelayMs)
      }
      throw networkError
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
      // server not yet reachable — try local fallback if not already active
      if (!_fallbackActive) {
        activateFallback()
      }
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
  box?: { x: number; y: number; width: number; height: number }
  num_faces?: number
  // Anti-spoofing fields (populated by the face-ml-training server)
  spoofDetected?: boolean
  spoofLabel?: string
  realConfidence?: number
  // Raw snake_case versions as returned directly by the WebSocket stream
  spoof_detected?: boolean
  spoof_label?: string
  real_confidence?: number
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
      // Preserve backend truth: detected=false when no face.
      // This is important for UI state machines that clear the face box.
      detected: Boolean(data.detected),
      embedding: data.embedding ?? undefined,
      embedding_size: data.dimension ?? undefined,
      confidence: data.confidence ?? undefined,
      box: data.box ?? undefined,
      spoofDetected: data.spoof_detected ?? undefined,
      spoofLabel: data.spoof_label ?? undefined,
      realConfidence: data.real_confidence ?? undefined,
      error: data.error ?? undefined,
    }
  } catch (error) {
    console.warn('⚠️ FaceNet extraction error (server may be offline):', error instanceof Error ? error.message : error)
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
    console.warn('⚠️ Video extraction error (server may be offline):', error instanceof Error ? error.message : error)
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
    // Return true only when server is up (model may still be loading)
    // Use waitForModelReady() if you need to wait for full readiness
    return true
  } catch (error) {
    console.warn('⚠️ FaceNet health check failed:', error)
    // Activate local fallback so subsequent calls use localhost
    activateFallback()
    // Retry once against the local fallback
    try {
      const fallbackResponse = await fetch(`${FACENET_API_URL}/health`)
      return fallbackResponse.ok
    } catch {
      return false
    }
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
  // Anti-spoof fields
  spoofDetected?: boolean
  spoofLabel?: string
  realConfidence?: number
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

    const wsUrl = `${getWsUrl()}/ws/recognize`
    console.log(`🔌 Connecting WebSocket to ${wsUrl}`)
    console.log(`   API URL: ${FACENET_API_URL}`)
    console.log(`   WS URL: ${getWsUrl()}`)
    
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
      // If Railway WS is unreachable, activate local fallback so reconnect uses localhost
      if (!_fallbackActive) {
        activateFallback()
      }
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


// ============ Server-Side Camera Stream ============

/**
 * Result from the server camera stream.
 * Contains the raw JPEG frame as a base64 string plus recognition results.
 */
export interface CameraStreamFrame {
  /** Base64-encoded JPEG of the current camera frame (no data URI prefix) */
  frame: string
  /** Frame width in pixels */
  width: number
  /** Frame height in pixels */
  height: number
  /** Recognition or extraction results (depends on mode) */
  results: RecognitionResult | FaceNetEmbedding | null
  /** Monotonically increasing frame counter */
  frame_id: number
  /** Current stream FPS */
  fps: number
  /** Error message if camera failed */
  error?: string
}

export type CameraStreamMode = 'recognize' | 'extract' | 'view'

/**
 * WebSocket-based server-side camera stream.
 *
 * Instead of the browser capturing webcam frames, the Python server
 * captures from the local camera, runs real-time anti-spoofing +
 * face recognition on the raw frames, and streams processed results
 * plus JPEG frames back to the browser.
 *
 * This eliminates the possibility of anti-spoofing bypass through
 * browser-side frame manipulation, since the server controls the
 * camera directly.
 *
 * Usage:
 *   const stream = new ServerCameraStream()
 *   stream.start('recognize', (data) => {
 *     // data.frame = base64 JPEG
 *     // data.results = recognition results
 *   })
 *   // later:
 *   stream.stop()
 */
export class ServerCameraStream {
  private ws: WebSocket | null = null
  private onFrame: ((data: CameraStreamFrame) => void) | null = null
  private onError: ((error: string) => void) | null = null
  private stopped = false
  private mode: CameraStreamMode = 'recognize'
  private jpegQuality = 60
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null

  /**
   * Start the server camera stream.
   *
   * @param mode       Processing mode: 'recognize', 'extract', or 'view'
   * @param onFrame    Called for each frame received from the server
   * @param onError    Called on connection errors
   * @param jpegQuality JPEG quality for the streamed frames (30-95)
   */
  start(
    mode: CameraStreamMode,
    onFrame: (data: CameraStreamFrame) => void,
    onError?: (error: string) => void,
    jpegQuality: number = 60
  ): void {
    this.stopped = false
    this.mode = mode
    this.onFrame = onFrame
    this.onError = onError ?? null
    this.jpegQuality = Math.max(30, Math.min(95, jpegQuality))

    const wsUrl = `${getWsUrl()}/ws/camera-stream`
    console.log(`📹 Connecting to server camera: ${wsUrl} (mode=${mode})`)

    try {
      this.ws = new WebSocket(wsUrl)
    } catch (error) {
      const msg = 'Failed to create WebSocket for camera stream'
      console.error(`❌ ${msg}:`, error)
      this.onError?.(msg)
      return
    }

    this.ws.onopen = () => {
      if (this.stopped) {
        this.ws?.close()
        this.ws = null
        return
      }
      console.log('📹 Server camera connected — sending config')
      // Send initial config
      this.ws!.send(JSON.stringify({
        mode: this.mode,
        jpeg_quality: this.jpegQuality,
      }))
    }

    this.ws.onmessage = (event) => {
      try {
        const data: CameraStreamFrame = JSON.parse(event.data)
        if (data.error) {
          this.onError?.(data.error)
          return
        }
        this.onFrame?.(data)
      } catch {
        // ignore parse errors
      }
    }

    this.ws.onerror = () => {
      // Activate fallback only if not already on local
      if (!_fallbackActive) {
        console.warn('⚠️ Server camera WS error — switching to local fallback')
        activateFallback()
      } else {
        console.error('❌ Server camera WebSocket error (server may not be running)')
      }
      // Don't surface the error immediately — let onclose trigger reconnect first
    }

    this.ws.onclose = (event) => {
      console.log(`📹 Server camera disconnected (code: ${event.code})`)
      if (!this.stopped && this.onFrame) {
        // If this was a Railway→localhost fallback transition, reconnect immediately
        const delay = _fallbackActive ? 500 : 2000
        console.log(`📹 Reconnecting in ${delay}ms...`)
        this.reconnectTimer = setTimeout(() => {
          if (!this.stopped) {
            this.start(this.mode, this.onFrame!, this.onError ?? undefined, this.jpegQuality)
          }
        }, delay)
      }
    }
  }

  /** Switch the processing mode without reconnecting. */
  setMode(mode: CameraStreamMode): void {
    this.mode = mode
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ mode }))
    }
  }

  /** Stop the camera stream. */
  stop(): void {
    this.stopped = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.ws) {
      this.ws.onclose = null
      if (this.ws.readyState === WebSocket.OPEN) {
        try {
          this.ws.send(JSON.stringify({ action: 'stop' }))
        } catch { /* ignore */ }
        this.ws.close()
      }
      this.ws = null
    }
    this.onFrame = null
    this.onError = null
  }

  /** Whether the stream is currently connected. */
  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN
  }
}


// ============ Client-Side (Browser) Camera Stream ============

/**
 * Browser-webcam stream that keeps the same callback contract as ServerCameraStream.
 *
 * - Captures frames from `navigator.mediaDevices.getUserMedia()`.
 * - For `mode='recognize'`, streams frames to `/ws/recognize` and emits results.
 * - For `mode='extract'`, posts frames to `/extract-embedding` and emits embeddings.
 * - For `mode='view'`, emits frames with `results=null`.
 *
 * This lets the UI switch from *server-owned camera* to *client-owned camera*
 * without rewriting the drawing / state-machine logic.
 */
export class ClientCameraStream {
  private ws: WebSocket | null = null
  private onFrame: ((data: CameraStreamFrame) => void) | null = null
  private onError: ((error: string) => void) | null = null
  private stopped = false
  private mode: CameraStreamMode = 'recognize'
  private jpegQuality = 0.7

  private mediaStream: MediaStream | null = null
  private video: HTMLVideoElement | null = null
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D | null = null

  private rafId: number | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null

  private isProcessing = false
  private pendingFrameB64: string | null = null
  private frameId = 0

  // Emit-rate control (keeps CPU/network sane)
  private emitIntervalMs = 100 // ~10 fps
  private lastEmitAt = 0

  // Simple FPS estimate of emitted frames
  private fpsWindowStart = 0
  private fpsFrames = 0
  private fps = 0

  constructor() {
    this.canvas = document.createElement('canvas')
    this.canvas.width = SEND_WIDTH
    this.canvas.height = SEND_HEIGHT
    this.ctx = this.canvas.getContext('2d')
  }

  start(
    mode: CameraStreamMode,
    onFrame: (data: CameraStreamFrame) => void,
    onError?: (error: string) => void,
    jpegQuality: number = 60,
  ): void {
    this.stopped = false
    this.mode = mode
    this.onFrame = onFrame
    this.onError = onError ?? null
    // Match ServerCameraStream's 30-95 scale to canvas.toDataURL's 0..1
    const q = Math.max(30, Math.min(95, jpegQuality))
    this.jpegQuality = q / 100

    void this.ensureCamera()
      .then(() => this.connectIfNeeded())
      .then(() => this.startLoop())
      .catch((err) => {
        const msg = err instanceof Error ? err.message : 'Failed to start client camera'
        console.error('❌ ClientCameraStream start failed:', err)
        this.onError?.(msg)
      })
  }

  /** Switch mode without re-requesting camera permission. */
  setMode(mode: CameraStreamMode): void {
    this.mode = mode
    // Recognize uses WS; other modes don't.
    if (mode !== 'recognize') {
      this.closeWs()
    } else {
      void this.connectIfNeeded()
    }
  }

  stop(): void {
    this.stopped = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.rafId) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
    this.closeWs()

    if (this.mediaStream) {
      for (const track of this.mediaStream.getTracks()) {
        try { track.stop() } catch { /* ignore */ }
      }
    }
    this.mediaStream = null
    this.video = null
    this.onFrame = null
    this.onError = null
    this.isProcessing = false
    this.pendingFrameB64 = null
  }

  get connected(): boolean {
    // Camera is the primary dependency; WS is only required for recognize.
    if (!this.mediaStream) return false
    if (this.mode === 'recognize') return this.ws?.readyState === WebSocket.OPEN
    return true
  }

  private async ensureCamera(): Promise<void> {
    if (this.mediaStream && this.video) return
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Camera API not available in this browser')
    }

    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'user',
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    })

    const video = document.createElement('video')
    video.playsInline = true
    video.muted = true
    video.autoplay = true
    video.srcObject = this.mediaStream
    this.video = video

    await new Promise<void>((resolve, reject) => {
      const onLoaded = () => {
        video.removeEventListener('loadedmetadata', onLoaded)
        resolve()
      }
      const onError = () => {
        video.removeEventListener('error', onError)
        reject(new Error('Failed to load camera stream'))
      }
      video.addEventListener('loadedmetadata', onLoaded)
      video.addEventListener('error', onError)
    })

    try {
      await video.play()
    } catch {
      // Some browsers require a user gesture. The stream still exists, so we continue.
    }
  }

  private connectIfNeeded(): void | Promise<void> {
    if (this.mode !== 'recognize') return
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return
    this.openWs()
  }

  private openWs(): void {
    const wsUrl = `${getWsUrl()}/ws/recognize`
    console.log(`🎥 Connecting client camera WS: ${wsUrl} (mode=${this.mode})`)

    try {
      this.ws = new WebSocket(wsUrl)
    } catch (error) {
      const msg = 'Failed to create WebSocket for /ws/recognize'
      console.error(`❌ ${msg}:`, error)
      this.onError?.(msg)
      return
    }

    this.ws.onopen = () => {
      if (this.stopped) {
        this.closeWs()
        return
      }
      console.log('🎥 Client camera WS connected')
    }

    this.ws.onmessage = (event) => {
      this.isProcessing = false
      try {
        const results: RecognitionResult = JSON.parse(event.data)
        const frame = this.pendingFrameB64
        this.pendingFrameB64 = null
        if (!frame) return
        this.emitFrame(frame, SEND_WIDTH, SEND_HEIGHT, results)
      } catch {
        // ignore parse errors
      }
    }

    this.ws.onerror = () => {
      // If Railway WS is unreachable, activate local fallback so reconnect uses localhost
      if (!_fallbackActive) {
        console.warn('⚠️ Client camera WS error — switching to local fallback')
        activateFallback()
      }
    }

    this.ws.onclose = (event) => {
      if (this.stopped) return
      if (this.mode !== 'recognize') return

      console.log(`🎥 Client camera WS closed (code: ${event.code})`)
      // Auto-reconnect (mirrors ServerCameraStream behavior)
      const delay = _fallbackActive ? 500 : 2000
      this.reconnectTimer = setTimeout(() => {
        if (!this.stopped && this.mode === 'recognize') {
          this.openWs()
        }
      }, delay)
    }
  }

  private closeWs(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (!this.ws) return
    this.ws.onclose = null
    if (this.ws.readyState === WebSocket.OPEN) {
      try { this.ws.close() } catch { /* ignore */ }
    }
    this.ws = null
    this.isProcessing = false
    this.pendingFrameB64 = null
  }

  private startLoop(): void {
    this.fpsWindowStart = performance.now()
    this.fpsFrames = 0
    this.fps = 0
    this.lastEmitAt = 0

    const tick = () => {
      if (this.stopped) return
      this.rafId = requestAnimationFrame(tick)

      const now = performance.now()
      if (now - this.lastEmitAt < this.emitIntervalMs) return

      if (!this.video || !this.ctx) return
      // Draw downscaled frame
      this.ctx.drawImage(this.video, 0, 0, SEND_WIDTH, SEND_HEIGHT)
      const dataUrl = this.canvas.toDataURL('image/jpeg', this.jpegQuality)
      const frameB64 = dataUrl.split(',', 2)[1] || ''

      if (this.mode === 'view') {
        this.lastEmitAt = now
        this.emitFrame(frameB64, SEND_WIDTH, SEND_HEIGHT, null)
        return
      }

      if (this.mode === 'extract') {
        if (this.isProcessing) return
        this.isProcessing = true
        this.lastEmitAt = now
        void extractFaceNetEmbedding(dataUrl)
          .then((results) => {
            this.emitFrame(frameB64, SEND_WIDTH, SEND_HEIGHT, results)
          })
          .catch((err) => {
            const msg = err instanceof Error ? err.message : 'Extraction failed'
            this.onError?.(msg)
          })
          .finally(() => {
            this.isProcessing = false
          })
        return
      }

      // recognize
      if (this.mode === 'recognize') {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return
        if (this.isProcessing) return
        this.isProcessing = true
        this.lastEmitAt = now
        this.pendingFrameB64 = frameB64
        try {
          this.ws.send(JSON.stringify({ image: dataUrl }))
        } catch {
          this.isProcessing = false
          this.pendingFrameB64 = null
        }
      }
    }

    this.rafId = requestAnimationFrame(tick)
  }

  private emitFrame(
    frame: string,
    width: number,
    height: number,
    results: RecognitionResult | FaceNetEmbedding | null,
  ): void {
    const now = performance.now()
    if (!this.fpsWindowStart) this.fpsWindowStart = now
    this.fpsFrames += 1
    const elapsed = now - this.fpsWindowStart
    if (elapsed >= 1000) {
      this.fps = Math.round((this.fpsFrames * 1000) / elapsed)
      this.fpsFrames = 0
      this.fpsWindowStart = now
    }

    const payload: CameraStreamFrame = {
      frame,
      width,
      height,
      results,
      frame_id: ++this.frameId,
      fps: this.fps,
    }
    this.onFrame?.(payload)
  }
}
