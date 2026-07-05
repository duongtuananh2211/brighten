-- Story 4.1: RLS SELECT-only for anon role + Realtime publication (AD-10).
-- Idempotent: safe to re-run. web=anon read-only, engine=service_role write.

-- 1. Enable RLS + SELECT-only policy for anon on all UI-read tables
do $$
declare
  tbl text;
begin
  for tbl in
    select unnest(array[
      'suggestions',
      'behavioral_state',
      'drift_metrics',
      'audit_events',
      'override_grants',
      'config'
    ])
  loop
    -- Enable RLS
    execute format('alter table public.%I enable row level security', tbl);

    -- Drop existing anon policy if any (idempotent)
    execute format('drop policy if exists %I on public.%I', 'anon_select_' || tbl, tbl);

    -- Create SELECT-only policy for anon (authenticated too for future auth)
    execute format(
      'create policy %I on public.%I for select to anon, authenticated using (true)',
      'anon_select_' || tbl,
      tbl
    );
  end loop;
end
$$;

-- 2. Add tables to Realtime publication (supabase_realtime)
do $$
declare
  tbl text;
begin
  for tbl in
    select unnest(array[
      'suggestions',
      'behavioral_state',
      'drift_metrics',
      'audit_events',
      'override_grants'
    ])
  loop
    -- Add table to publication if not already present (idempotent)
    begin
      execute format('alter publication supabase_realtime add table public.%I', tbl);
    exception
      when duplicate_object then
        null; -- already in publication
    end;
  end loop;
end
$$;

-- Note: config is intentionally NOT in realtime (rarely changes).
-- service_role (engine) bypasses RLS and retains full write access.
-- anon key is public but RLS-gated — safe to expose in NEXT_PUBLIC_* env vars.
