/**
 * ArcFace API Client
 * Interfaces with Python FastAPI server for face recognition
 */

const ARCFACE_API_URL = process.env.NEXT_PUBLIC_ARCFACE_API_URL || 'https://qcu-attendance-monitoring-production.up.railway.app'

export interface ArcFaceEmbedding {
  detected: boolean
  embedding?: number[]
  embedding_size?: number
  bbox?: number[]
  detection_score?: number
  num_faces?: number
  error?: string
}

export interface ArcFaceVerification {
  verified: boolean
  similarity: number
  threshold: number
  confidence: number
}

/**
 * Extract face embedding from base64 image (webcam capture)
 */
export async function extractArcFaceEmbedding(
  base64Image: string
): Promise<ArcFaceEmbedding> {
  try {
    const response = await fetch(`${ARCFACE_API_URL}/extract-from-base64`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ image: base64Image }),
    })

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`)
    }

    const data = await response.json()
    return data
  } catch (error) {
    console.error('❌ ArcFace extraction error:', error)
    return {
      detected: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

/**
 * Extract face embedding from video element
 */
export async function extractArcFaceFromVideo(
  videoElement: HTMLVideoElement
): Promise<ArcFaceEmbedding> {
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
    return await extractArcFaceEmbedding(base64Image)
  } catch (error) {
    console.error('❌ Video extraction error:', error)
    return {
      detected: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

/**
 * Verify two embeddings belong to the same person
 */
export async function verifyArcFaceEmbeddings(
  embedding1: number[],
  embedding2: number[]
): Promise<ArcFaceVerification> {
  try {
    const response = await fetch(`${ARCFACE_API_URL}/verify`, {
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
    console.error('❌ ArcFace verification error:', error)
    throw error
  }
}

/**
 * Check if ArcFace server is healthy
 */
export async function checkArcFaceHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${ARCFACE_API_URL}/health`, {
      method: 'POST',
    })
    return response.ok
  } catch (error) {
    console.error('❌ ArcFace health check failed:', error)
    return false
  }
}

/**
 * Calculate cosine similarity between two embeddings (client-side)
 */
export function calculateCosineSimilarity(
  emb1: number[],
  emb2: number[]
): number {
  if (emb1.length !== emb2.length) {
    throw new Error('Embeddings must have same length')
  }

  // Calculate dot product
  let dotProduct = 0
  let norm1 = 0
  let norm2 = 0

  for (let i = 0; i < emb1.length; i++) {
    dotProduct += emb1[i] * emb2[i]
    norm1 += emb1[i] * emb1[i]
    norm2 += emb2[i] * emb2[i]
  }

  norm1 = Math.sqrt(norm1)
  norm2 = Math.sqrt(norm2)

  if (norm1 === 0 || norm2 === 0) {
    return 0
  }

  return dotProduct / (norm1 * norm2)
}
