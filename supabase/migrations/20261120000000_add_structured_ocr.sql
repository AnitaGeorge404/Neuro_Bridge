-- Preserve the document model produced by Gemini Vision alongside the
-- backwards-compatible flattened OCR text.
ALTER TABLE public.reading_files
  ADD COLUMN IF NOT EXISTS ocr_structure JSONB;
