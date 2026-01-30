import { useRef, useState } from 'react'
import * as faceapi from 'face-api.js'

export interface LivenessMetrics {
  eyesOpen: boolean
  faceDetected: boolean
  headMovement: boolean
  livenessScore: number
}

interface UsePassiveLivenessDetectionReturn {
  livenessScore: number
  livenessMetrics: LivenessMetrics
  livenessFramesRef: React.MutableRefObject<number>
  previousYawRef: React.MutableRefObject<number>
  updateLivenessScore: (detection: faceapi.WithFaceDescriptor<faceapi.WithFaceLandmarks<faceapi.WithFaceDetection<{}>>>) => boolean
  resetLiveness: () => void
}

const LIVENESS_THRESHOLD = 30 // Frames required to verify liveness
const HEAD_MOVEMENT_THRESHOLD = 5 // Minimum yaw change to detect movement

export function usePassiveLivenessDetection(): UsePassiveLivenessDetectionReturn {
  const [livenessScore, setLivenessScore] = useState(0)
  const [livenessMetrics, setLivenessMetrics] = useState<LivenessMetrics>({
    eyesOpen: false,
    faceDetected: false,
    headMovement: false,
    livenessScore: 0
  })

  const livenessFramesRef = useRef(0)
  const previousYawRef = useRef(0)

  const calculateHeadPose = (landmarks: faceapi.FaceLandmarks68): number => {
    const points = landmarks.positions
    const noseTip = points[30]
    const leftEye = points[36]
    const rightEye = points[45]

    const eyeDistance = Math.abs(rightEye.x - leftEye.x)
    const leftDistance = Math.abs(noseTip.x - leftEye.x)
    const rightDistance = Math.abs(noseTip.x - rightEye.x)
    const yaw = -((leftDistance - rightDistance) / eyeDistance) * 100

    return yaw
  }

  const checkEyesOpen = (landmarks: faceapi.FaceLandmarks68): boolean => {
    const points = landmarks.positions
    const leftEyeTop = points[37]
    const leftEyeBottom = points[41]
    const rightEyeTop = points[43]
    const rightEyeBottom = points[47]

    const leftEyeOpen = Math.abs(leftEyeBottom.y - leftEyeTop.y) > 5
    const rightEyeOpen = Math.abs(rightEyeBottom.y - rightEyeTop.y) > 5

    return leftEyeOpen && rightEyeOpen
  }

  const updateLivenessScore = (detection: faceapi.WithFaceDescriptor<faceapi.WithFaceLandmarks<faceapi.WithFaceDetection<{}>>>): boolean => {
    const eyesOpen = checkEyesOpen(detection.landmarks)
    const yaw = calculateHeadPose(detection.landmarks)
    const headMovement = Math.abs(yaw - previousYawRef.current) > HEAD_MOVEMENT_THRESHOLD
    
    previousYawRef.current = yaw

    if (eyesOpen && detection) {
      livenessFramesRef.current++
    } else {
      livenessFramesRef.current = Math.max(0, livenessFramesRef.current - 1)
    }

    const score = Math.min(100, (livenessFramesRef.current / LIVENESS_THRESHOLD) * 100)
    setLivenessScore(score)
    setLivenessMetrics({
      eyesOpen,
      faceDetected: true,
      headMovement,
      livenessScore: score
    })

    return score >= 100
  }

  const resetLiveness = () => {
    livenessFramesRef.current = 0
    previousYawRef.current = 0
    setLivenessScore(0)
    setLivenessMetrics({
      eyesOpen: false,
      faceDetected: false,
      headMovement: false,
      livenessScore: 0
    })
  }

  return {
    livenessScore,
    livenessMetrics,
    livenessFramesRef,
    previousYawRef,
    updateLivenessScore,
    resetLiveness
  }
}
