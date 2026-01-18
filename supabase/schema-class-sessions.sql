-- Create class_sessions table for professor-managed classrooms
CREATE TABLE IF NOT EXISTS public.class_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  section_id UUID NOT NULL REFERENCES public.sections(id) ON DELETE CASCADE,
  professor_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  room TEXT NOT NULL,
  max_capacity INTEGER NOT NULL CHECK (max_capacity > 0),
  day_of_week TEXT NOT NULL CHECK (day_of_week IN ('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday')),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT valid_times CHECK (end_time > start_time)
);

-- Create index for faster queries
CREATE INDEX idx_class_sessions_section_id ON public.class_sessions(section_id);
CREATE INDEX idx_class_sessions_professor_id ON public.class_sessions(professor_id);

-- Enable RLS
ALTER TABLE public.class_sessions ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Professors can view their own class sessions"
  ON public.class_sessions
  FOR SELECT
  USING (professor_id = auth.uid() OR (SELECT role FROM public.users WHERE id = auth.uid()) = 'admin');

CREATE POLICY "Professors can create their own class sessions"
  ON public.class_sessions
  FOR INSERT
  WITH CHECK (professor_id = auth.uid() OR (SELECT role FROM public.users WHERE id = auth.uid()) = 'admin');

CREATE POLICY "Professors can update their own class sessions"
  ON public.class_sessions
  FOR UPDATE
  USING (professor_id = auth.uid() OR (SELECT role FROM public.users WHERE id = auth.uid()) = 'admin');

CREATE POLICY "Professors can delete their own class sessions"
  ON public.class_sessions
  FOR DELETE
  USING (professor_id = auth.uid() OR (SELECT role FROM public.users WHERE id = auth.uid()) = 'admin');

-- Create trigger to update updated_at
CREATE OR REPLACE FUNCTION public.update_class_sessions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_class_sessions_updated_at
  BEFORE UPDATE ON public.class_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_class_sessions_updated_at();
