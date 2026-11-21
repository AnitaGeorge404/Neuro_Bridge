-- Harden every currently existing public table against PostgREST exposure.
--
-- Tables without an inspected browser-facing ownership model remain
-- default-deny. This includes backend-owned text user_id/owner_id tables and
-- child tables whose ownership is only implied through a foreign key. Backend
-- service_role requests bypass RLS; do not add browser policies to those tables.

DO $$
DECLARE
  table_name text;
BEGIN
  FOR table_name IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('GRANT ALL PRIVILEGES ON TABLE public.%I TO service_role', table_name);
  END LOOP;
END $$;

-- Browser-facing tables with a direct authenticated-user ownership column.
-- Remove prior policies so legacy broad policies (notably user_id = 'default')
-- cannot survive alongside the ownership policy below.
DO $$
DECLARE
  table_name text;
  policy_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'documents',
    'reader_preferences',
    'reading_files',
    'reading_sessions',
    'word_metrics',
    'phoneme_errors',
    'cognitive_profiles',
    'reading_difficulty_interactions',
    'support_interventions',
    'support_lifecycle_events',
    'support_outcomes',
    'support_reflections',
    'support_memories',
    'wellbeing_gardens',
    'wellbeing_garden_history',
    'wellbeing_interactions'
  ]
  LOOP
    IF to_regclass(format('public.%I', table_name)) IS NOT NULL THEN
      FOR policy_name IN
        SELECT policyname
        FROM pg_policies
        WHERE schemaname = 'public' AND tablename = table_name
      LOOP
        EXECUTE format('DROP POLICY %I ON public.%I', policy_name, table_name);
      END LOOP;

      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM anon', table_name);
      EXECUTE format('CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (%s) WITH CHECK (%s)',
        'Authenticated users manage only their own records',
        table_name,
        CASE
          WHEN table_name IN ('wellbeing_gardens', 'wellbeing_garden_history', 'wellbeing_interactions')
            THEN '(select auth.uid())::text = user_id'
          ELSE '(select auth.uid()) = user_id'
        END,
        CASE
          WHEN table_name IN ('wellbeing_gardens', 'wellbeing_garden_history', 'wellbeing_interactions')
            THEN '(select auth.uid())::text = user_id'
          ELSE '(select auth.uid()) = user_id'
        END
      );
    END IF;
  END LOOP;
END $$;

-- Preserve the application's existing operation surface while ensuring each
-- operation is subject to the ownership policy above. service_role retains full
-- table privileges and bypasses RLS for backend work.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.documents TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reader_preferences TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reading_files TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reading_sessions TO authenticated;
GRANT SELECT, INSERT ON public.word_metrics TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.phoneme_errors TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.cognitive_profiles TO authenticated;
GRANT SELECT, INSERT ON public.reading_difficulty_interactions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.support_interventions TO authenticated;
GRANT SELECT, INSERT ON public.support_lifecycle_events TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.support_outcomes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.support_reflections TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.support_memories TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wellbeing_gardens TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wellbeing_garden_history TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wellbeing_interactions TO authenticated;
