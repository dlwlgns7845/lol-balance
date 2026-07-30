-- 경기 결과 양측확인 (신뢰) — 팀 주장이 보고 → 상대 주장 확인 시 확정.
-- report_status: null(확정/미보고) | 'reported'(한쪽 보고, 상대 확인 대기) | 'disputed'(양측 불일치, 운영자 개입)
alter table tournament_matches add column if not exists reported_winner uuid;
alter table tournament_matches add column if not exists reported_by uuid;      -- 보고한 주장(auth.users.id)
alter table tournament_matches add column if not exists report_status text;

-- 스키마 캐시 리로드 (PostgREST)
notify pgrst, 'reload schema';
