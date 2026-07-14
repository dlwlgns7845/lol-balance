-- 🏅 점수제 팀 = 방장 승인제(합류 신청 → 방장 수락). 동의 없이 남을 팀에 못 넣게.
-- team_members에 신청자(pool) 연결 · 로그인 유저 · 합류 상태 추가.
--   join_status: 'approved'(로스터 확정) | 'requested'(합류 대기)
--   기존 행(경매·로스터 팀)은 default 'approved'라 그대로 로스터로 취급.
alter table tournament_team_members add column if not exists pool_id uuid;
alter table tournament_team_members add column if not exists user_id uuid;
alter table tournament_team_members add column if not exists join_status text not null default 'approved';
create index if not exists idx_ttm_user on tournament_team_members(user_id);
notify pgrst, 'reload schema';
