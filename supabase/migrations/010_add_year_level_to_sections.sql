-- Migration: Add year_level to sections table
ALTER TABLE public.sections ADD COLUMN IF NOT EXISTS year_level varchar;
