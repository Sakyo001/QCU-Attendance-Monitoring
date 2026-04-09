import 'server-only'

import { mkdir, readFile, writeFile } from 'fs/promises'
import { join } from 'path'

const CACHE_DIR = join(process.cwd(), 'data')
const CACHE_FILE = join(CACHE_DIR, 'offline-kiosk-cache.json')

export interface OfflineProfessor {
  id: string
  firstName: string
  lastName: string
  email?: string
  role?: string
  employeeId?: string
  faceDescriptor: number[]
  isActive: boolean
  updatedAt: string
}

export interface OfflineSchedule {
  id: string
  professorId: string
  sectionId: string
  sectionCode: string
  room: string
  dayOfWeek: string
  startTime: string
  endTime: string
  totalStudents: number
  semester?: string
  academicYear?: string
  updatedAt: string
}

export interface OfflineStudent {
  id: string
  studentNumber: string
  firstName: string
  lastName: string
  sectionId?: string
  faceDescriptor?: number[]
  isActive: boolean
  updatedAt: string
}

export interface OfflineClassroom {
  id: string
  sectionId: string
  room: string
  maxCapacity: number
  dayOfWeek: string
  startTime: string
  endTime: string
  subjectCode: string
  subjectName: string
  sectionCode: string
  semester?: string
  academicYear?: string
  professorId: string
  updatedAt: string
}

export interface OfflineSection {
  id: string
  sectionCode: string
  semester: string
  academicYear: string
  maxStudents: number
  updatedAt: string
}

interface OfflineKioskCache {
  professors: OfflineProfessor[]
  schedules: OfflineSchedule[]
  students: OfflineStudent[]
  classrooms: OfflineClassroom[]
  sections: OfflineSection[]
}

const EMPTY_CACHE: OfflineKioskCache = {
  professors: [],
  schedules: [],
  students: [],
  classrooms: [],
  sections: [],
}

async function ensureCacheDir(): Promise<void> {
  await mkdir(CACHE_DIR, { recursive: true })
}

async function readCache(): Promise<OfflineKioskCache> {
  try {
    const raw = await readFile(CACHE_FILE, 'utf8')
    const parsed = JSON.parse(raw) as Partial<OfflineKioskCache>
    return {
      professors: Array.isArray(parsed.professors) ? parsed.professors : [],
      schedules: Array.isArray(parsed.schedules) ? parsed.schedules : [],
      students: Array.isArray(parsed.students) ? parsed.students : [],
      classrooms: Array.isArray(parsed.classrooms) ? parsed.classrooms : [],
      sections: Array.isArray(parsed.sections) ? parsed.sections : [],
    }
  } catch {
    return { ...EMPTY_CACHE }
  }
}

async function writeCache(cache: OfflineKioskCache): Promise<void> {
  await ensureCacheDir()
  await writeFile(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf8')
}

export async function upsertOfflineProfessor(
  professor: Omit<OfflineProfessor, 'updatedAt'>
): Promise<void> {
  const cache = await readCache()
  const next = {
    ...professor,
    updatedAt: new Date().toISOString(),
  }
  const idx = cache.professors.findIndex((p) => p.id === professor.id)
  if (idx >= 0) {
    cache.professors[idx] = next
  } else {
    cache.professors.push(next)
  }
  await writeCache(cache)
}

export async function getOfflineProfessors(): Promise<OfflineProfessor[]> {
  const cache = await readCache()
  return cache.professors.filter((p) => p.isActive)
}

export async function upsertOfflineSchedules(schedules: Array<Omit<OfflineSchedule, 'updatedAt'>>): Promise<void> {
  if (schedules.length === 0) return
  const cache = await readCache()
  const now = new Date().toISOString()

  for (const schedule of schedules) {
    const next = { ...schedule, updatedAt: now }
    const idx = cache.schedules.findIndex((s) => s.id === schedule.id)
    if (idx >= 0) {
      cache.schedules[idx] = next
    } else {
      cache.schedules.push(next)
    }
  }

  await writeCache(cache)
}

export async function getOfflineSchedulesForProfessor(
  professorId: string,
  dayOfWeek: string
): Promise<OfflineSchedule[]> {
  const cache = await readCache()
  return cache.schedules
    .filter((s) => s.professorId === professorId && s.dayOfWeek === dayOfWeek)
    .sort((a, b) => a.startTime.localeCompare(b.startTime))
}

export async function getAllOfflineSchedules(): Promise<OfflineSchedule[]> {
  const cache = await readCache()
  return cache.schedules
    .slice()
    .sort((a, b) => a.dayOfWeek.localeCompare(b.dayOfWeek) || a.startTime.localeCompare(b.startTime))
}

export async function getOfflineSchedulesByDay(dayOfWeek: string): Promise<OfflineSchedule[]> {
  const cache = await readCache()
  return cache.schedules
    .filter((s) => s.dayOfWeek === dayOfWeek)
    .sort((a, b) => a.startTime.localeCompare(b.startTime))
}

export async function upsertOfflineStudents(students: Array<Omit<OfflineStudent, 'updatedAt'>>): Promise<void> {
  if (students.length === 0) return
  const cache = await readCache()
  const now = new Date().toISOString()

  for (const student of students) {
    const next = { ...student, updatedAt: now }

    // Prefer stable identity by (sectionId + studentNumber) to survive delete/re-register
    // where UUID id changes but student_number stays the same.
    const normalizedSectionId = String(student.sectionId || '').trim().toLowerCase()
    const normalizedStudentNumber = String(student.studentNumber || '').trim().toLowerCase()

    let idx = -1
    if (normalizedSectionId && normalizedStudentNumber) {
      idx = cache.students.findIndex((s) => (
        String(s.sectionId || '').trim().toLowerCase() === normalizedSectionId &&
        String(s.studentNumber || '').trim().toLowerCase() === normalizedStudentNumber
      ))
    }

    if (idx < 0) {
      idx = cache.students.findIndex((s) => s.id === student.id)
    }

    if (idx >= 0) {
      cache.students[idx] = next
    } else {
      cache.students.push(next)
    }
  }

  // Final cleanup: keep one record per (sectionId + studentNumber), choosing latest updatedAt.
  const deduped = new Map<string, OfflineStudent>()
  for (const s of cache.students) {
    const key = `${String(s.sectionId || '').trim().toLowerCase()}::${String(s.studentNumber || '').trim().toLowerCase()}`
    if (!String(s.studentNumber || '').trim()) {
      deduped.set(`id::${s.id}`, s)
      continue
    }
    const existing = deduped.get(key)
    if (!existing || String(existing.updatedAt || '') < String(s.updatedAt || '')) {
      deduped.set(key, s)
    }
  }
  cache.students = Array.from(deduped.values())

  await writeCache(cache)
}

export async function getOfflineStudentsBySection(sectionId: string): Promise<OfflineStudent[]> {
  const cache = await readCache()
  const dedup = new Map<string, OfflineStudent>()
  cache.students
    .filter((s) => s.isActive && s.sectionId === sectionId)
    .forEach((s) => {
      const key = String(s.studentNumber || '').trim().toLowerCase() || `id:${s.id}`
      const existing = dedup.get(key)
      if (!existing || String(existing.updatedAt || '') < String(s.updatedAt || '')) {
        dedup.set(key, s)
      }
    })

  return Array.from(dedup.values())
    .sort((a, b) => a.lastName.localeCompare(b.lastName))
}

/**
 * Get all offline students with face descriptors (for face matching)
 */
export async function getOfflineStudentsWithFaceDescriptors(sectionId?: string): Promise<OfflineStudent[]> {
  const cache = await readCache()
  let filtered = cache.students.filter((s) => s.isActive && s.faceDescriptor && s.faceDescriptor.length > 0)
  
  if (sectionId) {
    filtered = filtered.filter((s) => s.sectionId === sectionId)
  }
  
  const dedup = new Map<string, OfflineStudent>()
  filtered.forEach((s) => {
    const key = `${String(s.sectionId || '').trim().toLowerCase()}::${String(s.studentNumber || '').trim().toLowerCase() || `id:${s.id}`}`
    const existing = dedup.get(key)
    if (!existing || String(existing.updatedAt || '') < String(s.updatedAt || '')) {
      dedup.set(key, s)
    }
  })

  return Array.from(dedup.values()).sort((a, b) => a.lastName.localeCompare(b.lastName))
}

export async function upsertOfflineClassrooms(classrooms: Array<Omit<OfflineClassroom, 'updatedAt'>>): Promise<void> {
  if (classrooms.length === 0) return
  const cache = await readCache()
  const now = new Date().toISOString()

  for (const classroom of classrooms) {
    const next = { ...classroom, updatedAt: now }
    const idx = cache.classrooms.findIndex((c) => c.id === classroom.id)
    if (idx >= 0) {
      cache.classrooms[idx] = next
    } else {
      cache.classrooms.push(next)
    }
  }

  await writeCache(cache)
}

export async function getOfflineClassroomsForProfessor(professorId: string): Promise<OfflineClassroom[]> {
  const cache = await readCache()
  return cache.classrooms
    .filter((c) => c.professorId === professorId)
    .sort((a, b) => a.dayOfWeek.localeCompare(b.dayOfWeek) || a.startTime.localeCompare(b.startTime))
}

export async function getAllOfflineClassrooms(): Promise<OfflineClassroom[]> {
  const cache = await readCache()
  return cache.classrooms.sort((a, b) => a.dayOfWeek.localeCompare(b.dayOfWeek) || a.startTime.localeCompare(b.startTime))
}

export async function upsertOfflineSections(sections: Array<Omit<OfflineSection, 'updatedAt'>>): Promise<void> {
  if (sections.length === 0) return
  const cache = await readCache()
  const now = new Date().toISOString()

  for (const section of sections) {
    const next = { ...section, updatedAt: now }
    const idx = cache.sections.findIndex((s) => s.id === section.id)
    if (idx >= 0) {
      cache.sections[idx] = next
    } else {
      cache.sections.push(next)
    }
  }

  await writeCache(cache)
}

export async function getAllOfflineSections(): Promise<OfflineSection[]> {
  const cache = await readCache()
  return cache.sections.sort((a, b) => a.sectionCode.localeCompare(b.sectionCode))
}

/**
 * Get all schedules for a professor (for offline kiosk, not filtered by day)
 */
export async function getOfflineSchedulesForProfessorAll(professorId: string): Promise<OfflineSchedule[]> {
  const cache = await readCache()
  return cache.schedules
    .filter((s) => s.professorId === professorId)
    .sort((a, b) => a.dayOfWeek.localeCompare(b.dayOfWeek) || a.startTime.localeCompare(b.startTime))
}

/**
 * Delete a section and cascade-delete related data
 */
export async function deleteOfflineSection(sectionId: string): Promise<void> {
  const cache = await readCache()
  
  // Remove section
  cache.sections = cache.sections.filter((s) => s.id !== sectionId)
  
  // Remove classrooms for this section
  cache.classrooms = cache.classrooms.filter((c) => c.sectionId !== sectionId)
  
  // Remove schedules for this section
  cache.schedules = cache.schedules.filter((s) => s.sectionId !== sectionId)
  
  // Remove students for this section
  cache.students = cache.students.filter((st) => st.sectionId !== sectionId)
  
  await writeCache(cache)
  console.log('🗑️ Deleted section and related data from offline cache:', sectionId)
}

/**
 * Sync section deletions (remove sections that are no longer in the provided list)
 */
export async function syncOfflineDeletedSections(activeSecondIds: string[]): Promise<void> {
  const cache = await readCache()
  const activeSet = new Set(activeSecondIds)
  
  // Find sections to delete (in cache but not in active list)
  const toDelete = cache.sections
    .filter((s) => !activeSet.has(s.id))
    .map((s) => s.id)
  
  if (toDelete.length === 0) return
  
  // Delete each section
  for (const sectionId of toDelete) {
    await deleteOfflineSection(sectionId)
  }
}
