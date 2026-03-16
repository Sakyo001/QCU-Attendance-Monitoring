'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import {
  ClientCameraStream,
  type CameraStreamFrame,
  type CameraStreamMode,
  type RecognitionResult,
  type FaceNetEmbedding,
} from '@/lib/facenet-python-api'

export interface UseServerCameraOptions {
  /** Processing mode: 'recognize', 'extract', or 'view' */
  mode: CameraStreamMode
  /** Whether the camera should be active */
  enabled?: boolean
  /** Whether to mirror the display horizontally */
  mirror?: boolean
  /** JPEG quality for the stream (30-95) */
  jpegQuality?: number
  /** Called for each frame with results */
  onResults?: (results: RecognitionResult | FaceNetEmbedding | null, frame: CameraStreamFrame) => void
  /** Called on connection error */
  onError?: (error: string) => void
}

/**
 * Hook that connects to the Python server's camera stream.
 *
 * Returns a canvas ref that should be attached to a <canvas> element.
 * The hook draws each received frame onto that canvas, optionally mirrored.
 *
 * The Python server owns the camera — frames are captured, processed
 * (anti-spoofing + recognition), and streamed as JPEG over WebSocket.
 */
export function useServerCamera({
  mode,
  enabled = true,
  mirror = true,
  jpegQuality = 60,
  onResults,
  onError,
}: UseServerCameraOptions) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<ClientCameraStream | null>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const rafRef = useRef<number>(0)
  const pendingFrameRef = useRef<CameraStreamFrame | null>(null)
  const connectedRef = useRef(false)
  const [connected, setConnected] = useState(false)
  const [fps, setFps] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [frameSize, setFrameSize] = useState<{ width: number; height: number }>({ width: 640, height: 480 })

  // Stable callback refs
  const onResultsRef = useRef(onResults)
  const onErrorRef = useRef(onError)
  onResultsRef.current = onResults
  onErrorRef.current = onError

  // Throttled FPS update — once per second instead of every frame
  const lastFpsUpdateRef = useRef(0)

  // Persistent Image for frame decoding
  useEffect(() => {
    imgRef.current = new Image()
    return () => { imgRef.current = null }
  }, [])

  // Draw frame to canvas using requestAnimationFrame
  const drawFrame = useCallback((data: CameraStreamFrame) => {
    const canvas = canvasRef.current
    const img = imgRef.current
    if (!canvas || !img) return

    const { width, height } = data

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width
      canvas.height = height
      setFrameSize({ width, height })
    }

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    img.onload = () => {
      ctx.save()
      if (mirror) {
        ctx.translate(width, 0)
        ctx.scale(-1, 1)
      }
      ctx.drawImage(img, 0, 0, width, height)
      ctx.restore()
    }
    img.src = `data:image/jpeg;base64,${data.frame}`
  }, [mirror])

  // rAF loop — only draws the latest pending frame
  useEffect(() => {
    let running = true
    const tick = () => {
      if (!running) return
      const frame = pendingFrameRef.current
      if (frame) {
        pendingFrameRef.current = null
        drawFrame(frame)
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      running = false
      cancelAnimationFrame(rafRef.current)
    }
  }, [drawFrame])

  // Connect / disconnect
  useEffect(() => {
    if (!enabled) {
      streamRef.current?.stop()
      streamRef.current = null
      setConnected(false)
      connectedRef.current = false
      return
    }

    const stream = new ClientCameraStream()
    streamRef.current = stream

    stream.start(
      mode,
      (data: CameraStreamFrame) => {
        if (!connectedRef.current) {
          connectedRef.current = true
          setConnected(true)
          setError(null)
        }
        // Throttle FPS state to once per second
        const now = performance.now()
        if (now - lastFpsUpdateRef.current > 1000) {
          lastFpsUpdateRef.current = now
          setFps(data.fps)
        }
        // Queue frame for rAF rendering (drop stale frames)
        pendingFrameRef.current = data
        // Forward results immediately (don't wait for rAF)
        if (data.results) {
          onResultsRef.current?.(data.results, data)
        }
      },
      (errMsg: string) => {
        setError(errMsg)
        setConnected(false)
        connectedRef.current = false
        onErrorRef.current?.(errMsg)
      },
      jpegQuality,
    )

    return () => {
      stream.stop()
      streamRef.current = null
      setConnected(false)
      connectedRef.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, jpegQuality])

  // Handle mode switch without reconnecting
  useEffect(() => {
    streamRef.current?.setMode(mode)
  }, [mode])

  return {
    /** Attach to a <canvas> element to display the camera feed */
    canvasRef,
    /** Whether the stream is connected */
    connected,
    /** Current stream FPS */
    fps,
    /** Connection error message, or null */
    error,
    /** Current frame dimensions */
    frameSize,
    /** Stop the stream manually */
    stop: useCallback(() => {
      streamRef.current?.stop()
      streamRef.current = null
      setConnected(false)
    }, []),
  }
}
