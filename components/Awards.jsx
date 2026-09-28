'use client';
// 칭호 패널 — 서버(getAwards)가 개인+관계형 칭호를 다 계산해서 뱃지와 동일한 출처.
import { useEffect, useState } from 'react';
import { useGroup } from './GroupProvider.jsx';
import { useLang } from './i18n.jsx';

export default function Awards({ gid }) {
  const { showAwards } = useGroup() || {};
  const { t } = useLang();
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
    { ic: '🏆', title: t('공공의적'), sub: t('가장 잘 이기는 놈'),
      who: a.publicEnemy?.name, stat: a.publicEnemy ? t('승률 {pct}% · {wins}승 {losses}패', { pct: pct(a.publicEnemy.winrate), wins: a.publicEnemy.wins, losses: a.publicEnemy.losses }) : t('기록 쌓이면 등장') },
    { ic: '💥', title: t('캐리왕'), sub: t('평균 딜량 1위'),
      who: a.carryKing?.name, stat: a.carryKing ? t('평균 딜 {n}k', { n: (a.carryKing.avgDamage / 1000).toFixed(1) }) : t('기록 쌓이면 등장') },
    { ic: '👑', title: t('칭호왕'), sub: t('칭호를 가장 많이 보유'),
      who: a.titleKing?.name, stat: a.titleKing ? t('{n}개 보유', { n: a.titleKing.count }) : t('기록 쌓이면 등장') },
    { ic: '🏅', title: t('MVP왕'), sub: t('MVP 최다'),
      who: a.mvpKing?.name, stat: a.mvpKing ? t('{n}회 MVP', { n: a.mvpKing.mvp }) : t('기록 쌓이면 등장') },
    { ic: '⭐', title: t('ACE왕'), sub: t('패배 속 에이스 최다'),
      who: a.aceKing?.name, stat: a.aceKing ? t('{n}회 ACE', { n: a.aceKing.ace }) : t('기록 쌓이면 등장') },
    { ic: '🌾', title: t('농사왕'), sub: t('분당 CS 1위'),
      who: a.farmKing?.name, stat: a.farmKing ? t('분당 {n} CS', { n: a.farmKing.csPerMin }) : t('게임 시간 입력 필요') },
    { ic: '⚔️', title: t('킬러'), sub: t('누적 킬 1위'),
      who: a.killer?.name, stat: a.killer ? t('{n} 킬', { n: a.killer.totalK.toLocaleString() }) : t('기록 쌓이면 등장') },
    { ic: '💀', title: t('시체'), sub: t('누적 데스 1위'),
      who: a.corpse?.name, stat: a.corpse ? t('{n} 데스', { n: a.corpse.totalD.toLocaleString() }) : t('기록 쌓이면 등장') },
    { ic: '🔧', title: t('도구'), sub: t('누적 어시 1위'),
      who: a.tool?.name, stat: a.tool ? t('{n} 어시', { n: a.tool.totalA.toLocaleString() }) : t('기록 쌓이면 등장') },
    { ic: '🔥', title: t('연승중'), sub: t('현재 연속 승'),
      who: a.winStreak?.name, stat: a.winStreak ? t('{n}연승 🔥', { n: a.winStreak.streak }) : t('2연승+ 없음') },
    { ic: '🧊', title: t('연패중'), sub: t('현재 연속 패'),
      who: a.loseStreak?.name, stat: a.loseStreak ? t('{n}연패 🧊', { n: a.loseStreak.streak }) : t('2연패+ 없음') },
    { ic: '😈', title: t('인간상성'), sub: t('상대로 만나면 압살'),
      who: a.nemesis?.winner, stat: a.nemesis ? t('{name} 상대 {w}승 {l}패', { name: a.nemesis.loser, w: a.nemesis.wins, l: a.nemesis.losses }) : t('상대전적 3판+ 필요') },
    { ic: '🎮', title: t('고인물'), sub: t('내전 판수 1위'),
      who: a.gameAddict?.name, stat: a.gameAddict ? t('{n}판 출전', { n: a.gameAddict.games }) : t('기록 쌓이면 등장') },
    { ic: '💞', title: t('최고의 듀오'), sub: t('같은 팀 고승률'),
      who: a.bestDuo ? `${a.bestDuo.a} + ${a.bestDuo.b}` : null, stat: a.bestDuo ? t('승률 {pct}% · {games}판', { pct: pct(a.bestDuo.winrate), games: a.bestDuo.games }) : t('같은 팀 3판+ 필요') },
    { ic: '💔', title: t('견우와 직녀'), sub: t('같은 팀으로 가장 안 만난 둘'),
      who: a.starCrossed ? `${a.starCrossed.a} × ${a.starCrossed.b}` : null,
      stat: a.starCrossed ? (a.starCrossed.together === 0 ? t('한 번도 같은 팀 X') : t('같은 팀 {n}판뿐', { n: a.starCrossed.together })) : '' },
  ];

  return (
    <div className="panel awards">
      <h2>🎖 {t('칭호')} <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>· {t('우리 방 명예의 전당')}</span></h2>
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
