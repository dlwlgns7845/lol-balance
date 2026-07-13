'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import ChampImg from './ChampImg.jsx';
import { TIER_LABEL, tierClass } from '../src/table.js';
import { useGroup } from './GroupProvider.jsx';
import { apiFetch } from './api.js';
import TitleBadges from './TitleBadges.jsx';
import PlayerCard from './PlayerCard.jsx';

const normNm = (s) => (s || '').toLowerCase().replace(/\s+/g, '');

function fmtDate(s) {
  if (!s) return '';
  const d = new Date(s);
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const WD = ['일', '월', '화', '수', '목', '금', '토'];
function fmtDateTime(s) {
  if (!s) return { date: '', time: '' };
  const d = new Date(s);
  const p2 = (n) => String(n).padStart(2, '0');
  return { date: `${p2(d.getMonth() + 1)}-${p2(d.getDate())} (${WD[d.getDay()]})`, time: `${p2(d.getHours())}:${p2(d.getMinutes())}` };
}
const fmtDur = (min) => (min ? `${Math.round(min)}분` : '');
const k = (n) => (n >= 1000 ? (n / 1000).toFixed(1) + 'k' : n);
const kdaRatio = (p) => (p.d ? ((p.k + p.a) / p.d) : (p.k + p.a)).toFixed(2);
const rClass = (r) => (r >= 5 ? 'kv-5' : r >= 4 ? 'kv-4' : r >= 3 ? 'kv-3' : '');
const sum = (arr, f) => arr.reduce((a, x) => a + (x[f] || 0), 0);
// 블루↔레드 로컬 스왑 (서버 반영 후 재조회 없이 즉시 UI 갱신). 선수는 그대로 승/패 유지 → mvp/ace 불변.
const swapMatchLocal = (m) => ({
  ...m, winner: m.winner === 'A' ? 'B' : m.winner === 'B' ? 'A' : m.winner,
  A: m.B, B: m.A, killsA: m.killsB, killsB: m.killsA, csA: m.csB, csB: m.csA, goldA: m.goldB, goldB: m.goldA,
  objectives: m.objectives ? { A: m.objectives.B || {}, B: m.objectives.A || {} } : m.objectives,
});

function RosterFull({ label, players, win, cs, dd, color, maxDmg, byName, highlight, carryThreshold = 20, onPlayer }) {
  return (
    <div className={`mhf-team t-${color}`}>
      <div className="mhf-team-head">
        <span className="mhf-label">{label} <span className={`mhf-res ${win ? 'g' : 'r'}`}>{win ? '승리' : '패배'}</span></span>
        <span className="muted">CS {sum(players, 'cs')}</span>
        <span className="mhf-tot">{sum(players, 'k')} / <span className="red">{sum(players, 'd')}</span> / {sum(players, 'a')}</span>
      </div>
      {players.map((p, i) => (
        <div className={`mhf-p ${highlight && normNm(p.name) === highlight ? 'me' : ''} ${onPlayer && p.personId ? 'clk' : ''}`} key={i}
          onClick={onPlayer && p.personId ? (e) => { e.stopPropagation(); onPlayer(p.personId); } : undefined}
          title={onPlayer && p.personId ? '카드 보기' : undefined}>
          <ChampImg name={p.champion} iconUrl={dd.icon} size={34} />
          <div className="mhf-id">
            <span className="mhf-name">{p.name}<TitleBadges titles={byName?.[normNm(p.name)]} max={3} />{p.mvp && <span className={`mbadge mvp ${(p.score || 0) >= carryThreshold ? 'rainbow' : ''}`}>MVP</span>}{p.ace && <span className="mbadge ace">ACE</span>}</span>
            <span className="muted mhf-sub">{p.champion}</span>
          </div>
          <div className="mhf-kdacell">
            <span className="mhf-kda">{p.k} / <span className="red">{p.d}</span> / {p.a}</span>
            <span className={`mhf-ratio ${rClass(+kdaRatio(p))}`}>{kdaRatio(p)} 평점</span>
          </div>
          <div className="dmg-cell">
            <span className="dmg-num">딜 {k(p.damage || 0)}</span>
            <div className="dmg-bar"><span className={`f ${color}`} style={{ width: Math.round((p.damage || 0) / maxDmg * 100) + '%' }} /></div>
          </div>
          <span className="mhf-gold">🌾 {p.cs || 0}</span>
        </div>
      ))}
    </div>
  );
}

// ── op.gg식 리치 표시 (리플 경기 전용 — detail 있을 때) ──
// 두 팀 사이 중앙 바: 좌=블루 오브젝트, 중앙=Total Kill/Gold 비교바, 우=레드 오브젝트
function MiddleBar({ objectives, killsA, killsB, goldA, goldB }) {
  const oA = objectives?.A || {}, oB = objectives?.B || {};
  const objs = (o) => (
    <div className="mhmid-obj">
      <span className="oc drag" title="드래곤">용<b>{o.dragons || 0}</b>{o.elder ? `+엘${o.elder}` : ''}</span>
      <span className="oc grub" title="공허 유충">유충<b>{o.grubs || 0}</b></span>
      <span className="oc her" title="전령">전령<b>{o.heralds || 0}</b></span>
      <span className="oc bar" title="바론">바론<b>{o.barons || 0}</b></span>
      {o.atakhan ? <span className="oc ata" title="아타칸">아타칸<b>{o.atakhan}</b></span> : null}
      <span className="oc tow" title="포탑">타워<b>{o.towers || 0}</b></span>
    </div>
  );
  const bar = (label, a, b, fmt) => {
    const tot = Math.max(1, a + b);
    return (
      <div className="mhmid-bar">
        <span className="mhmid-v b">{fmt ? a.toLocaleString() : a}</span>
        <div className="mhmid-track">
          <span className="mhmid-f b" style={{ width: (a / tot * 100) + '%' }} />
          <span className="mhmid-f r" style={{ width: (b / tot * 100) + '%' }} />
          <span className="mhmid-lbl">{label}</span>
        </div>
        <span className="mhmid-v r">{fmt ? b.toLocaleString() : b}</span>
      </div>
    );
  };
  return (
    <div className="mhmid">
      {objs(oA)}
      <div className="mhmid-center">
        {bar('Total Kill', killsA || 0, killsB || 0, false)}
        {bar('Total Gold', goldA || 0, goldB || 0, true)}
      </div>
      {objs(oB)}
    </div>
  );
}

function RichRow({ p, dd, color, maxDmg, maxTaken, durationMin, byName, onPlayer, itemUrl, highlight, alt }) {
  const det = p.detail || {};
  const items = det.items || [];
  const csm = durationMin ? (p.cs / durationMin).toFixed(1) : null;
  return (
    <div className={`mhr-row ${alt ? 'mhr-alt' : ''} ${highlight && normNm(p.name) === highlight ? 'me' : ''} ${onPlayer && p.personId ? 'clk' : ''}`}
      onClick={onPlayer && p.personId ? (e) => { e.stopPropagation(); onPlayer(p.personId); } : undefined}>
      <ChampImg name={p.champion} iconUrl={dd.icon} size={32} />
      <div className="mhr-name">
        <span className="mhr-nm">{p.name}<TitleBadges titles={byName?.[normNm(p.name)]} max={2} />{p.mvp && <span className="mbadge mvp">MVP</span>}{p.ace && <span className="mbadge ace">ACE</span>}</span>
        <span className="mhr-sub"><span className="muted">{p.champion}</span>{p.tier && <span className={tierClass(p.tier)}> · {TIER_LABEL[p.tier] || p.tier}</span>}</span>
      </div>
      <div className="mhr-kda">
        <span>{p.k} / <span className="red">{p.d}</span> / {p.a}</span>
        <span className={`muted mhr-ratio ${rClass(+kdaRatio(p))}`}>{kdaRatio(p)}</span>
      </div>
      <div className="mhr-dmg" title="가한 피해 | 받은 피해">
        <div className="mhr-dmg-c"><span>{k(p.damage || 0)}</span><div className="dmg-bar"><span className={`f ${color}`} style={{ width: Math.round((p.damage || 0) / maxDmg * 100) + '%' }} /></div></div>
        <div className="mhr-dmg-c"><span className="muted">{k(det.dmgTaken || 0)}</span><div className="dmg-bar"><span className="f taken" style={{ width: Math.round((det.dmgTaken || 0) / maxTaken * 100) + '%' }} /></div></div>
      </div>
      <div className="mhr-c muted"><b>{det.visionScore || 0}</b><span>👁 {det.wardsPlaced || 0}/{det.wardsKilled || 0}</span></div>
      <div className="mhr-c muted"><b>{p.cs || 0}</b><span>{csm ? csm + '/분' : 'CS'}</span></div>
      <div className="mhr-items">{[0, 1, 2, 3, 4, 5, 6].map((i) => { const u = itemUrl(items[i]); return <span key={i} className="mhr-item">{u ? <img src={u} alt="" width={20} height={20} /> : null}</span>; })}</div>
      <div className="mhr-gold muted">🌾 {k(p.gold || 0)}</div>
    </div>
  );
}

function RosterRich({ label, players, win, color, dd, maxDmg, maxTaken, durationMin, byName, onPlayer, itemUrl, highlight }) {
  return (
    <div className={`mhr-team t-${color}`}>
      <div className="mhr-head">
        <span className="mhf-label">{label} <span className={`mhf-res ${win ? 'g' : 'r'}`}>{win ? '승리' : '패배'}</span></span>
        <span className="muted">{sum(players, 'k')} / <span className="red">{sum(players, 'd')}</span> / {sum(players, 'a')} · 🌾 {k(sum(players, 'gold'))}</span>
      </div>
      <div className="mhr-row mhr-colhead muted">
        <span />
        <span>선수</span>
        <span>KDA</span>
        <span className="mhr-dmg"><span className="mhr-dmg-c">피해량</span><span className="mhr-dmg-c">받은피해량</span></span>
        <span>와드</span>
        <span>CS</span>
        <span>아이템</span>
        <span style={{ textAlign: 'right' }}>골드</span>
      </div>
      {players.map((p, i) => <RichRow key={i} p={p} dd={dd} color={color} maxDmg={maxDmg} maxTaken={maxTaken} durationMin={durationMin} byName={byName} onPlayer={onPlayer} itemUrl={itemUrl} highlight={highlight} alt={i % 2 === 1} />)}
    </div>
  );
}

function MatchCard({ m, dd, open, onToggle, onDelete, onSwap, byName, highlight, carryThreshold = 20, onPlayer }) {
  const aWin = m.winner === 'A';
  const mvp = [...m.A, ...m.B].find((p) => p.mvp);
  const ace = [...m.A, ...m.B].find((p) => p.ace); // 패배팀 에이스
  const mvpCarry = mvp && (mvp.score || 0) >= carryThreshold;
  const splash = mvp && dd.splash(mvp.champion); // 로딩아트(저해상 세로) 대신 스플래시(고해상 가로) → 선명
  const maxDmg = Math.max(1, ...[...m.A, ...m.B].map((p) => p.damage || 0));
  const maxTaken = Math.max(1, ...[...m.A, ...m.B].map((p) => p.detail?.dmgTaken || 0));
  const itemUrl = (id) => (id && dd.version ? `https://ddragon.leagueoflegends.com/cdn/${dd.version}/img/item/${id}.png` : null);

  if (!open) {
    // 본인(highlight)이 있으면 op.gg식 본인 중심 행
    const inA = highlight && m.A.find((p) => normNm(p.name) === highlight);
    const inB = highlight && m.B.find((p) => normNm(p.name) === highlight);
    const me = inA || inB;
    if (me) {
      const myWin = inA ? aWin : !aWin;
      const r = kdaRatio(me);
      const carry = me.mvp && (me.score || 0) >= carryThreshold; // 완전 캐리 MVP → 무지개 (기록 분포 기준)
      return (
        <div className={`mh-compact mhc-me-row ${myWin ? 'w' : 'l'} ${carry ? 'carry' : ''}`} onClick={onToggle}>
          <span className={`mh-win-tag ${myWin ? 'g' : 'r'}`}>{myWin ? '승' : '패'}</span>
          <ChampImg name={me.champion} iconUrl={dd.icon} size={40} />
          <div className="mhc-me">
            <span className="mhc-champ">{me.champion || '?'}
              {me.mvp ? <span className={`mbadge mvp ${carry ? 'rainbow' : ''}`}>MVP</span> : me.ace ? <span className="mbadge ace">ACE</span> : me.rank ? <span className="mhc-rank">{me.rank}위</span> : null}
            </span>
            <span className="mhc-kda">{me.k} / <span className="red">{me.d}</span> / {me.a} <span className={`mhc-ratio ${rClass(+r)}`}>{r} 평점</span></span>
          </div>
          <span className="mhc-stat muted">딜 {k(me.damage || 0)}</span>
          <span className="mhc-stat muted">CS {me.cs || 0}</span>
          <div className="mh-icons">{m.A.map((p, i) => <ChampImg key={i} name={p.champion} iconUrl={dd.icon} size={22} />)}</div>
          <span className="muted vs">vs</span>
          <div className="mh-icons">{m.B.map((p, i) => <ChampImg key={i} name={p.champion} iconUrl={dd.icon} size={22} />)}</div>
          <span className="mh-date muted">📅 {fmtDate(m.played_at)}</span>
          <span className="mh-chev">▾</span>
        </div>
      );
    }
    const dt = fmtDateTime(m.played_at);
    const dur = fmtDur(m.durationMin);
    const side = (players) => (
      <div className="mho-side">
        {players.map((p, i) => (
          <div className="mho-champ" key={i} title={`${p.name} · ${p.champion}`}>
            <ChampImg name={p.champion} iconUrl={dd.icon} size={30} />
            <span className="mho-cn">{p.name}</span>
          </div>
        ))}
      </div>
    );
    const keyP = (p, cls, label) => p && (
      <div className="mho-kp">
        <span className={`mho-kpb ${cls}`}>{label}</span>
        <span className="mho-kpn">{p.name}</span>
        <span className="mho-kpk muted">{p.k}/{p.d}/{p.a}</span>
      </div>
    );
    return (
      <div className={`mh-oprow ${aWin ? 'w-blue' : 'w-red'}`} onClick={onToggle}>
        <div className="mho-result">
          <span className={`mho-res ${aWin ? 'blue' : 'red'}`}>{aWin ? '블루 승리' : '레드 승리'}</span>
          {dur && <span className="mho-dur muted">⏱ {dur}</span>}
        </div>
        <div className="mho-date muted">
          <span>{dt.date}</span><span>{dt.time}</span>
        </div>
        <div className="mho-teams">
          {side(m.A)}
          <span className="mho-vslabel muted">VS</span>
          {side(m.B)}
        </div>
        <div className="mho-score">
          <div className="mho-vs"><b className="t-blue-c">{m.killsA}</b><span className="muted"> VS </span><b className="t-red-c">{m.killsB}</b></div>
          <div className="mho-kdatot muted">
            <span>{sum(m.A, 'k')}/{sum(m.A, 'd')}/{sum(m.A, 'a')}</span>
            <span className="mho-kdadiv">·</span>
            <span>{sum(m.B, 'k')}/{sum(m.B, 'd')}/{sum(m.B, 'a')}</span>
          </div>
        </div>
        <div className="mho-players">
          {keyP(mvp, 'mvp', 'MVP')}
          {keyP(ace, 'ace', 'ACE')}
        </div>
        <span className="mh-chev">›</span>
      </div>
    );
  }

  return (
    <div className="mh-full">
      <div className="mh-hero clickable" onClick={onToggle} title="배너를 누르면 접혀요" style={splash ? { backgroundImage: `linear-gradient(90deg, var(--panel) 16%, rgba(16,16,25,.5) 46%, transparent 72%), radial-gradient(ellipse 80% 130% at 82% 44%, transparent 40%, var(--panel) 88%), url(${splash})` } : {}}>
        <div className="mh-hero-left">
          <span className={`mh-win-tag ${aWin ? 'blue' : 'r'}`}>{aWin ? '블루 승리' : '레드 승리'}</span>
          <div className="mh-bigscore"><b className="t-blue-c">{m.killsA}</b><span className="muted"> · </span><b className="t-red-c">{m.killsB}</b></div>
          <div className="muted" style={{ fontSize: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <span>📅 {fmtDate(m.played_at)}</span>{m.durationMin ? <span>⏱ {fmtDur(m.durationMin)}</span> : null}
          </div>
        </div>
        {mvp && (
          <div className={`mh-mvp ${mvpCarry ? 'carry' : ''}`}>
            <span className={`mbadge mvp mh-mvp-badge ${mvpCarry ? 'rainbow' : ''}`}>👑 MVP</span>
            <ChampImg name={mvp.champion} iconUrl={dd.icon} size={42} />
            <div className="mh-mvp-id"><b>{mvp.name}</b><span className="muted">{mvp.champion} · {mvp.k}/{mvp.d}/{mvp.a}</span></div>
          </div>
        )}
        <div className="mh-hero-actions">
          {onSwap && <button className="mh-edit" title="블루↔레드 진영 뒤집기 (수동 업로드 보정)" onClick={(e) => { e.stopPropagation(); onSwap(m); }}>🔄 블루↔레드</button>}
          {onDelete && <Link href={`/record?edit=${m.id}`} className="mh-edit" title="이 경기 수정" onClick={(e) => e.stopPropagation()}>✏️ 수정</Link>}
          {onDelete && <button className="mh-del" title="이 경기 기록 삭제" onClick={(e) => { e.stopPropagation(); onDelete(m); }}>🗑 삭제</button>}
          <span className="mh-chev open">▴</span>
        </div>
      </div>
      {m.source === 'replay' && (m.A[0]?.detail || m.B[0]?.detail) ? (
        <div className="mhr-teams">
          <RosterRich label="블루" players={m.A} win={aWin} color="blue" dd={dd} maxDmg={maxDmg} maxTaken={maxTaken} durationMin={m.durationMin} byName={byName} onPlayer={onPlayer} itemUrl={itemUrl} highlight={highlight} />
          <MiddleBar objectives={m.objectives} killsA={m.killsA} killsB={m.killsB} goldA={m.goldA} goldB={m.goldB} />
          <RosterRich label="레드" players={m.B} win={!aWin} color="red" dd={dd} maxDmg={maxDmg} maxTaken={maxTaken} durationMin={m.durationMin} byName={byName} onPlayer={onPlayer} itemUrl={itemUrl} highlight={highlight} />
        </div>
      ) : (
        <div className="mhf-teams">
          <RosterFull label="블루" players={m.A} win={aWin} cs={m.csA} dd={dd} color="blue" maxDmg={maxDmg} byName={byName} highlight={highlight} carryThreshold={carryThreshold} onPlayer={onPlayer} />
          <RosterFull label="레드" players={m.B} win={!aWin} cs={m.csB} dd={dd} color="red" maxDmg={maxDmg} byName={byName} highlight={highlight} carryThreshold={carryThreshold} onPlayer={onPlayer} />
        </div>
      )}
    </div>
  );
}

export default function MatchHistory({ gid, dd, filterName, showSearch }) {
  const { canEdit } = useGroup();
  const [data, setData] = useState(null);
  const [open, setOpen] = useState({});
  const [busy, setBusy] = useState(false);
  const [byName, setByName] = useState({});
  const [q, setQ] = useState('');
  const [carryTh, setCarryTh] = useState(20);
  const [players, setPlayers] = useState([]);
  const [sel, setSel] = useState(null); // 카드뷰로 열 선수 (stats player 객체)
  const highlight = filterName ? normNm(filterName) : null;
  useEffect(() => {
    if (!gid) return;
    setData(null);
    fetch(`/api/match-history?gid=${gid}&limit=500`).then((x) => x.json()).then((r) => {
      if (r.ok) { setData(r.matches); setCarryTh(r.carryThreshold ?? 20); if (!filterName && r.matches[0]) setOpen({ [r.matches[0].id]: true }); }
    });
    fetch('/api/awards?gid=' + gid).then((x) => x.json()).then((r) => r.ok && setByName(r.awards?.byName || {}));
    fetch('/api/stats?gid=' + gid).then((x) => x.json()).then((r) => r.ok && setPlayers(r.players || []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gid]);

  const max = {
    kda: Math.max(1, ...players.map((p) => p.kda || 0)),
    dmg: Math.max(1, ...players.map((p) => p.avgDamage || 0)),
    cs: Math.max(1, ...players.map((p) => p.avgCs || 0)),
    pool: Math.max(1, ...players.map((p) => p.champPool || 0)),
  };
  const openPlayer = (personId) => { const pl = players.find((x) => x.id === personId); if (pl) setSel(pl); };

  async function onDelete(m) {
    if (busy) return;
    if (!window.confirm(`이 경기 기록을 삭제할까요?\n(${m.killsA} vs ${m.killsB} · ${fmtDate(m.played_at)})\n통계·전적에서 빠집니다.`)) return;
    setBusy(true);
    try {
      const r = await apiFetch(`/api/matches/${m.id}?gid=${gid}`, { method: 'DELETE' }).then((x) => x.json());
      if (!r.ok) throw new Error(r.error);
      setData((d) => d.filter((x) => x.id !== m.id));
    } catch (e) { window.alert('삭제 실패: ' + e.message); }
    setBusy(false);
  }

  async function onSwap(m) {
    if (busy) return;
    if (!window.confirm(`이 경기의 블루↔레드를 뒤집을까요?\n(현재 ${m.winner === 'A' ? '블루' : '레드'} 승리 → ${m.winner === 'A' ? '레드' : '블루'} 승리)`)) return;
    setBusy(true);
    try {
      const r = await apiFetch(`/api/matches/${m.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ group_id: gid, action: 'swapSides' }) }).then((x) => x.json());
      if (!r.ok) throw new Error(r.error);
      setData((d) => d.map((x) => (x.id === m.id ? swapMatchLocal(x) : x)));
    } catch (e) { window.alert('뒤집기 실패: ' + e.message); }
    setBusy(false);
  }

  if (!data) return <div className="panel center muted">불러오는 중…</div>;

  // 선수 필터 (그 사람이 낀 경기만) + 검색 (챔피언·선수 이름)
  let list = data;
  if (highlight) list = list.filter((m) => [...m.A, ...m.B].some((p) => normNm(p.name) === highlight));
  const qn = q.trim().toLowerCase();
  if (qn) list = list.filter((m) => [...m.A, ...m.B].some((p) =>
    (p.name || '').toLowerCase().includes(qn) || (p.champion || '').toLowerCase().includes(qn)));

  return (
    <div>
      {showSearch && (
        <div className="mh-search">
          <input placeholder="🔎 챔피언·선수 이름으로 검색" value={q} onChange={(e) => setQ(e.target.value)} />
          <span className="muted" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{list.length}경기</span>
        </div>
      )}
      {list.length === 0 ? (
        <div className="panel center muted" style={{ padding: '24px 0' }}>{data.length ? '검색 결과 없음' : '아직 기록된 경기가 없어요.'}</div>
      ) : (
        <div className="mh-list">
          {list.map((m) => (
            <MatchCard key={m.id} m={m} dd={dd} open={!!open[m.id]} byName={byName} highlight={highlight} carryThreshold={carryTh}
              onToggle={() => setOpen((o) => ({ ...o, [m.id]: !o[m.id] }))} onDelete={canEdit ? onDelete : null} onSwap={canEdit ? onSwap : null}
              onPlayer={players.length ? openPlayer : null} />
          ))}
        </div>
      )}
      {sel && <PlayerCard player={sel} gid={gid} max={max} dd={dd} onClose={() => setSel(null)} />}
    </div>
  );
}
