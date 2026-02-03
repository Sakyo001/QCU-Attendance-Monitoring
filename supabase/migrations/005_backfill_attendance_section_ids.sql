-- Backfill NULL section_ids in attendance_records from student_face_registrations
UPDATE public.attendance_records ar
SET section_id = sfr.section_id
FROM public.student_face_registrations sfr
WHERE ar.section_id IS NULL
AND ar.student_number = sfr.student_number
AND sfr.section_id IS NOT NULL;

-- Alternative: Update from class_sessions if available
UPDATE public.attendance_records ar
SET section_id = cs.section_id
FROM public.class_sessions cs
WHERE ar.section_id IS NULL
AND EXISTS (
  SELECT 1 FROM public.attendance_logs al
  WHERE al.id = ar.attendance_session_id
  AND al.session_id = cs.id
);
