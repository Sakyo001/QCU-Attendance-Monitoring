/**
 * FaceNet Python Server API Client
 * Interfaces with Python keras-facenet server for face recognition
 */

const FACENET_API_URL = process.env.NEXT_PUBLIC_FACENET_API_URL || 'http://localhost:8000'

export interface FaceNetEmbedding {
  detected: boolean
  embedding?: number[]
  embedding_size?: number
  confidence?: number
  box?: number[]
  num_faces?: number
  error?: string
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
    const response = await fetch(`${FACENET_API_URL}/extract-embedding`, {
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
    const response = await fetch(`${FACENET_API_URL}/verify`, {
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
    const response = await fetch(`${FACENET_API_URL}/compare-embeddings`, {
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
 * Check if FaceNet server is healthy
 */
export async function checkFaceNetHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${FACENET_API_URL}/health`, {
      method: 'GET',
    })
    return response.ok
  } catch (error) {
    console.error('❌ FaceNet health check failed:', error)
    return false
  }
}
