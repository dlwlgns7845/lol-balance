-- 💰 경매 드래프트: 팀(주장) 예산 + 선수 풀. 기존 로스터 신청 방식은 무영향.
alter table tournament_teams add column if not exists budget int; -- 남은 포인트(경매 모드)

create table if not exists tournament_pool (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id) on delete cascade,
  game_name text not null,
  tag_line text,
  tier text,
  role text,
  sold_to uuid references tournament_teams(id) on delete set null, -- 낙찰 팀
  price int,                                                       -- 낙찰가
  created_at timestamptz default now()
);
create index if not exists idx_tpool_tour on tournament_pool(tournament_id);
grant all on tournament_pool to service_role, anon, authenticated;
notify pgrst, 'reload schema';
