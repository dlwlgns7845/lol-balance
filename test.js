// 엔진 스모크 테스트 (프레임워크 없이 node:assert). 실행: node test.js
import assert from 'node:assert';
import { balance, detectOutliers, tierPts } from './src/engine.js';
import { parseProfile, mapTier } from './src/opgg.js';
import { hitLimit, checkLimit, recordFail } from './src/ratelimit.js';

const even = [
  { name: 'A', tier: 'E2', positions: ['top', 'mid'] },
  { name: 'B', tier: 'E3', positions: ['jungle'] },
  { name: 'C', tier: 'P1', positions: ['mid', 'adc'] },
  { name: 'D', tier: 'P2', positions: ['adc', 'sup'] },
  { name: 'E', tier: 'P3', positions: ['sup', 'jungle'] },
  { name: 'F', tier: 'E4', positions: ['top', 'jungle'] },
  { name: 'G', tier: 'P1', positions: ['mid', 'sup'] },
  { name: 'H', tier: 'P2', positions: ['adc', 'top'] },
  { name: 'I', tier: 'P4', positions: ['sup', 'adc'] },
  { name: 'J', tier: 'E3', positions: ['top', 'mid'] },
];

let pass = 0;
function t(name, fn) { fn(); pass++; console.log('  ✓', name); }

t('점수표 조회', () => {
  assert.equal(tierPts('M1800+', 0), 67);
  assert.equal(tierPts('S3-', 4), 15);
});

t('커스텀 점수표 주입', () => {
  const custom = { G2: [100, 100, 100, 100, 100] };
  assert.equal(tierPts('G2', 0, custom), 100); // 커스텀 표 사용
  assert.equal(tierPts('G2', 0), 17.7);        // 기본 표 그대로
});

t('균형 로비 → 라인갭 작고 총점차 작음', () => {
  const { candidates, feasible } = balance(even);
  assert.ok(feasible);
  assert.ok(candidates[0].maxGap <= 3, `maxGap=${candidates[0].maxGap}`);
  assert.ok(candidates[0].totalDiff <= 3);
  assert.equal(candidates[0].light, 'green');
});

t('각 팀 정확히 5명·포지션 1개씩, 중복 배치 없음', () => {
  const c = balance(even).candidates[0];
  const names = new Set();
  for (const l of c.lanes) { names.add(l.a.name); names.add(l.b.name); }
  assert.equal(names.size, 10);
  assert.equal(c.lanes.length, 5);
});

t('후보들은 서로 다른 배치 (dedup)', () => {
  const c = balance(even, { topK: 3 }).candidates;
  const sigs = new Set(c.map((x) => x.lanes.map((l) => `${l.a.pts}-${l.b.pts}`).join()));
  assert.equal(sigs.size, c.length);
});

t('스머프 감지', () => {
  const smurf = even.map((p, i) => (i === 0 ? { ...p, tier: 'M1300' } : p));
  const out = detectOutliers(smurf);
  assert.ok(out.some((o) => o.name === 'A' && o.z >= 1.5));
});

t('lock: 고정한 선수는 지정 포지션/팀에 배치', () => {
  const c = balance(even, { locks: { sup: { A: 'E' } } }).candidates[0];
  const sup = c.lanes.find((l) => l.pos === 'sup');
  assert.equal(sup.a.name, 'E');
});

t('lock: 로스터에 없는 이름은 크래시 대신 명확한 에러', () => {
  assert.throws(() => balance(even, { locks: { sup: { A: '없는사람' } } }), /로스터에 없습니다/);
});

t('라인우선 기본값은 총점완벽·라인압살 해를 1순위로 안 뽑음', () => {
  // 라인갭 작은 해가 총점차 약간 있어도 상위
  const c = balance(even).candidates[0];
  assert.ok(c.maxGap < 5);
});

t('분포: 최저티어 둘은 반대팀으로 갈라짐', () => {
  // 약한 둘(텐덕·니모)이 한 팀에 몰리면 안 됨
  const roster = [
    { name: '류지학', tier: 'M700', positions: ['sup'] },
    { name: '아츄', tier: 'M600', positions: ['adc'] },
    { name: '아리스', tier: 'M0', positions: ['top'] },
    { name: '포로', tier: 'M300', positions: ['jungle'] },
    { name: '만두', tier: 'M100', positions: ['jungle'] },
    { name: '텐덕', tier: 'P4', positions: ['top'] },
    { name: '니모', tier: 'P4', positions: ['mid', 'sup'] },
    { name: '민초', tier: 'D4', positions: ['jungle', 'adc'] },
    { name: '일쿠', tier: 'M0', positions: ['mid', 'sup'] },
    { name: '찬우', tier: 'D4', positions: ['mid', 'adc'] },
  ];
  const c = balance(roster).candidates[0];
  const team = (n) => (c.lanes.find((l) => l.a.name === n) ? 'A' : 'B');
  assert.notEqual(team('텐덕'), team('니모'));
});

t('주/부 선호: 주포지션으로 균형 가능하면 부포지션 안 씀', () => {
  const P = (name, tier, prim, sec) =>
    ({ name, tier, positions: sec ? [prim, sec] : [prim], primary: [prim] });
  const r = [
    P('탑1', 'G2', 'top', 'mid'), P('탑2', 'G3', 'top'),
    P('정1', 'G2', 'jungle', 'top'), P('정2', 'G3', 'jungle'),
    P('미1', 'G2', 'mid', 'adc'), P('미2', 'G3', 'mid'),
    P('원1', 'G2', 'adc', 'sup'), P('원2', 'G3', 'adc'),
    P('서1', 'G2', 'sup'), P('서2', 'G3', 'sup', 'mid'),
  ];
  assert.equal(balance(r).candidates[0].offRole, 0);
});

t('선호정보 없으면(구버전) 페널티 0 — 하위호환', () => {
  const c = balance(even).candidates[0];
  assert.equal(c.offRole, 0);
});

t('op.gg 티어 매핑', () => {
  assert.equal(mapTier('GRANDMASTER', 1, 1696), 'M1600');
  assert.equal(mapTier('CHALLENGER', 1, 1850), 'M1800+');
  assert.equal(mapTier('MASTER', 1, null), 'M0');
  assert.equal(mapTier('EMERALD', 2, 18), 'E2');
  assert.equal(mapTier('DIAMOND', 4, null), 'D4');
  assert.equal(mapTier('SILVER', 3, null), 'S3-');
  assert.equal(mapTier('IRON', 4, null), 'S3-');
});

t('op.gg 응답 파싱 — 현재 솔랭 우선', () => {
  const text = 'LolGetSummonerProfile(Data(Summoner("Hide on bush","KR1",' +
    '[LeagueStat("SOLORANKED",288,239,TierInfo("GRANDMASTER",1,1696)),' +
    'LeagueStat("FLEXRANKED",null,null,TierInfo(null,null,null)),' +
    'LeagueStat("ARENA",null,null,TierInfo(null,null,null))],' +
    '[PreviousSeason(29,TierInfo1("CHALLENGER",1)),PreviousSeason(25,TierInfo1("DIAMOND",1))])))';
  const p = parseProfile(text);
  assert.equal(p.gameName, 'Hide on bush');
  assert.equal(p.suggestedTier, 'M1600');
  assert.equal(p.basis, '현재 솔랭');
  assert.equal(p.peak.tier, 'CHALLENGER');
  assert.equal(p.games, 527);
  assert.equal(p.confidence, 'high');
});

t('op.gg 파싱 — 솔랭 미배치면 자유랭 폴백', () => {
  const text = 'Summoner("Unknown","Nyang",' +
    '[LeagueStat("SOLORANKED",0,1,TierInfo(null,null,null)),' +
    'LeagueStat("FLEXRANKED",7,6,TierInfo("EMERALD",2,18))],' +
    '[PreviousSeason(29,TierInfo1("CHALLENGER",1))])';
  const p = parseProfile(text);
  assert.equal(p.suggestedTier, 'E2');
  assert.equal(p.basis, '현재 자유랭');
  assert.equal(p.games, 13);
  assert.equal(p.confidence, 'low'); // 13판 < 30 → 낮음
});

// 레이트리밋 (인메모리 경로) — async라 t() 밖에서 top-level await
{
  const fakeReq = (ip) => ({ headers: { get: (h) => (h === 'x-forwarded-for' ? ip : null) } });

  const r1 = fakeReq('10.0.0.1');
  await hitLimit(r1, 'test-hit', 2, 60);
  await hitLimit(r1, 'test-hit', 2, 60);
  await assert.rejects(() => hitLimit(r1, 'test-hit', 2, 60), (e) => e.status === 429);
  await hitLimit(fakeReq('10.0.0.2'), 'test-hit', 2, 60); // 다른 IP는 독립 카운터
  pass++; console.log('  ✓ 레이트리밋: 한도 초과 429, IP별 독립');

  const r2 = fakeReq('10.0.0.3');
  await checkLimit(r2, 'test-miss', 2, 60);       // 실패 0회 → 통과
  await recordFail(r2, 'test-miss', 60);
  await recordFail(r2, 'test-miss', 60);
  await assert.rejects(() => checkLimit(r2, 'test-miss', 2, 60), (e) => e.status === 429);
  pass++; console.log('  ✓ 레이트리밋: 실패만 카운트(방코드 브루트포스) → 한도 도달 시 차단');
}

console.log(`\n${pass} passed`);
