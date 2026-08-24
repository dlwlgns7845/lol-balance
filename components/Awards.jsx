'use client';
// 칭호 패널 — 서버(getAwards)가 개인+관계형 칭호를 다 계산해서 뱃지와 동일한 출처.
import { useEffect, useState } from 'react';
import { useGroup } from './GroupProvider.jsx';

export default function Awards({ gid }) {
  const { showAwards } = useGroup() || {};
  const [a, setA] = useState(null);
  useEffect(() => {
    if (!gid || showAwards === false) return;
    fetch('/api/awards?gid=' + gid).then((x) => x.json()).then((r) => r.ok && setA(r.awards || {}));
  }, [gid, showAwards]);
  if (showAwards === false) return null; // 방 설정에서 칭호 숨김
  if (!a) return null;

  const pct = (w) => Math.round(w * 100);
  // 순서: 3열 그리드로 행 단위 의미 묶음 (승률/기여 · 랭킹왕 · 누적 · 스트릭·상성 · 판수·관계)
  const cards = [
    { ic: '🏆', title: '공공의적', sub: '가장 잘 이기는 놈',
      who: a.publicEnemy?.name, stat: a.publicEnemy ? `승률 ${pct(a.publicEnemy.winrate)}% · ${a.publicEnemy.wins}승 ${a.publicEnemy.losses}패` : '기록 쌓이면 등장' },
    { ic: '💥', title: '캐리왕', sub: '평균 딜량 1위',
      who: a.carryKing?.name, stat: a.carryKing ? `평균 딜 ${(a.carryKing.avgDamage / 1000).toFixed(1)}k` : '기록 쌓이면 등장' },
    { ic: '🚫', title: '기피대상', sub: '가장 못 이기는 팀원',
      who: a.avoidPick?.name, stat: a.avoidPick ? `승률 ${pct(a.avoidPick.winrate)}% · ${a.avoidPick.wins}승 ${a.avoidPick.losses}패` : '기록 쌓이면 등장' },
    { ic: '🏅', title: 'MVP왕', sub: 'MVP 최다',
      who: a.mvpKing?.name, stat: a.mvpKing ? `${a.mvpKing.mvp}회 MVP` : '기록 쌓이면 등장' },
    { ic: '⭐', title: 'ACE왕', sub: '패배 속 에이스 최다',
      who: a.aceKing?.name, stat: a.aceKing ? `${a.aceKing.ace}회 ACE` : '기록 쌓이면 등장' },
    { ic: '🌾', title: '농사왕', sub: '분당 CS 1위',
      who: a.farmKing?.name, stat: a.farmKing ? `분당 ${a.farmKing.csPerMin} CS` : '게임 시간 입력 필요' },
    { ic: '⚔️', title: '킬러', sub: '누적 킬 1위',
      who: a.killer?.name, stat: a.killer ? `${a.killer.totalK.toLocaleString()} 킬` : '기록 쌓이면 등장' },
    { ic: '💀', title: '시체', sub: '누적 데스 1위',
      who: a.corpse?.name, stat: a.corpse ? `${a.corpse.totalD.toLocaleString()} 데스` : '기록 쌓이면 등장' },
    { ic: '🔧', title: '도구', sub: '누적 어시 1위',
      who: a.tool?.name, stat: a.tool ? `${a.tool.totalA.toLocaleString()} 어시` : '기록 쌓이면 등장' },
    { ic: '🔥', title: '연승중', sub: '현재 연속 승',
      who: a.winStreak?.name, stat: a.winStreak ? `${a.winStreak.streak}연승 🔥` : '2연승+ 없음' },
    { ic: '🧊', title: '연패중', sub: '현재 연속 패',
      who: a.loseStreak?.name, stat: a.loseStreak ? `${a.loseStreak.streak}연패 🧊` : '2연패+ 없음' },
    { ic: '😈', title: '인간상성', sub: '상대로 만나면 압살',
      who: a.nemesis?.winner, stat: a.nemesis ? `${a.nemesis.loser} 상대 ${a.nemesis.wins}승 ${a.nemesis.losses}패` : '상대전적 3판+ 필요' },
    { ic: '🎮', title: '고인물', sub: '내전 판수 1위',
      who: a.gameAddict?.name, stat: a.gameAddict ? `${a.gameAddict.games}판 출전` : '기록 쌓이면 등장' },
    { ic: '💞', title: '최고의 듀오', sub: '같은 팀 고승률',
      who: a.bestDuo ? `${a.bestDuo.a} + ${a.bestDuo.b}` : null, stat: a.bestDuo ? `승률 ${pct(a.bestDuo.winrate)}% · ${a.bestDuo.games}판` : '같은 팀 3판+ 필요' },
    { ic: '💔', title: '견우와 직녀', sub: '같은 팀으로 가장 안 만난 둘',
      who: a.starCrossed ? `${a.starCrossed.a} × ${a.starCrossed.b}` : null,
      stat: a.starCrossed ? (a.starCrossed.together === 0 ? '한 번도 같은 팀 X' : `같은 팀 ${a.starCrossed.together}판뿐`) : '' },
  ];

  return (
    <div className="panel awards">
      <h2>🎖 칭호 <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>· 우리 방 명예의 전당</span></h2>
      <div className="award-grid">
        {cards.map((c, i) => (
          <div className={`award-card ${c.who ? `aw-fx${(i % 3) + 1}` : 'empty'}`} key={c.title}>
            <span className="aw-ic">{c.ic}</span>
            <div className="aw-body">
              <div className="aw-title">{c.title} <span className="aw-sub">{c.sub}</span></div>
              <div className="aw-who">{c.who || '—'}</div>
              <div className="aw-stat">{c.stat}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
