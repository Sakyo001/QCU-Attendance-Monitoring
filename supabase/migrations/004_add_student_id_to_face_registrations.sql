-- Add student_id foreign key to student_face_registrations table
ALTER TABLE public.student_face_registrations
ADD COLUMN student_id uuid,
ADD CONSTRAINT student_face_registrations_student_id_fkey 
FOREIGN KEY (student_id) REFERENCES public.users(id) ON DELETE CASCADE;

-- Populate student_id for existing face registrations by matching student_number with users.student_id
UPDATE public.student_face_registrations sfr
SET student_id = u.id
FROM public.users u
WHERE u.student_id = sfr.student_number
AND sfr.student_id IS NULL;

-- Create an index for faster lookups
CREATE INDEX idx_student_face_registrations_student_id 
ON public.student_face_registrations(student_id);
