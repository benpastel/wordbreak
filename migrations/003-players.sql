-- Players, and their ratings. A guest is a browser and a name together: the
-- browser's secret is kept only as a hash, and several people can share one browser
-- by playing under different names. A bot level is one fixed player. An account
-- (username and email, signing in by emailed link) will take over a guest's row when
-- it is claimed; the two tables after it are for that, and unused until then.
--
-- Ratings here are a cache of the matches: every match keeps its players' ids and
-- the report, enough to recompute every rating from the start under any rules.
create table players (
  id uuid primary key,
  kind text not null check (kind in ('guest', 'account', 'bot')),
  name text not null,
  device_hash text,
  name_key text,
  username text unique,
  email text unique,
  rating double precision not null,
  rd double precision not null,
  volatility double precision not null,
  rated_matches int not null default 0,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  unique (device_hash, name_key)
);
create table login_links (
  token_hash text primary key,
  email text not null,
  player_id uuid references players (id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);
create table sessions (
  token_hash text primary key,
  player_id uuid not null references players (id),
  created_at timestamptz not null default now(),
  last_used timestamptz not null default now()
);
create index matches_player_ids on matches using gin (player_ids);
