-- ⚡ 실시간 경매: 대회당 경매 상태 1행 + 팀장(유저) 매핑.
alter table tournament_teams add column if not exists captain_user_id uuid;      -- 팀장 유저(입찰 권한)
alter table tournament_teams add column if not exists is_captain_team boolean default false;

create table if not exists tournament_auction (
  tournament_id uuid primary key references tournaments(id) on delete cascade,
  status text default 'idle',        -- idle | bidding | done
  current_pool_id uuid,              -- 지명된 선수(경매 대상)
  current_bid int default 0,
  current_bidder uuid,               -- 현재 최고 입찰 팀
  increment int default 5,           -- 입찰 단위
  updated_at timestamptz default now()
);
grant all on tournament_auction to service_role, anon, authenticated;
notify pgrst, 'reload schema';
