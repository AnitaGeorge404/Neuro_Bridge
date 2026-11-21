-- Run manually against a non-production Supabase database after applying the
-- migrations. Both psql variables must be UUIDs of existing auth.users:
--   psql "$DATABASE_URL" -v user_a=<uuid-a> -v user_b=<uuid-b> -f supabase/tests/role4_rls_isolation.sql
-- The transaction always rolls back and leaves no fixture data behind.

BEGIN;

SELECT set_config('test.user_a', :'user_a', false);
SELECT set_config('test.user_b', :'user_b', false);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = current_setting('test.user_a')::uuid)
     OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = current_setting('test.user_b')::uuid) THEN
    RAISE EXCEPTION 'user_a and user_b must identify existing auth.users';
  END IF;
END $$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', :'user_a', true);

INSERT INTO public.support_interventions (id, user_id, module_id, intervention_type, category, title)
VALUES ('rls-isolation-intervention', :'user_a'::uuid, 'test', 'test', 'emotional', 'private');
INSERT INTO public.support_lifecycle_events (id, user_id, intervention_id, module_id, intervention_type, to_status)
VALUES ('rls-isolation-event', :'user_a'::uuid, 'rls-isolation-intervention', 'test', 'test', 'started');
INSERT INTO public.support_outcomes (id, user_id, intervention_id, module_id, intervention_type, category, status)
VALUES ('rls-isolation-outcome', :'user_a'::uuid, 'rls-isolation-intervention', 'test', 'test', 'emotional', 'completed');
INSERT INTO public.support_reflections (id, user_id, summary)
VALUES ('rls-isolation-reflection', :'user_a'::uuid, 'private');
INSERT INTO public.support_memories (id, user_id, type, key, value)
VALUES ('rls-isolation-memory', :'user_a'::uuid, 'test', 'private', '{}');

SELECT set_config('request.jwt.claim.sub', :'user_b', true);

DO $$
DECLARE
  visible_rows integer;
  changed_rows integer;
BEGIN
  SELECT count(*) INTO visible_rows FROM public.support_interventions;
  ASSERT visible_rows = 0, 'user B can read user A interventions';
  SELECT count(*) INTO visible_rows FROM public.support_lifecycle_events;
  ASSERT visible_rows = 0, 'user B can read user A lifecycle events';
  SELECT count(*) INTO visible_rows FROM public.support_outcomes;
  ASSERT visible_rows = 0, 'user B can read user A outcomes';
  SELECT count(*) INTO visible_rows FROM public.support_reflections;
  ASSERT visible_rows = 0, 'user B can read user A reflections';
  SELECT count(*) INTO visible_rows FROM public.support_memories;
  ASSERT visible_rows = 0, 'user B can read user A memories';

  UPDATE public.support_interventions SET title = 'tampered' WHERE id = 'rls-isolation-intervention';
  GET DIAGNOSTICS changed_rows = ROW_COUNT;
  ASSERT changed_rows = 0, 'user B can update user A interventions';

  DELETE FROM public.support_reflections WHERE id = 'rls-isolation-reflection';
  GET DIAGNOSTICS changed_rows = ROW_COUNT;
  ASSERT changed_rows = 0, 'user B can delete user A reflections';

  BEGIN
    INSERT INTO public.support_memories (id, user_id, type, key, value)
    VALUES ('rls-forbidden-memory', current_setting('test.user_a')::uuid, 'test', 'forbidden', '{}');
    RAISE EXCEPTION 'user B can insert a row owned by user A';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END $$;

RESET ROLE;
SET LOCAL ROLE service_role;

DO $$
DECLARE
  visible_rows integer;
BEGIN
  SELECT count(*) INTO visible_rows FROM public.support_interventions;
  ASSERT visible_rows = 1, 'service_role cannot read backend data';
END $$;

RESET ROLE;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claim.role', 'anon', true);
SELECT set_config('request.jwt.claim.sub', '', true);

DO $$
DECLARE
  visible_rows integer;
BEGIN
  SELECT count(*) INTO visible_rows FROM public.support_interventions;
  ASSERT visible_rows = 0, 'anon can read private interventions';
  SELECT count(*) INTO visible_rows FROM public.support_reflections;
  ASSERT visible_rows = 0, 'anon can read private reflections';
END $$;

ROLLBACK;
