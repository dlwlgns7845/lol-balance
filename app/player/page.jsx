'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { useGroup } from '../../components/GroupProvider.jsx';
import { useDdragon } from '../../components/ddragon.js';
import MatchHistory from '../../components/MatchHistory.jsx';
import ChampImg from '../../components/ChampImg.jsx';
import PositionBar from '../../components/PositionBar.jsx';
import WinLossBar from '../../components/WinLossBar.jsx';
import Avatar from '../../components/Avatar.jsx';
import { apiFetch } from '../../components/api.js';
import { TIER_LABEL, tierClass } from '../../src/table.js';

const wrCls = (w) => (w >= 0.6 ? 'green' : w >= 0.5 ? 'yellow' : 'red');
const kdaCls = (r) => (r >= 5 ? 'kv-5' : r >= 4 ? 'kv-4' : r >= 3 ? 'kv-3' : '');
const POS_KR = { top: '탑', jungle: '정글', mid: '미드', adc: '원딜', sup: '서폿' };
const fmtD = (s) => { if (!s) return ''; const d = new Date(s); return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`; };

export default function PlayerRecordPage() {
  const { group, user } = useGroup();
  const gid = group?.id;
  const dd = useDdragon();
  const sp = useSearchParams();
  const router = useRouter();
  const [players, setPlayers] = useState([]);
  // 로그인=본인선수 자동매칭 상태 (연결 유도용)
  const [myLink, setMyLink] = useState(null);
  useEffect(() => {
    if (!user || !gid) { setMyLink(null); return; }
    apiFetch('/api/me?gid=' + gid).then((r) => r.json()).then((r) => r.ok && setMyLink(r)).catch(() => {});
  }, [user, gid]);
  async function linkMe(personId) {
    try {
      const r = await apiFetch('/api/me', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ gid, personId }) }).then((x) => x.json());
      if (!r.ok) throw new Error(r.error);
      setMyLink((m) => ({ ...m, person: { id: personId } }));
      window.alert('✅ 이 계정에 선수를 연결했어요. 이제 헤더의 "내 전적"으로 바로 올 수 있어요.');
    } catch (e) { window.alert('연결 실패: ' + e.message); }
  }
  async function unlinkMe() {
    if (!window.confirm('이 계정에서 선수 연동을 해제할까요?\n기록은 그대로 남고 로그인 연결만 풀립니다.')) return;
    try {
      const r = await apiFetch('/api/me?gid=' + gid, { method: 'DELETE' }).then((x) => x.json());
      if (!r.ok) throw new Error(r.error);
      setMyLink((m) => ({ ...m, person: null }));
      window.alert('연동을 해제했어요. (기록은 보존)');
    } catch (e) { window.alert('해제 실패: ' + e.message); }
  }
  const sel = sp.get('id') || ''; // URL을 단일 진실로 → 다른 사람 페이지로 이동해도 반영
  const [q, setQ] = useState('');
  const [focus, setFocus] = useState(false);
  const [detail, setDetail] = useState(null);

  function pick(id) {
    setQ(''); setFocus(false);
    router.replace('/player?id=' + id);
  }

  useEffect(() => {
    if (!gid) return;
    fetch('/api/stats?gid=' + gid).then((x) => x.json()).then((r) => {
      if (!r.ok) return;
      setPlayers(r.players);
      // 자동선택 안 함 — 검색해서 선택하게 (?id=로 들어오면 그건 유지)
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gid]);

  // 모스트 챔피언용 상세
  useEffect(() => {
    if (!gid || !sel) { setDetail(null); return; }
    setDetail(null);
    fetch(`/api/player/${sel}?gid=${gid}`).then((x) => x.json()).then((r) => r.ok && setDetail(r));
  }, [gid, sel]);

  const p = players.find((x) => x.id === sel);
  const played = players.filter((x) => x.games > 0).slice().sort((a, b) => b.games - a.games);
  const qn = q.trim().toLowerCase();
  const hits = qn ? played.filter((x) => (x.nickname || x.name || '').toLowerCase().includes(qn)) : played;

  const kpi = (label, val, cls) => <div className="stat-card"><div className="label">{label}</div><div className={`value ${cls || ''}`} style={{ fontSize: 20 }}>{val}</div></div>;

  return (
    <div>
      <div className="page-head">
        <div className="title"><h1>전적</h1><p className="sub" style={{ margin: 0 }}>선수 이름 검색 → 그 선수의 내전 전적. (op.gg엔 안 나오는 커스텀게임 기록)</p></div>
        <div className="psearch">
          <input placeholder="🔎 선수 이름 검색 (내 이름 쳐서 내 전적)" value={q}
            onChange={(e) => setQ(e.target.value)} onFocus={() => setFocus(true)} onBlur={() => setTimeout(() => setFocus(false), 150)} />
          {focus && (
            <div className="psearch-list">
              {hits.slice(0, 10).map((x) => (
                <button key={x.id} className={`psearch-item ${x.id === sel ? 'on' : ''}`} onMouseDown={() => pick(x.id)}>
                  <span className="pi-av" style={{ background: 'none', padding: 0 }}><Avatar name={x.nickname || x.name} profile={x.profile} size={22} /></span>
                  <span className="pi-nm">{x.nickname || x.name}</span>
                  <span className="muted pi-meta">{TIER_LABEL[x.base_tier]}</span>
                </button>
              ))}
              {hits.length === 0 && <div className="muted psearch-none">검색 결과 없음</div>}
            </div>
          )}
        </div>
      </div>

      {!p ? <div className="panel center muted" style={{ padding: '28px 0' }}>위 검색창에서 선수 이름을 검색하세요.</div> : (
        <>
          <div className="panel prof-top">
            <div className="prof-name">
              <span className="prof-av" style={{ background: 'none', padding: 0 }}><Avatar name={p.nickname || p.name} profile={p.profile} size={48} /></span>
              <div>
                <div className="prof-nm">{p.nickname || p.name}{myLink?.person?.id === p.id && <span className="me-badge">내 계정</span>}</div>
                <div className="prof-sub"><span className={tierClass(p.base_tier)}>{TIER_LABEL[p.base_tier]}</span> · {p.games}게임 · <b className={wrCls(p.winrate)}>{Math.round(p.winrate * 100)}%</b> ({p.wins}승 {p.losses}패)</div>
              </div>
              {/* 내 계정에 연결된 선수 = 해제 버튼 / 미연결 + 디코로그인 = 이 선수 연결 버튼 */}
              {myLink?.person?.id === p.id
                ? <button className="btn ghost" style={{ marginLeft: 'auto' }} onClick={unlinkMe} title="기록은 보존, 로그인 연결만 해제">🔗 연동 해제</button>
                : (myLink?.hasDiscord && !myLink?.person && (
                  <button className="btn" style={{ marginLeft: 'auto' }} onClick={() => linkMe(p.id)}>🔗 이 선수가 나예요</button>
                ))}
            </div>
          </div>

          <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(6, 1fr)' }}>
            {kpi('KDA', p.kda != null ? p.kda.toFixed(2) : '-', kdaCls(p.kda || 0))}
            {kpi('총 K/D/A', p.statGames ? `${(p.totalK || 0).toLocaleString()}/${(p.totalD || 0).toLocaleString()}/${(p.totalA || 0).toLocaleString()}` : '-')}
            {kpi('평균 딜량', p.statGames ? p.avgDamage.toLocaleString() : '-')}
            {kpi('평균 CS', p.statGames ? p.avgCs.toLocaleString() : '-')}
            {kpi('🏅 MVP', p.mvp)}
            {kpi('⭐ ACE', p.ace)}
          </div>

          <div className="pl-layout">
            <div className="pl-left">
              {p.positions && Object.values(p.positions).some((n) => n > 0) && (
                <div className="panel">
                  <h2>포지션 <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>· 주 {p.mainPos ? { top: '탑', jungle: '정글', mid: '미드', adc: '원딜', sup: '서폿' }[p.mainPos] : '-'}</span></h2>
                  <PositionBar positions={p.positions} stats={p.positionStats} />
                </div>
              )}
              {detail?.champions?.length > 0 && (
                <div className="panel">
                  <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    모스트 챔피언
                    {detail.champions.length > 5 && <Link href={`/champions?id=${p.id}`} className="accent" style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 600 }}>더보기 →</Link>}
                  </h2>
                  <div className="pc-champs">
                    {detail.champions.slice(0, 6).map((c) => (
                      <div className="pc-champ" key={c.champion}>
                        <ChampImg name={c.champion} iconUrl={dd.icon} size={30} />
                        <div className="pcc-info">
                          <span className="pcc-name">{dd.label(c.champion)}</span>
                          <span className="muted" style={{ fontSize: 11 }}>{c.games}판 · KDA {c.kda}</span>
                        </div>
                        <WinLossBar wins={c.wins} losses={c.games - c.wins} showText />
                        <span className={`pcc-wr ${wrCls(c.winrate)}`}>{Math.round(c.winrate * 100)}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {detail?.laneMatchups?.length > 0 && (
                <div className="panel">
                  <h2>맞라인 상대 <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>· 같은 라인 만났을 때 승률</span></h2>
                  <div className="lane-list">
                    {detail.laneMatchups.slice(0, 8).map((o) => (
                      <div className="lane-row" key={o.name + o.pos}>
                        <span className="lane-pos muted">{POS_KR[o.pos] || '-'}</span>
                        <span className="lane-nm">{o.name}</span>
                        <span className="muted lane-g">{o.games}판</span>
                        <WinLossBar wins={o.wins} losses={o.games - o.wins} showText />
                        <span className={`pcc-wr ${wrCls(o.winrate)}`}>{Math.round(o.winrate * 100)}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="pl-right">
              <h2 style={{ fontSize: 15, margin: '0 2px 10px' }}>참여 경기 <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>· 배너 눌러 펼치면 그 경기 10명 전체 상세</span></h2>
              <MatchHistory gid={gid} dd={dd} filterName={p.nickname || p.name} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
