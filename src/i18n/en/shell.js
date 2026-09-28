// EN 사전 — 셸(첫 화면 게이트·상단바·설정 모달·대회 레이아웃). 키 = 코드의 한국어 원문(정확히 일치).
const EN = {
  // 첫 화면(게이트)
  '로그인이 아직 설정되지 않았어요 (관리자 설정 필요)': 'Sign-in isn’t configured yet (admin setup required)',
  '방 코드를 입력하세요': 'Enter a room code',
  '먼저 로그인하세요 (디스코드 권장).': 'Please sign in first (Discord recommended).',
  '✅ 이제 이 방의 방장이에요! 편집 권한이 적용됩니다.': '✅ You now own this room! Editing permissions are active.',
  '방장 되기 실패: ': 'Couldn’t claim the room: ',
  '칭호 설정 변경 실패: ': 'Couldn’t change the titles setting: ',
  '승률 보정 설정 변경 실패: ': 'Couldn’t change the win-rate adjustment setting: ',
  '입장 실패: ': 'Couldn’t enter: ',
  '정말 "{name}" 방을 삭제할까요?\n이 방의 모든 경기·통계·사람·멤버가 영구 삭제됩니다. 되돌릴 수 없어요.':
    'Delete the room "{name}"?\nAll games, stats, players and members in it will be permanently deleted. This can’t be undone.',
  '방이 삭제됐어요.': 'The room was deleted.',
  '방 삭제 실패: ': 'Couldn’t delete the room: ',
  'AI 밸런싱 · 스크린샷 자동 기록': 'AI team balancing · Auto-recorded from screenshots',
  '로그인됨': 'Signed in',
  '로그아웃': 'Sign out',
  '디스코드로 로그인': 'Sign in with Discord',
  '또는 구글로 로그인': 'or sign in with Google',
  '방을 만들면 방장이 돼요.': 'Creating a room makes you its owner.',
  '로그인 없이도 방 코드로 구경 가능. 방을 만들거나 기록하려면 로그인하세요.':
    'You can browse any room with its code — no sign-in needed. Sign in to create a room or record games.',
  '내전 방 입장': 'Enter an inhouse room',
  '방 코드 (예: bingsu)': 'Room code (e.g. bingsu)',
  '방 이름 (새로 만들 때, 예: 빙수방 내전)': 'Room name (when creating, e.g. Bingsu Inhouse)',
  '들어가기 (구경)': 'Enter (view)',
  '새 방 만들기': 'Create room',
  '멸망전 (커뮤니티 대회)': 'Tournaments (community)',
  '내전과 별개 · 팀 신청/대진/진행': 'Separate from inhouse · Team sign-up, brackets & results',

  // 상단바·내비
  '통계': 'Stats',
  '밸런서': 'Balancer',
  '오늘 내전': 'Today’s Inhouse',
  '멤버 관리': 'Members',
  '점수표': 'Score Table',
  '신고': 'Reports',
  '관리자': 'Admin',
  '내전 밸런스 · 통계': 'Inhouse Balance · Stats',
  '{name} 전적': '{name}’s history',
  '내 전적': 'My stats',
  '구경 모드': 'View only',
  '결과 추가': 'Add result',
  '이 방(주인 없음)의 방장이 되어 권한을 관리합니다': 'Become the owner of this (ownerless) room and manage permissions',
  '방장 되기': 'Claim room',
  '디스코드': 'Discord',
  '설정 · 방 권한': 'Settings · Room access',
  '설정': 'Settings',
  '로그인 기록 삭제 후 로그아웃': 'Clear my sign-in traces & sign out',
  '로그인': 'Sign in',
  '방 전환': 'Switch room',
  '티어·전적 데이터 제공:': 'Tier & match data by',
  '내 로그인 기록(관람 흔적·이메일 노출)을 지우고 로그아웃할까요?\n\n다시 로그인하면 정상적으로 이용할 수 있어요.':
    'Clear your sign-in traces (visit history, email exposure) and sign out?\n\nYou can sign in again anytime to keep using the app.',

  // 설정 모달
  '닫기': 'Close',
  '언어': 'Language',
  '이 브라우저에만 적용돼요': 'Applies to this browser only',
  '방 설정 · 권한': 'Room settings · Access',
  '칭호 표시': 'Show titles',
  '명예의 전당 + 이름 옆 칭호 뱃지 (공공의적·시체 등)': 'Hall of Fame + title badges next to names',
  '승률 보정 (티어보정)': 'Win-rate adjustment',
  '내전 승률로 밸런스 점수 ±6 조정 · 판수 적으면 자동 축소 (극단은 관리자 수동)':
    'Adjusts balance score by up to ±6 based on inhouse win rate · scaled down automatically for few games (extreme cases: manual)',

  // 대회 레이아웃
  '대회를 만들었어요! 📋\n관리자 승인 후 목록에 공개돼요. 승인 전에도 이 링크로 준비할 수 있어요.':
    'Tournament created! 📋\nIt will be listed publicly after admin approval. You can prepare it via this link in the meantime.',
  '실패: ': 'Failed: ',
  '실패': 'Failed',
  '멸망전': 'Tournament',
  '공지': 'Notice',
  '신청·점수': 'Sign-up · Points',
  '일정·결과': 'Schedule · Results',
  '경매': 'Auction',
  '전체 관리': 'Manage all',
  '방 입장': 'Enter room',
  '대회 목록': 'Tournaments',
  '목록 접기': 'Collapse list',
  '접기': 'Collapse',
  '아직 없어요': 'None yet',
  '승인 대기 (관리자만 보임)': 'Pending approval (visible to admins only)',
  '대기': 'Pending',
  '전체 관리 · 승인': 'Manage all · Approvals',
  '새 대회': 'New tournament',
  '대회 이름': 'Tournament name',
  '{n}팀': '{n} teams',
  '만들기': 'Create',
  '대회 목록 펴기': 'Expand list',
  '목록': 'List',

  // ── 공통 표준 번역 — 여러 화면이 같은 키를 쓰는 것. shell은 병합 순서상 마지막이라 여기 값이 전 화면에 적용됨.
  '신청': 'Sign up',
  '{n}명': '{n} players',
  '해제': 'Remove',
  '서버': 'Server',
  '사람 추가': 'Add player',
  '경기 기록': 'Record a game',
  '포지션': 'Role',
  '디코에서': 'On Discord, run',
  '팀 이름을 입력하세요': 'Enter a team name.',
  '평균 딜량': 'Avg damage',
  '평균 CS': 'Avg CS',
  '같은 라인 만났을 때 승률': 'Win rate when facing them in the same lane',
  '멀티킬': 'Multikills',
  '참여 경기': 'Games played',
  '모스트': 'Most played',
  '리플 분석 실패: ': 'Couldn’t parse the replay: ',
  '(보정승률×0.9 + ln(판수)×5 + √KDA×12 + 딜량(k)×0.4) × 판수신뢰도(8판=100%)': '(adj. win rate×0.9 + ln(games)×5 + √KDA×12 + dmg(k)×0.4) × confidence (8 games = 100%)',
};

// 티어 라벨(src/table.js TIER_LABEL)의 마스터 이상 점수 구간 — 밸런서·멤버·통계 공통 표기
const APEX_BANDS = ['1800+', '1700~1799', '1600~1699', '1500~1599', '1400~1499', '1300~1399', '1200~1299', '1100~1199',
  '1000~1099', '900~999', '800~899', '700~799', '600~699', '500~599', '400~499', '300~399', '200~299', '100~199', '0~99'];
for (const b of APEX_BANDS) EN[`마/그/챌 ${b}`] = `Master+ ${b.replace('~', '–')}`; // 짧게: 드롭다운 폭 안에 들어가게

export default EN;
