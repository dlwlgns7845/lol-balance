// CLI 데모: 엔진 검증용. (UI는 추후 Next.js)
import { balance } from './src/engine.js';
import { POS_KR } from './src/table.js';

const LIGHT = { green: '🟢 균형', yellow: '🟡 약간 기움', red: '🔴 불균형(로비 쏠림)' };

function renderCand(c, rank) {
  console.log(`\n  [후보 ${rank}] A ${c.sumA.toFixed(1)} vs B ${c.sumB.toFixed(1)}` +
    `  | 총점차 ${c.totalDiff.toFixed(1)} ${LIGHT[c.light]}` +
    `  | 최대 라인갭 ${c.maxGap.toFixed(1)}`);
  for (const l of c.lanes) {
    const warn = l.gap * l.weight >= 6 ? ' ⚠️' : '';
    const a = `${l.a.name}(${l.a.tier}) ${l.a.pts}`.padEnd(20);
    const b = `${l.b.name}(${l.b.tier}) ${l.b.pts}`.padEnd(20);
    console.log(`    ${POS_KR[l.pos].padEnd(4)} ${a} ${b} 갭 ${l.gap.toFixed(1)}${warn}`);
  }
}

function run(title, players, opts) {
  console.log(`\n${'#'.repeat(60)}\n# ${title}\n${'#'.repeat(60)}`);
  const res = balance(players, opts);
  if (res.outliers.length) {
    console.log('\n  ⚠️ 스머프/아웃라이어 감지:');
    for (const o of res.outliers)
      console.log(`    - ${o.name}(${o.tier}) : 로비 대비 +${o.z.toFixed(1)}σ → 라인 상대 부족`);
  }
  res.candidates.slice(0, 3).forEach((c, i) => renderCand(c, i + 1));
}

// 시나리오 1: 챌 스머프 낀 로비
const smurf = [
  { name: '태양', tier: 'M1300', positions: ['adc', 'mid'] },
  { name: '준호', tier: 'D2', positions: ['mid', 'top'] },
  { name: '성민', tier: 'D4', positions: ['top', 'jungle'] },
  { name: '동현', tier: 'P1', positions: ['mid'] },
  { name: '현우', tier: 'P3', positions: ['adc', 'mid'] },
  { name: '지훈', tier: 'E1', positions: ['jungle'] },
  { name: '건우', tier: 'G2', positions: ['jungle', 'sup'] },
  { name: '재현', tier: 'G3', positions: ['sup', 'adc'] },
  { name: '민수', tier: 'G1', positions: ['sup'] },
  { name: '우진', tier: 'S2', positions: ['top'] },
];

// 시나리오 2: 비슷한 실력대 로비
const even = [
  { name: 'A현', tier: 'E2', positions: ['top', 'mid'] },
  { name: 'B준', tier: 'E3', positions: ['jungle'] },
  { name: 'C민', tier: 'P1', positions: ['mid', 'adc'] },
  { name: 'D우', tier: 'P2', positions: ['adc', 'sup'] },
  { name: 'E훈', tier: 'P3', positions: ['sup', 'jungle'] },
  { name: 'F성', tier: 'E4', positions: ['top', 'jungle'] },
  { name: 'G재', tier: 'P1', positions: ['mid', 'sup'] },
  { name: 'H태', tier: 'P2', positions: ['adc', 'top'] },
  { name: 'I건', tier: 'P4', positions: ['sup', 'adc'] },
  { name: 'J양', tier: 'E3', positions: ['top', 'mid'] },
];

run('시나리오 1: 챌 스머프 낀 로비 (라인 우선 기본)', smurf);
run('시나리오 2: 비슷한 실력대 로비 — 상위 후보 3개', even);
run('시나리오 3: 같은 로비 + 고정(lock): 민수 무조건 서폿A, 동현 미드B', smurf,
  { locks: { sup: { A: '민수' }, mid: { B: '동현' } } });
