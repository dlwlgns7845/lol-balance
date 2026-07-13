-- ⏱ 경매 타이머 + 신청자 유저 매핑 (팀장 자동 입찰권)
alter table tournament_pool add column if not exists user_id uuid;          -- 신청한 유저(로그인)
alter table tournament_auction add column if not exists bid_deadline timestamptz; -- 현재 경매 마감시각
notify pgrst, 'reload schema';
