-- Every finished match: the same report printed to the log (matchlog.ts), plus who
-- played, by id, which the log leaves out.
create table matches (
  id bigserial primary key,
  table_id text not null,
  ended_at timestamptz not null,
  how text not null,
  player_ids text[] not null,
  report jsonb not null
);
create index matches_ended_at on matches (ended_at);
