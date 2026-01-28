-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public.attendance_logs (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  session_id uuid NOT NULL,
  event_type character varying NOT NULL CHECK (event_type::text = ANY (ARRAY['shift_open'::character varying, 'shift_close'::character varying]::text[])),
  timestamp timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  professor_id uuid,
  created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT attendance_logs_pkey PRIMARY KEY (id),
  CONSTRAINT attendance_logs_professor_id_fkey FOREIGN KEY (professor_id) REFERENCES public.users(id)
);
CREATE TABLE public.attendance_records (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  attendance_session_id uuid NOT NULL,
  student_registration_id uuid NOT NULL,
  student_number text NOT NULL,
  checked_in_at timestamp with time zone NOT NULL DEFAULT now(),
  face_match_confidence numeric,
  status text NOT NULL DEFAULT 'present'::text,
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  section_id character varying,
  CONSTRAINT attendance_records_pkey PRIMARY KEY (id),
  CONSTRAINT attendance_records_student_registration_id_fkey FOREIGN KEY (student_registration_id) REFERENCES public.student_face_registrations(id)
);
CREATE TABLE public.class_sessions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  section_id uuid NOT NULL,
  professor_id uuid NOT NULL,
  room text NOT NULL,
  max_capacity integer NOT NULL CHECK (max_capacity > 0),
  day_of_week text NOT NULL CHECK (day_of_week = ANY (ARRAY['Monday'::text, 'Tuesday'::text, 'Wednesday'::text, 'Thursday'::text, 'Friday'::text, 'Saturday'::text, 'Sunday'::text])),
  start_time time without time zone NOT NULL,
  end_time time without time zone NOT NULL,
  created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT class_sessions_pkey PRIMARY KEY (id),
  CONSTRAINT class_sessions_section_id_fkey FOREIGN KEY (section_id) REFERENCES public.sections(id),
  CONSTRAINT class_sessions_professor_id_fkey FOREIGN KEY (professor_id) REFERENCES public.users(id)
);
CREATE TABLE public.professor_face_registrations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  professor_id uuid NOT NULL UNIQUE,
  first_name text NOT NULL,
  last_name text NOT NULL,
  face_data text NOT NULL,
  face_descriptor jsonb,
  registered_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  is_active boolean NOT NULL DEFAULT true,
  image_url text,
  CONSTRAINT professor_face_registrations_pkey PRIMARY KEY (id),
  CONSTRAINT professor_face_registrations_professor_id_fkey FOREIGN KEY (professor_id) REFERENCES public.users(id)
);
CREATE TABLE public.sections (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  section_code character varying NOT NULL,
  course_id uuid,
  semester character varying NOT NULL,
  academic_year character varying,
  max_students integer DEFAULT 40,
  created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT sections_pkey PRIMARY KEY (id)
);
CREATE TABLE public.student_face_registrations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  student_number text NOT NULL UNIQUE,
  first_name text NOT NULL,
  last_name text NOT NULL,
  face_data text NOT NULL,
  face_descriptor jsonb,
  registered_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  is_active boolean NOT NULL DEFAULT true,
  section_id character varying,
  CONSTRAINT student_face_registrations_pkey PRIMARY KEY (id)
);
CREATE TABLE public.users (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  role USER-DEFINED NOT NULL,
  email character varying NOT NULL UNIQUE,
  first_name character varying NOT NULL,
  last_name character varying NOT NULL,
  student_id character varying UNIQUE,
  employee_id character varying UNIQUE,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  password character varying,
  middle_name character varying,
  CONSTRAINT users_pkey PRIMARY KEY (id)
);