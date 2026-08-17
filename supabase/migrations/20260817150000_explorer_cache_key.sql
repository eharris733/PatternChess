-- The opening-explorer cache was keyed by bare FEN, which only worked while
-- the app queried a single Lichess database (masters). The opening trainer
-- adds the rated-players database filtered by rating band + speeds, so the key
-- becomes (fen, db, variant_key). Existing rows are masters lookups.
-- Apply via Supabase SQL editor (project: ydfwppthwnlgxnntzrvg).

alter table opening_explorer_cache
  add column if not exists db text not null default 'masters',
  add column if not exists variant_key text not null default '';

-- The table was created by hand, so the original constraint shapes are
-- unknown. Normalize: drop any unique constraint/index on bare fen, and if fen
-- itself is the primary key, widen the PK to the composite instead.
do $$
declare
  c record;
  pk_name text;
  pk_cols text;
begin
  -- Non-PK unique constraints.
  for c in
    select conname from pg_constraint
    where conrelid = 'opening_explorer_cache'::regclass and contype = 'u'
  loop
    execute format('alter table opening_explorer_cache drop constraint %I', c.conname);
  end loop;

  -- Standalone unique indexes (not constraint-backed; those died above).
  for c in
    select i.relname as indexname
    from pg_index x
    join pg_class i on i.oid = x.indexrelid
    where x.indrelid = 'opening_explorer_cache'::regclass
      and x.indisunique and not x.indisprimary
      and not exists (
        select 1 from pg_constraint pc where pc.conindid = x.indexrelid
      )
  loop
    execute format('drop index if exists %I', c.indexname);
  end loop;

  -- PK on bare fen -> widen to the composite key.
  select pc.conname,
         (select string_agg(a.attname, ',' order by k.ordinality)
          from unnest(pc.conkey) with ordinality k(attnum, ordinality)
          join pg_attribute a on a.attrelid = pc.conrelid and a.attnum = k.attnum)
    into pk_name, pk_cols
  from pg_constraint pc
  where pc.conrelid = 'opening_explorer_cache'::regclass and pc.contype = 'p';

  if pk_cols = 'fen' then
    execute format('alter table opening_explorer_cache drop constraint %I', pk_name);
    alter table opening_explorer_cache add primary key (fen, db, variant_key);
  else
    alter table opening_explorer_cache
      add constraint opening_explorer_cache_key unique (fen, db, variant_key);
  end if;
end $$;
