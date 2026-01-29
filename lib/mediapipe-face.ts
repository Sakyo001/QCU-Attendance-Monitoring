/**
 * Hybrid Face Recognition System
 * 
 * Architecture:
 * 1. MediaPipe Face Mesh - Fast and accurate face detection + landmarks
 * 2. face-api.js FaceNet - 128D embeddings for identity recognition
 * 
 * Why hybrid approach:
 * - MediaPipe: Excellent for detecting faces and extracting landmarks
 * - FaceNet: Generates embeddings that capture UNIQUE facial features for recognition
 * - Raw landmarks (1404D) only describe face geometry, not identity
 * - FaceNet embeddings (128D) are designed specifically for "who is this person?"
 * 
 * Security improvement:
 * - Previous: Landmarks were too similar across different faces
 * - Now: FaceNet embeddings uniquely identify individuals
 */

import * as faceapi from 'face-api.js'

declare global {
  interface Window {
    FaceMesh: any
    Camera: any
    drawConnectors: any
    drawLandmarks: any
    FACEMESH_TESSELATION: any
  }
}

let faceMesh: any = null
let faceNetModelsLoaded = false
let isInitializing = false
let initializePromise: Promise<boolean> | null = null

export interface FaceDetectionResult {
  detected: boolean
  descriptor: number[] | null // Now 128D FaceNet embeddings instead of 1404D landmarks
  landmarks: any[] | null
  boundingBox: {
    xCenter: number
    yCenter: number
    width: number
    height: number
  } | null
}

// Load MediaPipe scripts dynamically
const loadMediaPipeScripts = async (): Promise<boolean> => {
  if (faceMesh) return true
  if (initializePromise) return initializePromise

  initializePromise = new Promise(async (resolve) => {
    try {
      // Check if already loaded via script tags
      if (window.FaceMesh) {
        faceMesh = new window.FaceMesh({
          locateFile: (file: string) => {
            return `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
          }
        })
        
        // Initialize the model first
        await faceMesh.initialize()
        
        // Then set options
        faceMesh.setOptions({
          maxNumFaces: 1,
          refineLandmarks: true,
          minDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5
        })
        
        console.log('✅ MediaPipe Face Mesh loaded from window')
        resolve(true)
        return
      }

      // Load scripts dynamically
      const scripts = [
        'https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js',
        'https://cdn.jsdelivr.net/npm/@mediapipe/drawing_utils/drawing_utils.js',
        'https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/face_mesh.js'
      ]

      let loadedCount = 0
      for (const scriptUrl of scripts) {
        await new Promise<void>((scriptResolve) => {
          const script = document.createElement('script')
          script.src = scriptUrl
          script.async = true
          script.onload = () => {
            loadedCount++
            scriptResolve()
          }
          script.onerror = () => {
            console.error(`Failed to load ${scriptUrl}`)
            scriptResolve()
          }
          document.head.appendChild(script)
        })
      }

      // Wait a bit for window objects to be available
      await new Promise(resolve => setTimeout(resolve, 500))

      if (window.FaceMesh) {
        faceMesh = new window.FaceMesh({
          locateFile: (file: string) => {
            return `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
          }
        })

        // Initialize the model first
        await faceMesh.initialize()

        // Then set options
        faceMesh.setOptions({
          maxNumFaces: 1,
          refineLandmarks: true,
          minDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5
        })

        console.log('✅ MediaPipe Face Mesh initialized successfully')
        resolve(true)
      } else {
        console.error('❌ FaceMesh not available on window object')
        resolve(false)
      }
    } catch (error) {
      console.error('❌ Failed to initialize MediaPipe:', error)
      resolve(false)
    }
  })

  return initializePromise
}

// Load face-api.js models for FaceNet embeddings
const loadFaceApiModels = async (): Promise<boolean> => {
  if (faceNetModelsLoaded) return true

  try {
    const MODEL_URL = '/models'
    
    // Load all required models for face recognition
    // 1. TinyFaceDetector - Fast face detection (required for detectSingleFace)
    // 2. FaceLandmark68Net - 68-point facial landmarks (required for FaceNet)
    // 3. FaceRecognitionNet - FaceNet 128D embeddings (the actual identity descriptor)
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
      faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL)
    ])
    
    faceNetModelsLoaded = true
    console.log('✅ FaceNet models loaded (TinyFaceDetector + Landmarks + Recognition)')
    return true
  } catch (error) {
    console.error('❌ Failed to load FaceNet models:', error)
    return false
  }
}

// Initialize both MediaPipe (detection) and FaceNet (recognition)
export const initializeFaceDetection = async (): Promise<boolean> => {
  if (faceMesh && faceNetModelsLoaded) return true
  
  const [mediapipeLoaded, facenetLoaded] = await Promise.all([
    loadMediaPipeScripts(),
    loadFaceApiModels()
  ])
  
  return mediapipeLoaded && facenetLoaded
}

// Generate FaceNet embedding from face image
// This captures UNIQUE facial features for identity recognition
async function generateFaceNetEmbedding(
  videoOrCanvas: HTMLVideoElement | HTMLCanvasElement,
  boundingBox: { xCenter: number; yCenter: number; width: number; height: number }
): Promise<number[] | null> {
  if (!faceNetModelsLoaded) {
    console.error('❌ FaceNet models not loaded')
    return null
  }

  try {
    // Create canvas to extract face region
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) return null

    // Calculate bounding box in pixel coordinates
    const sourceWidth = videoOrCanvas instanceof HTMLVideoElement 
      ? videoOrCanvas.videoWidth 
      : videoOrCanvas.width
    const sourceHeight = videoOrCanvas instanceof HTMLVideoElement 
      ? videoOrCanvas.videoHeight 
      : videoOrCanvas.height

    const x = (boundingBox.xCenter - boundingBox.width / 2) * sourceWidth
    const y = (boundingBox.yCenter - boundingBox.height / 2) * sourceHeight
    const width = boundingBox.width * sourceWidth
    const height = boundingBox.height * sourceHeight

    // Expand bounding box slightly for better context (20% padding)
    const padding = 0.2
    const expandedX = Math.max(0, x - width * padding)
    const expandedY = Math.max(0, y - height * padding)
    const expandedWidth = Math.min(sourceWidth - expandedX, width * (1 + 2 * padding))
    const expandedHeight = Math.min(sourceHeight - expandedY, height * (1 + 2 * padding))

    // Set canvas size to face region
    canvas.width = expandedWidth
    canvas.height = expandedHeight

    // Draw face region to canvas
    ctx.drawImage(
      videoOrCanvas,
      expandedX, expandedY, expandedWidth, expandedHeight,
      0, 0, expandedWidth, expandedHeight
    )

    // Detect face and generate embedding using face-api.js
    // Use TinyFaceDetector for fast detection on the cropped face region
    const detection = await faceapi
      .detectSingleFace(canvas, new faceapi.TinyFaceDetectorOptions())
      .withFaceLandmarks()
      .withFaceDescriptor()

    if (!detection) {
      console.warn('⚠️ FaceNet could not generate embedding from face region')
      return null
    }

    // Return 128D FaceNet embedding
    const embedding = Array.from(detection.descriptor)
    
    if (embedding.length !== 128) {
      console.error(`❌ Invalid embedding length: ${embedding.length}, expected 128`)
      return null
    }

    return embedding
  } catch (error) {
    console.error('❌ Error generating FaceNet embedding:', error)
    return null
  }
}

// Detect face in video element
export const detectFaceInVideo = async (
  videoElement: HTMLVideoElement
): Promise<FaceDetectionResult> => {
  if (!faceMesh) {
    await initializeFaceDetection()
  }

  if (!faceMesh) {
    return {
      detected: false,
      descriptor: null,
      landmarks: null,
      boundingBox: null
    }
  }

  return new Promise(async (resolve) => {
    try {
      faceMesh.onResults(async (results: any) => {
        if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
          const landmarks = results.multiFaceLandmarks[0]
          
          // Calculate bounding box from landmarks
          let minX = 1, minY = 1, maxX = 0, maxY = 0
          landmarks.forEach((lm: any) => {
            minX = Math.min(minX, lm.x)
            minY = Math.min(minY, lm.y)
            maxX = Math.max(maxX, lm.x)
            maxY = Math.max(maxY, lm.y)
          })

          const boundingBox = {
            xCenter: (minX + maxX) / 2,
            yCenter: (minY + maxY) / 2,
            width: maxX - minX,
            height: maxY - minY
          }
          
          // Generate FaceNet embedding (128D) for identity recognition
          const descriptor = await generateFaceNetEmbedding(videoElement, boundingBox)

          if (!descriptor) {
            resolve({
              detected: false,
              descriptor: null,
              landmarks: null,
              boundingBox: null
            })
            return
          }

          resolve({
            detected: true,
            descriptor,
            landmarks,
            boundingBox
          })
        } else {
          resolve({
            detected: false,
            descriptor: null,
            landmarks: null,
            boundingBox: null
          })
        }
      })

      faceMesh.send({ image: videoElement })
    } catch (error) {
      console.error('Face detection error:', error)
      resolve({
        detected: false,
        descriptor: null,
        landmarks: null,
        boundingBox: null
      })
    }
  })
}

// Calculate cosine similarity between two descriptors
export const calculateSimilarity = (desc1: number[], desc2: number[]): number => {
  if (!desc1 || !desc2 || desc1.length !== desc2.length) {
    return 0
  }

  let dotProduct = 0
  let magnitude1 = 0
  let magnitude2 = 0

  for (let i = 0; i < desc1.length; i++) {
    dotProduct += desc1[i] * desc2[i]
    magnitude1 += desc1[i] * desc1[i]
    magnitude2 += desc2[i] * desc2[i]
  }

  magnitude1 = Math.sqrt(magnitude1)
  magnitude2 = Math.sqrt(magnitude2)

  if (magnitude1 === 0 || magnitude2 === 0) {
    return 0
  }

  return dotProduct / (magnitude1 * magnitude2)
}

// Clean up resources
export const cleanupFaceDetection = () => {
  if (faceMesh) {
    faceMesh.close()
    faceMesh = null
  }
  initializePromise = null
}
