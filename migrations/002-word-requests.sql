-- Words players asked to have added, one row per word per player, so asking twice
-- counts once. Only words they actually tried and were refused.
create table word_requests (
  word text not null,
  player_id text not null,
  table_id text not null,
  requested_at timestamptz not null default now(),
  primary key (word, player_id)
);
