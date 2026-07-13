-- 👥 멸망전 공동운영(관리자) — 내전방(room_members)과 동일 매커니즘.
--    로그인 유저가 대회를 열람하면 viewer 자동 등록 → 대회장이 admin으로 승격.
create table if not exists tournament_members (
  tournament_id uuid not null references tournaments(id) on delete cascade,
  user_id uuid not null,
  email text,
  name text,
  role text default 'viewer',   -- 'admin'(공동운영) | 'viewer'
  created_at timestamptz default now(),
  primary key (tournament_id, user_id)
);
create index if not exists idx_tmember_tour on tournament_members(tournament_id);
grant all on tournament_members to service_role, anon, authenticated;
notify pgrst, 'reload schema';
