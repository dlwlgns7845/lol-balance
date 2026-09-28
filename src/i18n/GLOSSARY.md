# i18n 규칙 + 용어집 (KO → EN)

## 규칙
- 코드: 한국어 원문을 그대로 `t('원문')` 으로 감싼다. 원문 = 사전 키 (정확히 일치, 공백·문장부호 포함).
- 컴포넌트 안: `const { t } = useLang();` 또는 `const t = useT();` (`components/i18n.jsx`).
  훅을 못 쓰는 곳(모듈 함수, 컴포넌트 밖 헬퍼): `tt('원문')` — 단, 렌더 결과엔 쓰지 말 것(언어 바꿔도 재렌더 안 됨). 렌더용 헬퍼는 `t` 를 인자로 받게 바꾼다.
- 값이 섞이면 템플릿 리터럴 대신 자리표시자: `` `${n}명` `` → `t('{n}명', { n })`. 영어 값도 `{n}` 유지.
- 이모지는 가능하면 `t()` 밖에: `📊 {t('내 전적')}`.
- 모듈 상수(라벨 배열 등)는 한국어 그대로 두고 **렌더 지점에서** `t(label)`.
- 서버가 준 에러 메시지 표시: `t(e.message)` / `t(r.error)` (정적은 server.js 사전, 값 섞인 건 patterns.js).
- 사람 이름·챔피언 이름·방 이름 등 **사용자 데이터는 번역하지 않는다.**
- 주석은 번역하지 않는다 (한국어 그대로).
- 디스코드 봇(`app/api/discord/`)과 봇 전용 모듈은 건드리지 않는다 (봇은 한국어 유지).
- 영어 톤: 짧고 자연스러운 제품 UI 영어. 직역 금지. 버튼은 동사 원형(Save, Add result), 문장은 마침표.

## 용어집 (반드시 통일)
| KO | EN |
|---|---|
| 내전 | inhouse (game) |
| 방 / 방 코드 / 방장 | room / room code / owner |
| 편집자 / 기록담당(recorder) / 뷰어 | editor / recorder / viewer |
| 멸망전 | tournament |
| 밸런서 / 밸런스 | Balancer / balance |
| 오늘 내전 / 모집 | Today’s Inhouse / sign-up (queue) |
| 멤버 관리 | Members |
| 점수표 | Score Table |
| 통계 / 전적 | Stats / match history |
| 결과 추가 / 기록 | Add result / record |
| 구경 모드 | View only |
| 칭호 / 명예의 전당 | titles / Hall of Fame |
| 승률 보정(티어보정) | win-rate adjustment |
| 수동 보정 | manual adjustment |
| 티어 / 점수 | tier / score (points = pts) |
| 포지션·라인 / 주라인 / 부라인 | role / main role / secondary role |
| 탑·정글·미드·원딜·서폿 | Top·Jungle·Mid·ADC·Support |
| 올라운더 | Fill |
| 고저분리 / 4팀 균등 | High/Low split / 4-team even |
| 승·패 / 승률 / 판 | W·L / win rate / game(s) |
| 킬·데스·어시 / 딜량 | K·D·A / damage |
| 신고 | report(s) |
| 관리자 | admin |
| 경매 / 대진 / 체크인 / 주장 | auction / bracket / check-in / captain |
| 리플(.rofl) / 스크린샷 | replay / screenshot |
| 본캐 / 부캐 | main account / alt account |
| 명 (인원) | players (예: `{n}명` → `{n} players`) |
