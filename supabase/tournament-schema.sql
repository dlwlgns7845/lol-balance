-- 🏆 멸망전(커뮤니티 대회) 스키마 — 내전 테이블과 완전 분리.
-- Supabase SQL 에디터에 붙여넣고 실행. (새 테이블마다 GRANT 명시 필수 — 자동노출 OFF 방침)

create table if not exists tournaments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid,                                 -- 대회 만든 유저(=운영자). 방과 무관한 독립 대회.
  group_id uuid references groups(id) on delete set null, -- 옵션(안 씀). 독립 대회라 null 허용.
  name text not null,
  format text not null default 'single_elim',   -- single_elim (MVP)
  team_size int not null default 5,
  max_teams int not null default 8,              -- 4 / 8 / 16 / 32
  tier_cap text,                                 -- null=제한없음, 예 'D2' (이 티어 이하만)
  status text not null default 'recruiting',     -- recruiting | running | done
  starts_at timestamptz,
  created_at timestamptz default now()
);

create table if not exists tournament_teams (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id) on delete cascade,
  name text not null,
  captain text,                                  -- 주장 이름/디코
  status text not null default 'pending',        -- pending | approved | rejected | eliminated
  seed int,
  created_at timestamptz default now()
);

create table if not exists tournament_team_members (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references tournament_teams(id) on delete cascade,
  game_name text not null,
  tag_line text,
  tier text,                                     -- op.gg 측정 티어
  role text                                      -- top/jungle/mid/adc/sup (선택)
);

create table if not exists tournament_matches (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id) on delete cascade,
  round int not null,                            -- 1 = 첫 라운드
  pos int not null,                              -- 라운드 내 위치 (0-based)
  team_a uuid references tournament_teams(id) on delete set null,
  team_b uuid references tournament_teams(id) on delete set null,
  winner uuid references tournament_teams(id) on delete set null,
  score_a int,
  score_b int,
  created_at timestamptz default now()
);

create index if not exists idx_tour_group on tournaments(group_id);
create index if not exists idx_tteam_tour on tournament_teams(tournament_id);
create index if not exists idx_tmem_team on tournament_team_members(team_id);
create index if not exists idx_tmatch_tour on tournament_matches(tournament_id);

-- v1 이미 실행한 경우 대비 (idempotent)
alter table tournaments add column if not exists owner_id uuid;
alter table tournaments alter column group_id drop not null;

grant all on tournaments, tournament_teams, tournament_team_members, tournament_matches
  to service_role, anon, authenticated;

notify pgrst, 'reload schema';
