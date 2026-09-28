'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { TIER_LABEL, tierClass } from '../src/table.js';
import { useGroup } from '../components/GroupProvider.jsx';
import { useDdragon } from '../components/ddragon.js';
import ChampImg from '../components/ChampImg.jsx';
import PlayerCard from '../components/PlayerCard.jsx';
import MatchHistory from '../components/MatchHistory.jsx';
import Awards from '../components/Awards.jsx';
import Avatar from '../components/Avatar.jsx';
import { useLang } from '../components/i18n.jsx';

function wrClass(w) { return w >= 0.6 ? 'green' : w >= 0.5 ? 'yellow' : 'red'; }
const medal = (i) => ['🥇', '🥈', '🥉'][i] || null;

function SortHead({ label, col, sort, onSort }) {
  const { t } = useLang();
  const on = sort.key === col;
  return (
    <span className="sort-head">
      <span className="sh-lb">{label}</span>
      <span className="sh-arrows">
        <button className={on && sort.dir === 'asc' ? 'on' : ''} onClick={() => onSort(col, 'asc')} title={t('오름차순')}>▲</button>
        <button className={on && sort.dir === 'desc' ? 'on' : ''} onClick={() => onSort(col, 'desc')} title={t('내림차순')}>▼</button>
      </span>
    </span>
  );
}

export default function StatsPage() {
  const { group } = useGroup();
  const gid = group?.id;
  const dd = useDdragon();
  const { t } = useLang();
  const router = useRouter();
  const [data, setData] = useState(null);
  const [champs, setChamps] = useState(null);
  const [tab, setTab] = useState('lb');
  // F5·공유 시 탭 유지: URL 해시(#lb/#champ/#hist) ↔ 탭 동기화
  useEffect(() => {
    const h = (window.location.hash || '').replace('#', '');
    if (['lb', 'champ', 'hist'].includes(h)) setTab(h);
  }, []);
  const goTab = (t) => { setTab(t); if (typeof window !== 'undefined') window.history.replaceState(null, '', `#${t}`); };
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

  // 통계 카드(딜량·CS·챔프폭)는 라플라스 미보정 raw max라 1~2판 반짝 1등 방지 위해 3판 이상만.
  // 리더보드는 score(라플라스 보정 승률 포함)로 정렬돼 소표본이 부당하게 1등 못 함 → 전체 노출.
  const MIN_RANK_GAMES = 3;
  const players = data?.players || [];
  const played = players.filter((p) => p.games > 0);
  const ranked = played.filter((p) => p.games >= MIN_RANK_GAMES);
  // 사람 많아지면 true로 다시 켜기 (표본 적을 땐 라인별/정렬이 큰 의미 없어서 잠시 off)
  const LANE_LB_ENABLED = false; // 포지션별(라인) 리더보드 탭
  const SORT_ENABLED = false;    // 정렬 가능한 표 헤더
  const LANE_TABS = [['all', t('전체')], ['top', t('탑')], ['jungle', t('정글')], ['mid', t('미드')], ['adc', t('원딜')], ['sup', t('서폿')]];
  // 리더보드: 전체 노출. 0판(등록만·미출전)은 getStats가 이미 맨 뒤로 정렬 → 아래에 붙음.
  const lbList = (LANE_LB_ENABLED && lane !== 'all') ? (data?.lanes?.[lane] || []) : players;
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
        <div className="title"><h1>{t('통계')}</h1><p className="sub" style={{ margin: 0 }}>{t('스크린샷 기록 기반 · 사람(본캐+부캐 합산) 단위. 선수를 클릭하면 상세 프로필이 열려요.')}</p></div>
        <div className="psearch">
          <input placeholder={t('🔎 선수 검색 → 전적 상세')} value={q}
            onChange={(e) => setQ(e.target.value)} onFocus={() => setFocus(true)} onBlur={() => setTimeout(() => setFocus(false), 150)} />
          {focus && (
            <div className="psearch-list">
              {searchHits.slice(0, 10).map((x) => (
                <button key={x.id} className="psearch-item" onMouseDown={() => pickSearch(x.id)}>
                  <span className="pi-av" style={{ background: 'none', padding: 0 }}><Avatar name={x.nickname || x.name} profile={x.profile} size={22} /></span>
                  <span className="pi-nm">{x.nickname || x.name}</span>
                  <span className="muted pi-meta">{t(TIER_LABEL[x.base_tier])}</span>
                </button>
              ))}
              {searchHits.length === 0 && <div className="muted psearch-none">{t('검색 결과 없음')}</div>}
            </div>
          )}
        </div>
      </div>

      {loading && <div className="panel center muted">{t('불러오는 중…')}</div>}
      {err && <div className="panel err">{t(err)}</div>}

      {data && (
        <>
          <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
            <div className="stat-card"><span className="ic">⚔️</span><div className="label">{t('총 내전')}</div><div className="value">{data.totalMatches}</div><div className="foot">{t('게임 기록됨')}</div></div>
            <div className="stat-card"><span className="ic">🏆</span><div className="label">{t('최고 승률')}</div><div className="value">{topWr && topWr.games ? Math.round(topWr.winrate * 100) + '%' : '—'}</div><div className="foot">{topWr ? (topWr.nickname || topWr.name) : '—'}</div></div>
            <div className="stat-card"><span className="ic">🗡</span><div className="label">{t('평균 딜량 1위')}</div><div className="value">{topDmg?.avgDamage ? (topDmg.avgDamage / 1000).toFixed(1) + 'k' : '—'}</div><div className="foot">{topDmg?.avgDamage ? (topDmg.nickname || topDmg.name) : '—'}</div></div>
            <div className="stat-card"><span className="ic">🌾</span><div className="label">{t('분당 CS 1위')}</div><div className="value">{topCsMin?.csPerMin ?? '—'}</div><div className="foot">{topCsMin ? (topCsMin.nickname || topCsMin.name) : t('게임 시간 입력 필요')}</div></div>
            <div className="stat-card"><span className="ic">🎭</span><div className="label">{t('챔프폭 킹')}</div><div className="value">{topPool?.champPool || '—'}</div><div className="foot">{topPool?.champPool ? (topPool.nickname || topPool.name) : '—'}</div></div>
          </div>

          <Awards gid={gid} players={players} />

          <div className="tabs">
            <button className={tab === 'lb' ? 'on' : ''} onClick={() => goTab('lb')}>{t('리더보드')}</button>
            <button className={tab === 'champ' ? 'on' : ''} onClick={() => goTab('champ')}>{t('챔피언')}</button>
            <button className={tab === 'hist' ? 'on' : ''} onClick={() => goTab('hist')}>{t('기록')}</button>
          </div>

          {tab === 'lb' && (
            <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
              <div className="lb-head">
                <h2 style={{ margin: 0 }}>{t('리더보드')} <span className="muted" style={{ fontWeight: 400, fontSize: 11 }}>· {lane === 'all' ? t('전체 · 내전 점수순 (라플라스 보정)') : t('해당 라인 {n}판 이상', { n: data.laneMin || 2 })}</span></h2>
                <span className="formula">{t(data.scoreFormula || '내전 점수')}</span>
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
                    ? <>{t('아직 경기 기록이 없어요.')} <Link href="/record" className="accent">{t('경기 기록')}</Link>{t('에서 스샷을 올리세요.')}</>
                    : t('이 라인에서 {n}판 이상 뛴 선수가 아직 없어요.', { n: data.laneMin || 2 })}
                </div>
              ) : (
                <div className="lbx">
                  {!SORT_ENABLED && (
                    <div className="lbx-row lbx-hd lbx-hd-static">
                      <div />
                      <div>{t('선수')}</div>
                      <div className="hd-c">KDA</div>
                      <div className="hd-c">{t('딜량')}</div>
                      <div className="lbx-badges">{t('칭호')}</div>
                      <div className="hd-c">{t('승률')}</div>
                      <div className="lbx-most">{t('모스트')}</div>
                      <div className="hd-c">{t('점수')}</div>
                    </div>
                  )}
                  {SORT_ENABLED && (
                    <div className="lbx-row lbx-hd">
                      <div />
                      <div className="muted">{t('선수')}</div>
                      <div><SortHead label="KDA" col="kda" sort={sort} onSort={setSortDir} /></div>
                      <div><SortHead label={t('딜량')} col="avgDamage" sort={sort} onSort={setSortDir} /></div>
                      <div className="lbx-badges" />
                      <div><SortHead label={t('승률')} col="winrate" sort={sort} onSort={setSortDir} /></div>
                      <div className="lbx-most" />
                      <div><SortHead label={t('점수')} col="score" sort={sort} onSort={setSortDir} /></div>
                    </div>
                  )}
                  {rowsToShow.map((p, i) => {
                    const splash = dd.splash(p.topChamps?.[0]?.champion);
                    return (
                      <div key={p.id} className={`lbx-row ${p.games && i === 0 ? 'top1' : p.games && i === 1 ? 'top2' : p.games && i === 2 ? 'top3' : ''} ${p.games ? '' : 'no-games'}`} onClick={() => setSel(players.find((x) => x.id === p.id) || p)}>
                        {splash && <div className="lbx-splash" style={{ backgroundImage: `url(${splash})` }} />}
                        <div className="lbx-rank">{p.games ? (medal(i) || <span className="num">{i + 1}</span>) : <span className="num">-</span>}</div>
                        <div className="lbx-name">
                          <Avatar name={p.nickname || p.name} profile={p.profile} size={30} />
                          <div className="lbx-nm-txt">
                            <b>{p.nickname || p.name}</b>
                            <span className="muted"><span className={tierClass(p.base_tier)}>{t(TIER_LABEL[p.base_tier])}</span>{p.nickname ? ` · ${p.name}` : ''}</span>
                          </div>
                        </div>
                        <div className="lbx-kda">
                          <div className="kda-line">{p.kAvg}/<span className="red">{p.dAvg}</span>/{p.aAvg}</div>
                          <div className={`kda-val ${p.kda >= 5 ? 'kv-5' : p.kda >= 4 ? 'kv-4' : p.kda >= 3 ? 'kv-3' : ''}`}>{p.kda != null ? p.kda.toFixed(2) : '-'} KDA</div>
                        </div>
                        <div className="lbx-dmg" title={t('평균 딜량')}>
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
                          {p.topChamps?.map((c) => <ChampImg key={c.champion} name={c.champion} iconUrl={dd.icon} size={26} title={t('{champ} {n}판', { champ: c.champion, n: c.games })} />)}
                        </div>
                        <div className="lbx-score">{p.games ? <><b>{p.score}</b><span>{t('점')}</span></> : <span className="muted">{t('미출전')}</span>}</div>
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
  const { t } = useLang();
  if (!champs) return <div className="panel center muted">{t('불러오는 중…')}</div>;
  if (!champs.length) return <div className="panel center muted" style={{ padding: '24px 0' }}>{t('챔피언 데이터가 없어요.')}</div>;
  const byPick = [...champs].sort((a, b) => b.games - a.games);
  const maxGames = byPick[0]?.games || 1;
  const byWr = [...champs].filter((c) => c.games >= 3).sort((a, b) => b.winrate - a.winrate);
  return (
    <>
      <div className="chart-row">
        <div className="panel">
          <h2>{t('픽률 순위')}</h2>
          {byPick.slice(0, 8).map((c) => (
            <div className="bar-row" key={c.champion}>
              <ChampImg name={c.champion} iconUrl={dd.icon} size={22} />
              <span className="bar-name">{dd.label(c.champion)}</span>
              <div className="bar-track"><span className="bar-fill pick" style={{ width: (c.games / maxGames) * 100 + '%' }} /></div>
              <span className="bar-val">{t('{n}판', { n: c.games })}</span>
            </div>
          ))}
        </div>
        <div className="panel">
          <h2>{t('챔피언 승률')} <span className="muted" style={{ fontSize: 11, fontWeight: 400 }}>({t('3판+')})</span></h2>
          {byWr.slice(0, 8).map((c) => (
            <div className="bar-row" key={c.champion}>
              <ChampImg name={c.champion} iconUrl={dd.icon} size={22} />
              <span className="bar-name">{dd.label(c.champion)}</span>
              <div className="bar-track"><span className={`bar-fill ${wrClass(c.winrate)}`} style={{ width: Math.round(c.winrate * 100) + '%' }} /></div>
              <span className="bar-val">{Math.round(c.winrate * 100)}%</span>
            </div>
          ))}
        </div>
      </div>
      <div className="panel">
        <h2>{t('전체 챔피언')} <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>{champs.length}</span></h2>
        <div className="champ-grid">
          {byPick.map((c) => (
            <div className="champ-card" key={c.champion}>
              <ChampImg name={c.champion} iconUrl={dd.icon} size={44} />
              <div className="cc-body">
                <div className="cc-name">{dd.label(c.champion)}</div>
                <div className="cc-meta"><span>{t('{n}판', { n: c.games })}</span><span className={wrClass(c.winrate)}>{Math.round(c.winrate * 100)}%</span><span className="muted">KDA {c.kda}</span></div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
