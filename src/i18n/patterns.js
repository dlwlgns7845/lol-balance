// 동적 메시지(값이 섞여 오는 서버 에러·알림) → 영어. [정규식, (...캡처) => 영어] 순서대로 첫 매치 적용.
// 정적 문구는 여기 말고 en/*.js 사전에 넣을 것. 정규식은 ^…$ 로 앵커링 — 전체 문자열이 그 메시지 하나일 때만 매치.

// src/tournament-settings.js TIER_BASIS_LABEL 값 → 영어 (자격검증 에러 문장 조립용)
const BASIS_EN = {
  '현재 시즌 티어': 'current-season tier',
  '현재 시즌 최고': 'current-season peak',
  '지난 시즌 티어': 'last-season tier',
  '역대 최고 티어': 'all-time peak tier',
};

const PATTERNS = [
  // app/api/seed/route.js: '조회 실패: ' + e.message
  [/^조회 실패: ([\s\S]+)$/, (msg) => `Lookup failed: ${msg}`],

  // src/repo.js
  [/^이 선수는 (\d+)경기 기록이 있어 삭제할 수 없어요\. \(기록 보호\) — 중복이면 '병합', 잘못된 연동이면 '연동 해제'를 쓰세요\.$/,
    (count) => `This player has ${count} recorded games and can’t be deleted. (Records are protected) — use “Merge” for duplicates, or “Unlink” for a wrong connection.`],
  [/^이 방에 계정\(([\s\S]+?)\)이 이미 "([\s\S]+?)" 에 등록돼 있어요\. 같은 사람이면 '합치기'를 쓰세요\.$/,
    (acct, owner) => `The account (${acct}) is already registered to "${owner}" in this room. Use “Merge” if it’s the same person.`],
  [/^이 방에 계정\(([\s\S]+?)\)이 이미 등록돼 있어요\.$/,
    (acct) => `The account (${acct}) is already registered in this room.`],

  // src/repo-tournament.js
  [/^"([\s\S]+?)" 계정을 찾을 수 없어요 \(게임 닉·태그 확인\)$/,
    (acct) => `Couldn’t find the account "${acct}" (check the game nickname/tag).`],
  [/^([\s\S]+?): 티어 미확인 — 배정 후 가능$/, (name) => `${name}: tier not confirmed — possible after assignment`],
  [/^([\s\S]+?): 티어 미확인 — 배정 불가$/, (name) => `${name}: tier not confirmed — can’t assign`],
  [/^팀 합계 (\d+(?:\.\d+)?)점이 상한 (\d+(?:\.\d+)?)점을 초과해요$/,
    (total, cap) => `Team total (${total} pts) exceeds the cap (${cap} pts).`],
  [/^합계가 상한 (\d+(?:\.\d+)?)점을 초과해요$/, (cap) => `The total exceeds the cap (${cap} pts).`],
  [/^예산 부족 \(남은 (-?\d+(?:\.\d+)?) < (-?\d+(?:\.\d+)?)\)$/,
    (have, need) => `Not enough budget (have ${have}, need ${need}).`],
  [/^팀장 (\d+)명을 뽑기엔 신청자가 부족해요 \((\d+)명\)$/,
    (n, avail) => `Not enough applicants to pick ${n} captains (only ${avail}).`],
  [/^현재가 (\d+(?:\.\d+)?)p보다 높게 입찰하세요$/, (cur) => `Bid higher than the current price (${cur}p).`],
  [/^그룹 (\d+)개엔 팀이 부족해요 \(조당 2팀 이상 필요\)$/,
    (n) => `Not enough teams for ${n} groups (each group needs at least 2 teams).`],

  // src/tournament-settings.js (자격검증 에러 — chk.errors 배열의 단일 항목일 때 매치)
  [/^로스터가 최소 (\d+)명이어야 해요 \(현재 (\d+)명\)$/,
    (min, n) => `The roster needs at least ${min} players (currently ${n}).`],
  [/^로스터는 최대 (\d+)명까지예요 \(현재 (\d+)명\)$/,
    (max, n) => `The roster can have at most ${max} players (currently ${n}).`],
  [/^([\s\S]+?): (현재 시즌 티어|현재 시즌 최고|지난 시즌 티어|역대 최고 티어) 상한\(([\s\S]+?)\) 초과 \(([\s\S]+?)\)$/,
    (name, basis, cap, tier) => `${name}: exceeds the ${BASIS_EN[basis] || basis} cap (${cap}) — currently ${tier}`],
  [/^([\s\S]+?): (현재 시즌 티어|현재 시즌 최고|지난 시즌 티어|역대 최고 티어) 하한\(([\s\S]+?)\) 미달 \(([\s\S]+?)\)$/,
    (name, basis, floor, tier) => `${name}: below the ${BASIS_EN[basis] || basis} floor (${floor}) — currently ${tier}`],
  [/^([\s\S]+?): 현재 시즌 판수 부족 \((\d+) < (\d+)\)$/,
    (name, games, min) => `${name}: not enough current-season games (${games} < ${min})`],
  [/^([\s\S]+?): 레벨 부족 \((\d+) < (\d+)\)$/,
    (name, lvl, min) => `${name}: level too low (${lvl} < ${min})`],

  // src/rofl.js
  [/^경기 기록이 10명이 아니에요 \((\d+)명 — 리메이크\/커스텀\?\)\.$/,
    (n) => `The game record doesn’t have 10 players (${n} — remake or custom game?).`],

  // src/vision.js
  [/^GPT 호출 실패 \((\d+)\) ([\s\S]*)$/, (status, detail) => `GPT call failed (${status}) ${detail}`],
];

export default PATTERNS;
