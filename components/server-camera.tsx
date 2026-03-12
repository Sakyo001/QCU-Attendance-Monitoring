'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { ServerCameraStream, type CameraStreamFrame, type CameraStreamMode, type RecognitionResult, type FaceNetEmbedding } from '@/lib/facenet-python-api'

export interface ServerCameraProps {
  /** Processing mode: 'recognize' (detect+match), 'extract' (detect+embed), 'view' (no processing) */
  mode: CameraStreamMode
  /** Called for each frame with recognition/extraction results */
  onResults?: (results: RecognitionResult | FaceNetEmbedding | null) => void
  /** Called with each raw frame for custom overlays */
  onFrame?: (data: CameraStreamFrame) => void
  /** Called on connection errors */
  onError?: (error: string) => void
  /** Called when connection state changes */
  onConnectionChange?: (connected: boolean) => void
  /** Whether to draw bounding boxes and labels on the canvas */
  drawOverlays?: boolean
  /** Whether to mirror the display horizontally */
  mirror?: boolean
  /** JPEG quality for the stream (30-95, default 70) */
  jpegQuality?: number
  /** CSS class for the container */
  className?: string
  /** Inline styles for the container */
  style?: React.CSSProperties
}

/**
 * ServerCamera component — displays a live camera feed from the Python server.
 *
 * The Python server captures from the local webcam, runs anti-spoofing +
 * face recognition, and streams processed frames to this component via
 * WebSocket. The browser never touches the camera directly.
 */
export default function ServerCamera({
  mode,
  onResults,
  onFrame,
  onError,
  onConnectionChange,
  drawOverlays = true,
  mirror = true,
  jpegQuality = 60,
  className,
  style,
}: ServerCameraProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<ServerCameraStream | null>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const [connected, setConnected] = useState(false)
  const [fps, setFps] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const latestResultsRef = useRef<RecognitionResult | FaceNetEmbedding | null>(null)

  const connectedRef = useRef(false)
  const pendingFrameRef = useRef<CameraStreamFrame | null>(null)
  const rafRef = useRef<number>(0)
  const lastFpsUpdateRef = useRef(0)

  // Stable refs for callbacks so we don't reconnect on every render
  const onResultsRef = useRef(onResults)
  const onFrameRef = useRef(onFrame)
  const onErrorRef = useRef(onError)
  const onConnectionChangeRef = useRef(onConnectionChange)
  onResultsRef.current = onResults
  onFrameRef.current = onFrame
  onErrorRef.current = onError
  onConnectionChangeRef.current = onConnectionChange

  // Create persistent Image object for decoding frames
  useEffect(() => {
    imgRef.current = new Image()
    return () => { imgRef.current = null }
  }, [])

  const drawFrame = useCallback((frameB64: string, results: RecognitionResult | FaceNetEmbedding | null, width: number, height: number) => {
    const canvas = canvasRef.current
    const img = imgRef.current
    if (!canvas || !img) return

    // Set canvas dimensions to match stream
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width
      canvas.height = height
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

      // Draw overlays
      if (drawOverlays && results && 'faces' in results && results.faces) {
        for (const face of results.faces) {
          if (!face.box) continue
          let { left, top, right, bottom } = face.box
          // Mirror box coordinates if display is mirrored
          if (mirror) {
            const mirroredLeft = width - right
            const mirroredRight = width - left
            left = mirroredLeft
            right = mirroredRight
          }
          const bw = right - left
          const bh = bottom - top

          // Choose color based on state
          let color = '#ef4444' // red = unknown
          if (face.spoofDetected) {
            color = '#f97316' // orange = spoof
          } else if (face.matched) {
            color = '#22c55e' // green = recognized
          }

          // Box
          ctx.strokeStyle = color
          ctx.lineWidth = 2
          ctx.strokeRect(left, top, bw, bh)

          // Corner brackets
          const cornerLen = Math.min(20, bw / 4, bh / 4)
          ctx.lineWidth = 3
          ctx.strokeStyle = color
          // Top-left
          ctx.beginPath(); ctx.moveTo(left, top + cornerLen); ctx.lineTo(left, top); ctx.lineTo(left + cornerLen, top); ctx.stroke()
          // Top-right
          ctx.beginPath(); ctx.moveTo(right - cornerLen, top); ctx.lineTo(right, top); ctx.lineTo(right, top + cornerLen); ctx.stroke()
          // Bottom-left
          ctx.beginPath(); ctx.moveTo(left, bottom - cornerLen); ctx.lineTo(left, bottom); ctx.lineTo(left + cornerLen, bottom); ctx.stroke()
          // Bottom-right
          ctx.beginPath(); ctx.moveTo(right - cornerLen, bottom); ctx.lineTo(right, bottom); ctx.lineTo(right, bottom - cornerLen); ctx.stroke()

          // Label
          let label = 'Unknown'
          if (face.spoofDetected) {
            label = '⚠ SPOOF'
          } else if (face.matched && face.name) {
            const conf = face.confidence ? ` ${Math.round(face.confidence * 100)}%` : ''
            label = `${face.name}${conf}`
          }

          ctx.font = '14px sans-serif'
          const textMetrics = ctx.measureText(label)
          const textH = 20
          const textX = left
          const textY = top - textH - 4

          ctx.fillStyle = color
          ctx.fillRect(textX, textY, textMetrics.width + 8, textH)
          ctx.fillStyle = '#ffffff'
          ctx.fillText(label, textX + 4, textY + 15)
        }
      }

      // Draw spoof indicator for extract mode
      if (drawOverlays && results && 'spoof_detected' in results && results.spoof_detected) {
        ctx.font = 'bold 18px sans-serif'
        ctx.fillStyle = '#f97316'
        ctx.fillText('⚠ SPOOF DETECTED', 10, 30)
      }
    }

    img.src = `data:image/jpeg;base64,${frameB64}`
  }, [mirror, drawOverlays])

  // rAF loop — only draws the latest pending frame (drops stale frames)
  useEffect(() => {
    let running = true
    const tick = () => {
      if (!running) return
      const frame = pendingFrameRef.current
      if (frame) {
        pendingFrameRef.current = null
        drawFrame(frame.frame, frame.results, frame.width, frame.height)
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      running = false
      cancelAnimationFrame(rafRef.current)
    }
  }, [drawFrame])

  // Connect to server camera stream
  useEffect(() => {
    const stream = new ServerCameraStream()
    streamRef.current = stream

    stream.start(
      mode,
      (data: CameraStreamFrame) => {
        if (!connectedRef.current) {
          connectedRef.current = true
          setConnected(true)
          setError(null)
          onConnectionChangeRef.current?.(true)
        }
        // Throttle FPS state to once per second
        const now = performance.now()
        if (now - lastFpsUpdateRef.current > 1000) {
          lastFpsUpdateRef.current = now
          setFps(data.fps)
        }
        latestResultsRef.current = data.results
        // Queue frame for rAF rendering (drops stale frames automatically)
        pendingFrameRef.current = data
        // Forward results immediately
        if (data.results) {
          onResultsRef.current?.(data.results)
        }
        onFrameRef.current?.(data)
      },
      (errMsg: string) => {
        setError(errMsg)
        setConnected(false)
        connectedRef.current = false
        onConnectionChangeRef.current?.(false)
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
  }, [jpegQuality]) // Only reconnect if quality changes

  // Handle mode changes without reconnecting
  useEffect(() => {
    streamRef.current?.setMode(mode)
  }, [mode])

  return (
    <div className={className} style={{ position: 'relative', ...style }}>
      <canvas
        ref={canvasRef}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          backgroundColor: '#000',
          display: 'block',
        }}
      />
      {/* Connection indicator */}
      <div style={{
        position: 'absolute',
        top: 8,
        right: 8,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 8px',
        borderRadius: 6,
        backgroundColor: 'rgba(0,0,0,0.6)',
        color: '#fff',
        fontSize: 12,
      }}>
        <div style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          backgroundColor: connected ? '#22c55e' : '#ef4444',
        }} />
        {connected ? `${fps} FPS` : 'Connecting...'}
      </div>
      {/* Error overlay */}
      {error && (
        <div style={{
          position: 'absolute',
          bottom: 8,
          left: 8,
          right: 8,
          padding: '8px 12px',
          borderRadius: 6,
          backgroundColor: 'rgba(239,68,68,0.9)',
          color: '#fff',
          fontSize: 13,
          textAlign: 'center',
        }}>
          {error}
        </div>
      )}
    </div>
  )
}
