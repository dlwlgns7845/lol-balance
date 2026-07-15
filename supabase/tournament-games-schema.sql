-- 🎮 멸망전 전용 경기 기록 (내전 matches와 분리). 리플 업로드 → 팀 로스터 자동 귀속 → 팀별·선수별 통계.
-- kind: 'scrim'(스크림/연습) | 'match'(실제 시합). 업로더 팀으로 귀속돼 구분.
create table if not exists tournament_games (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null,
  kind text not null default 'match',        -- 'scrim' | 'match'
  uploader_team_id uuid,                      -- 올린 사람의 팀 (귀속·구분용)
  uploader_user_id uuid,
  winner text,                               -- 'A' | 'B'
  duration_sec int default 0,
  objectives jsonb,                          -- 리플 팀 오브젝트 {A:{...}, B:{...}}
  participants jsonb not null default '[]',  -- [{team,name,champion,k,d,a,damage,cs,gold,tier,position,person_id,detail}]
  source text,                               -- 'replay'
  played_at timestamptz default now(),
  created_at timestamptz default now()
);
create index if not exists idx_tgames_tid on tournament_games(tournament_id);
notify pgrst, 'reload schema';
