-- A guest on more than one browser. A code shown on one browser (hub.ts), opened on
-- another, makes the second play as the same player under the same name; its row
-- here maps that browser and name to them. players.device_hash stays the browser a
-- guest began on.
--
-- If the second browser already had a guest by that name, that guest is merged:
-- its row stays, pointing at the one it joined, so its matches still count for them
-- whenever ratings are rebuilt.
create table guest_links (
  device_hash text not null,
  name_key text not null,
  player_id uuid not null references players (id),
  linked_at timestamptz not null default now(),
  primary key (device_hash, name_key)
);
alter table players add column merged_into uuid references players (id);
