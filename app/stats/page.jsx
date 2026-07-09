'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { TIER_LABEL, tierClass } from '../../src/table.js';
import { useGroup } from '../../components/GroupProvider.jsx';
import { useDdragon } from '../../components/ddragon.js';
import ChampImg from '../../components/ChampImg.jsx';
import PlayerCard from '../../components/PlayerCard.jsx';
import MatchHistory from '../../components/MatchHistory.jsx';
import Awards from '../../components/Awards.jsx';
import Avatar from '../../components/Avatar.jsx';

function wrClass(w) { return w >= 0.6 ? 'green' : w >= 0.5 ? 'yellow' : 'red'; }
const medal = (i) => ['🥇', '🥈', '🥉'][i] || null;

function SortHead({ label, col, sort, onSort }) {
  const on = sort.key === col;
  return (
    <span className="sort-head">
      <span className="sh-lb">{label}</span>
      <span className="sh-arrows">
        <button className={on && sort.dir === 'asc' ? 'on' : ''} onClick={() => onSort(col, 'asc')} title="오름차순">▲</button>
        <button className={on && sort.dir === 'desc' ? 'on' : ''} onClick={() => onSort(col, 'desc')} title="내림차순">▼</button>
      </span>
    </span>
  );
}

export default function StatsPage() {
  const { group } = useGroup();
  const gid = group?.id;
  const dd = useDdragon();
  const router = useRouter();
  const [data, setData] = useState(null);
  const [champs, setChamps] = useState(null);
  const [tab, setTab] = useState('lb');
  const [lane, setLane] = useState('all'); // 리더보드 라인 필터
  const [sort, setSort] = useState({ key: 'score', dir: 'desc' }); // 리더보드 정렬
  const [sel, setSel] = useState(null);
  const [q, setQ] = useState('');       // 전적검색 입력
  const [focus, setFocus] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (!gid) return;
    setLoading(true); setData(null); setChamps(null);
    fetch('/api/stats?gid=' + gid).then((x) => x.json())
      .then((r) => { if (r.ok) setData(r); else setErr(r.error); })
      .catch((e) => setErr(e.message)).finally(() => setLoading(false));
  }, [gid]);

  useEffect(() => {
    if (tab === 'champ' && gid && !champs) {
      fetch('/api/champion-stats?gid=' + gid).then((x) => x.json()).then((r) => r.ok && setChamps(r.champions));
    }
  }, [tab, gid, champs]);

  const MIN_RANK_GAMES = 3; // 리더보드는 3판 이상만 (1~2판 반짝 1등 방지)
  const players = data?.players || [];
  const played = players.filter((p) => p.games > 0);
  const ranked = played.filter((p) => p.games >= MIN_RANK_GAMES);
  // 사람 많아지면 true로 다시 켜기 (표본 적을 땐 라인별/정렬이 큰 의미 없어서 잠시 off)
  const LANE_LB_ENABLED = false; // 포지션별(라인) 리더보드 탭
  const SORT_ENABLED = false;    // 정렬 가능한 표 헤더
  const LANE_TABS = [['all', '전체'], ['top', '탑'], ['jungle', '정글'], ['mid', '미드'], ['adc', '원딜'], ['sup', '서폿']];
  const lbList = (LANE_LB_ENABLED && lane !== 'all') ? (data?.lanes?.[lane] || []) : ranked;
  const sortedLb = [...lbList].sort((a, b) => {
    const va = a[sort.key] ?? -Infinity, vb = b[sort.key] ?? -Infinity;
    return sort.dir === 'desc' ? vb - va : va - vb;
  });
  const rowsToShow = SORT_ENABLED ? sortedLb : lbList;
  const maxDmg = Math.max(1, ...lbList.map((p) => p.avgDamage || 0)); // 딜량 막대 기준 (표시 목록 중 최대)
  const setSortDir = (key, dir) => setSort({ key, dir });
  // 통계 카드(최고승률·딜량·CS·챔프폭)도 3판 이상만 (1~2판 반짝 1등 방지)
  const best = (arr, key) => arr.reduce((b, p) => (!b || (p[key] || 0) > (b[key] || 0) ? p : b), null);
  // 최고 승률: 라플라스 보정 승률로 선정 (3판 100%가 영구 박제되는 것 방지) → 표시는 실제 승률
  const adjWr = (p) => (p.wins + 2) / (p.games + 4);
  const topWr = ranked.reduce((b, p) => (!b || adjWr(p) > adjWr(b) ? p : b), null);
  const topPool = best(ranked, 'champPool');
  const topCsMin = best(ranked.filter((p) => p.csPerMin != null), 'csPerMin');
  const topDmg = best(ranked.filter((p) => p.statGames), 'avgDamage');
  const max = useMemo(() => ({
    kda: Math.max(1, ...played.map((p) => p.kda || 0)),
    dmg: Math.max(1, ...played.map((p) => p.avgDamage || 0)),
    cs: Math.max(1, ...played.map((p) => p.avgCs || 0)),
    pool: Math.max(1, ...played.map((p) => p.champPool || 0)),
  }), [played]);

  // 전적검색: 이름/닉 부분일치 → 선택 시 그 선수 전적 상세페이지로
  const qn = q.trim().toLowerCase();
  const searchHits = qn ? played.filter((x) => (x.nickname || x.name || '').toLowerCase().includes(qn)) : played;
  const pickSearch = (id) => { setQ(''); setFocus(false); router.push('/player?id=' + id); };

  return (
    <div>
      <div className="page-head">
        <div className="title"><h1>통계</h1><p className="sub" style={{ margin: 0 }}>스크린샷 기록 기반 · 사람(본캐+부캐 합산) 단위. 선수를 클릭하면 상세 프로필이 열려요.</p></div>
        <div className="psearch">
          <input placeholder="🔎 선수 검색 → 전적 상세" value={q}
            onChange={(e) => setQ(e.target.value)} onFocus={() => setFocus(true)} onBlur={() => setTimeout(() => setFocus(false), 150)} />
          {focus && (
            <div className="psearch-list">
              {searchHits.slice(0, 10).map((x) => (
                <button key={x.id} className="psearch-item" onMouseDown={() => pickSearch(x.id)}>
                  <span className="pi-av" style={{ background: 'none', padding: 0 }}><Avatar name={x.nickname || x.name} profile={x.profile} size={22} /></span>
                  <span className="pi-nm">{x.nickname || x.name}</span>
                  <span className="muted pi-meta">{TIER_LABEL[x.base_tier]}</span>
                </button>
              ))}
              {searchHits.length === 0 && <div className="muted psearch-none">검색 결과 없음</div>}
            </div>
          )}
        </div>
      </div>

      {loading && <div className="panel center muted">불러오는 중…</div>}
      {err && <div className="panel err">{err}</div>}

      {data && (
        <>
          <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
            <div className="stat-card"><span className="ic">⚔️</span><div className="label">총 내전</div><div className="value">{data.totalMatches}</div><div className="foot">게임 기록됨</div></div>
            <div className="stat-card"><span className="ic">🏆</span><div className="label">최고 승률</div><div className="value">{topWr && topWr.games ? Math.round(topWr.winrate * 100) + '%' : '—'}</div><div className="foot">{topWr ? (topWr.nickname || topWr.name) : '—'}</div></div>
            <div className="stat-card"><span className="ic">🗡</span><div className="label">평균 딜량 1위</div><div className="value">{topDmg?.avgDamage ? (topDmg.avgDamage / 1000).toFixed(1) + 'k' : '—'}</div><div className="foot">{topDmg?.avgDamage ? (topDmg.nickname || topDmg.name) : '—'}</div></div>
            <div className="stat-card"><span className="ic">🌾</span><div className="label">분당 CS 1위</div><div className="value">{topCsMin?.csPerMin ?? '—'}</div><div className="foot">{topCsMin ? (topCsMin.nickname || topCsMin.name) : '게임 시간 입력 필요'}</div></div>
            <div className="stat-card"><span className="ic">🎭</span><div className="label">챔프폭 킹</div><div className="value">{topPool?.champPool || '—'}</div><div className="foot">{topPool?.champPool ? (topPool.nickname || topPool.name) : '—'}</div></div>
          </div>

          <Awards gid={gid} players={players} />

          <div className="tabs">
            <button className={tab === 'lb' ? 'on' : ''} onClick={() => setTab('lb')}>리더보드</button>
            <button className={tab === 'champ' ? 'on' : ''} onClick={() => setTab('champ')}>챔피언</button>
            <button className={tab === 'hist' ? 'on' : ''} onClick={() => setTab('hist')}>기록</button>
          </div>

          {tab === 'lb' && (
            <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
              <div className="lb-head">
                <h2 style={{ margin: 0 }}>리더보드 <span className="muted" style={{ fontWeight: 400, fontSize: 11 }}>· {lane === 'all' ? `${MIN_RANK_GAMES}판 이상` : `해당 라인 ${data.laneMin || 2}판 이상`}</span></h2>
                <span className="formula">{data.scoreFormula || '내전 점수'}</span>
              </div>
              {LANE_LB_ENABLED && (
                <div className="lane-tabs">
                  {LANE_TABS.map(([k, label]) => (
                    <button key={k} className={lane === k ? 'on' : ''} onClick={() => setLane(k)}>{label}{k !== 'all' && data.lanes?.[k]?.length ? <span className="lt-n">{data.lanes[k].length}</span> : null}</button>
                  ))}
                </div>
              )}
              {lbList.length === 0 ? (
                <div className="center muted" style={{ padding: '28px 0' }}>
                  {lane === 'all'
                    ? <>아직 {MIN_RANK_GAMES}판 이상 뛴 선수가 없어요. {played.length > 0 ? '조금 더 기록되면 순위가 떠요.' : <><Link href="/record" className="accent">경기 기록</Link>에서 스샷을 올리세요.</>}</>
                    : `이 라인에서 ${data.laneMin || 2}판 이상 뛴 선수가 아직 없어요.`}
                </div>
              ) : (
                <div className="lbx">
                  {!SORT_ENABLED && (
                    <div className="lbx-row lbx-hd lbx-hd-static">
                      <div />
                      <div>선수</div>
                      <div className="hd-c">KDA</div>
                      <div className="hd-c">딜량</div>
                      <div className="lbx-badges">칭호</div>
                      <div className="hd-c">승률</div>
                      <div className="lbx-most">모스트</div>
                      <div className="hd-c">점수</div>
                    </div>
                  )}
                  {SORT_ENABLED && (
                    <div className="lbx-row lbx-hd">
                      <div />
                      <div className="muted">선수</div>
                      <div><SortHead label="KDA" col="kda" sort={sort} onSort={setSortDir} /></div>
                      <div><SortHead label="딜량" col="avgDamage" sort={sort} onSort={setSortDir} /></div>
                      <div className="lbx-badges" />
                      <div><SortHead label="승률" col="winrate" sort={sort} onSort={setSortDir} /></div>
                      <div className="lbx-most" />
                      <div><SortHead label="점수" col="score" sort={sort} onSort={setSortDir} /></div>
                    </div>
                  )}
                  {rowsToShow.map((p, i) => {
                    const splash = dd.splash(p.topChamps?.[0]?.champion);
                    return (
                      <div key={p.id} className={`lbx-row ${i === 0 ? 'top1' : i === 1 ? 'top2' : i === 2 ? 'top3' : ''}`} onClick={() => setSel(players.find((x) => x.id === p.id) || p)}>
                        {splash && <div className="lbx-splash" style={{ backgroundImage: `url(${splash})` }} />}
                        <div className="lbx-rank">{medal(i) || <span className="num">{i + 1}</span>}</div>
                        <div className="lbx-name">
                          <b>{p.nickname || p.name}</b>
                          <span className="muted"><span className={tierClass(p.base_tier)}>{TIER_LABEL[p.base_tier]}</span>{p.nickname ? ` · ${p.name}` : ''}</span>
                        </div>
                        <div className="lbx-kda">
                          <div className="kda-line">{p.kAvg}/<span className="red">{p.dAvg}</span>/{p.aAvg}</div>
                          <div className={`kda-val ${p.kda >= 5 ? 'kv-5' : p.kda >= 4 ? 'kv-4' : p.kda >= 3 ? 'kv-3' : ''}`}>{p.kda != null ? p.kda.toFixed(2) : '-'} KDA</div>
                        </div>
                        <div className="lbx-dmg" title="평균 딜량">
                          <span className="dnum">{p.avgDamage ? (p.avgDamage / 1000).toFixed(1) + 'k' : '-'}</span>
                          {p.avgDamage ? <div className="dbar"><span style={{ width: Math.round((p.avgDamage / maxDmg) * 100) + '%' }} /></div> : null}
                        </div>
                        <div className="lbx-badges">
                          {p.mvp > 0 && <span className="bdg mvp" title="MVP">🏅{p.mvp}</span>}
                          {p.ace > 0 && <span className="bdg ace" title="ACE">⭐{p.ace}</span>}
                        </div>
                        <div className="lbx-wr">
                          <div className="wrbar"><span className={wrClass(p.winrate)} style={{ width: Math.round(p.winrate * 100) + '%' }} /></div>
                          <span className="wrpct">{Math.round(p.winrate * 100)}% <span className="muted">{p.wins}-{p.losses}</span></span>
                        </div>
                        <div className="lbx-most">
                          {p.topChamps?.map((c) => <ChampImg key={c.champion} name={c.champion} iconUrl={dd.icon} size={26} title={`${c.champion} ${c.games}판`} />)}
                        </div>
                        <div className="lbx-score"><b>{p.score}</b><span>점</span></div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {tab === 'champ' && <ChampionTab champs={champs} dd={dd} />}
          {tab === 'hist' && <MatchHistory gid={gid} dd={dd} />}
        </>
      )}

      {sel && <PlayerCard player={sel} gid={gid} max={max} dd={dd} onClose={() => setSel(null)} />}
    </div>
  );
}

function ChampionTab({ champs, dd }) {
  if (!champs) return <div className="panel center muted">불러오는 중…</div>;
  if (!champs.length) return <div className="panel center muted" style={{ padding: '24px 0' }}>챔피언 데이터가 없어요.</div>;
  const byPick = [...champs].sort((a, b) => b.games - a.games);
  const maxGames = byPick[0]?.games || 1;
  const byWr = [...champs].filter((c) => c.games >= 3).sort((a, b) => b.winrate - a.winrate);
  return (
    <>
      <div className="chart-row">
        <div className="panel">
          <h2>픽률 순위</h2>
          {byPick.slice(0, 8).map((c) => (
            <div className="bar-row" key={c.champion}>
              <ChampImg name={c.champion} iconUrl={dd.icon} size={22} />
              <span className="bar-name">{c.champion}</span>
              <div className="bar-track"><span className="bar-fill pick" style={{ width: (c.games / maxGames) * 100 + '%' }} /></div>
              <span className="bar-val">{c.games}판</span>
            </div>
          ))}
        </div>
        <div className="panel">
          <h2>챔피언 승률 <span className="muted" style={{ fontSize: 11, fontWeight: 400 }}>(3판+)</span></h2>
          {byWr.slice(0, 8).map((c) => (
            <div className="bar-row" key={c.champion}>
              <ChampImg name={c.champion} iconUrl={dd.icon} size={22} />
              <span className="bar-name">{c.champion}</span>
              <div className="bar-track"><span className={`bar-fill ${wrClass(c.winrate)}`} style={{ width: Math.round(c.winrate * 100) + '%' }} /></div>
              <span className="bar-val">{Math.round(c.winrate * 100)}%</span>
            </div>
          ))}
        </div>
      </div>
      <div className="panel">
        <h2>전체 챔피언 <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>{champs.length}</span></h2>
        <div className="champ-grid">
          {byPick.map((c) => (
            <div className="champ-card" key={c.champion}>
              <ChampImg name={c.champion} iconUrl={dd.icon} size={44} />
              <div className="cc-body">
                <div className="cc-name">{c.champion}</div>
                <div className="cc-meta"><span>{c.games}판</span><span className={wrClass(c.winrate)}>{Math.round(c.winrate * 100)}%</span><span className="muted">KDA {c.kda}</span></div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
