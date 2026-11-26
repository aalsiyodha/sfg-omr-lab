-- OMRLabs Neon development schema v0.3; applied to branch omrlabs-dev.
-- These migrations are rerunnable. Do not apply to production without review.
CREATE TABLE IF NOT EXISTS public.institutes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 name text NOT NULL CHECK(length(trim(name)) BETWEEN 3 AND 100),
 slug text NOT NULL UNIQUE CHECK(slug ~ '^[a-z0-9][a-z0-9-]{2,39}$'),
 created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.institute_members (
 institute_id uuid NOT NULL REFERENCES public.institutes(id) ON DELETE CASCADE,
 user_id text NOT NULL, role text NOT NULL CHECK(role IN('owner','admin','reviewer')),
 joined_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(institute_id,user_id)
);
CREATE TABLE IF NOT EXISTS public.tests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 institute_id uuid NOT NULL REFERENCES public.institutes(id) ON DELETE CASCADE,
 title text NOT NULL CHECK(length(trim(title)) BETWEEN 3 AND 120),
 sheet_test_number integer NOT NULL CHECK(sheet_test_number BETWEEN 1 AND 40),
 question_count integer NOT NULL DEFAULT 50 CHECK(question_count=50),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN('draft','published')),
 answer_key jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(answer_key)='array' AND jsonb_array_length(answer_key)=50),
 correct_marks numeric(7,2) NOT NULL DEFAULT 2 CHECK(correct_marks>0),
 wrong_marks numeric(7,2) NOT NULL DEFAULT -0.66 CHECK(wrong_marks<=0),
 created_by text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 published_at timestamptz, UNIQUE(id,institute_id)
);
CREATE TABLE IF NOT EXISTS public.candidates(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 institute_id uuid NOT NULL REFERENCES public.institutes(id) ON DELETE CASCADE,
 candidate_code text NOT NULL CHECK(length(trim(candidate_code)) BETWEEN 1 AND 80),
 display_name text NOT NULL CHECK(length(trim(display_name)) BETWEEN 1 AND 120),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(institute_id,candidate_code),UNIQUE(id,institute_id)
);
CREATE TABLE IF NOT EXISTS public.scan_submissions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 institute_id uuid NOT NULL,
 test_id uuid NOT NULL,
 candidate_id uuid NOT NULL,
 reviewer_id text NOT NULL,
 qr_verified boolean NOT NULL CHECK(qr_verified=true),
 timing_matched integer NOT NULL CHECK(timing_matched=50),
 scanner_version text NOT NULL,
 answers jsonb NOT NULL CHECK(jsonb_typeof(answers)='array' AND jsonb_array_length(answers)=50),
 answer_statuses jsonb NOT NULL CHECK(jsonb_typeof(answer_statuses)='array' AND jsonb_array_length(answer_statuses)=50),
 review_confirmed boolean NOT NULL CHECK(review_confirmed=true),
 score numeric(9,2) NOT NULL,correct_count int NOT NULL,incorrect_count int NOT NULL,
 blank_count int NOT NULL,multiple_count int NOT NULL,
 reviewed_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(test_id,institute_id) REFERENCES public.tests(id,institute_id) ON DELETE CASCADE,
 FOREIGN KEY(candidate_id,institute_id) REFERENCES public.candidates(id,institute_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_omrlabs_scan_test ON public.scan_submissions(institute_id,test_id,reviewed_at DESC);
CREATE INDEX IF NOT EXISTS idx_omrlabs_test_org ON public.tests(institute_id,created_at DESC);
CREATE OR REPLACE FUNCTION public.omrlabs_guard_published_key() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.status='published' AND
 (NEW.answer_key IS DISTINCT FROM OLD.answer_key OR NEW.status IS DISTINCT FROM OLD.status OR
 NEW.correct_marks IS DISTINCT FROM OLD.correct_marks OR NEW.wrong_marks IS DISTINCT FROM OLD.wrong_marks)
 THEN RAISE EXCEPTION 'Published answer key and marking policy are immutable'; END IF;
 IF NEW.status='published' AND OLD.status='draft' THEN
  IF jsonb_array_length(NEW.answer_key)<>50 OR EXISTS (
   SELECT 1 FROM jsonb_array_elements_text(NEW.answer_key) value
   WHERE value NOT IN ('A','B','C','D','X')) THEN
   RAISE EXCEPTION 'Answer key must contain 50 valid responses'; END IF;
  NEW.published_at=now();
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS omrlabs_published_key_guard ON public.tests;
CREATE TRIGGER omrlabs_published_key_guard BEFORE UPDATE ON public.tests
FOR EACH ROW EXECUTE FUNCTION public.omrlabs_guard_published_key();
