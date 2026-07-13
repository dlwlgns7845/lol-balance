'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import { useGroup } from '../../../../components/GroupProvider.jsx';
import { apiFetch } from '../../../../components/api.js';
import { normalizeSettings, REGIONS, TIER_BASES, TIER_BASIS_LABEL } from '../../../../src/tournament-settings.js';
import { groupStandings } from '../../../../src/bracket.js';
import { TIER_ORDER, TIER_LABEL, POS_KR, POS, TABLE, tierClass } from '../../../../src/table.js';
import { tierPts } from '../../../../src/engine.js';

const LANES = ['top', 'jungle', 'mid', 'adc', 'sup'];
const STLABEL = { recruiting: '🟢 팀 모집중', running: '🔵 진행중', done: '🏁 종료' };
const TST = { pending: '⏳대기', approved: '✅승인', rejected: '❌거절', eliminated: '💀탈락' };
const inp = { background: '#26262e', color: '#ddd', border: '1px solid #33333c', borderRadius: 6, padding: '6px 10px', fontSize: 13 };
const FORMAT_LABEL = { single_elim: '싱글 엘리미네이션', double_elim: '더블 엘리미네이션', group_stage: '그룹 스테이지(예선)' };
const SEED_LABEL = { order: '신청 순서', tier: '티어 시드(강팀 분산)', random: '랜덤 추첨' };
const FORMATION_LABEL = { auction: '경매 드래프트', score: '점수제', roster: '로스터 신청' };

export default function TournamentTab() {
  const { id, tab } = useParams();
  const { user, isAdmin, login } = useGroup() || {};
  const [data, setData] = useState(null);
  const [myRole, setMyRole] = useState(null); // 서버 판정 역할 (owner/admin/viewer)
  const [err, setErr] = useState(null);

  // 열람은 비로그인 OK. 로그인 상태면 apiFetch로 토큰 보내 자동 멤버등록 + 역할 수신.
  const load = useCallback(() => {
    if (id) apiFetch('/api/tournaments/' + id).then((x) => x.json()).then((r) => { if (r.ok) { setData(r); setMyRole(r.myRole || null); } else setErr(r.error); });
  }, [id]);
  useEffect(load, [load]);

  const t = data?.tournament;
  const teams = data?.teams || [];
  const matches = data?.matches || [];
  const pool = data?.pool || [];
  const auction = data?.auction || null;
  const nameOf = (tid) => teams.find((x) => x.id === tid)?.name || '?';
  const canManage = isAdmin || myRole === 'owner' || myRole === 'admin' || (!!user && !!t && user.id === t.owner_id);

  async function admin(body, path = '/teams', method = 'PATCH') {
    const r = await apiFetch('/api/tournaments/' + id + path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((x) => x.json());
    if (!r.ok) { alert('실패: ' + r.error); return; }
    if (r.tournament) setData(r); else load();
  }

  if (!t) return <div className="panel center muted">{err || '불러오는 중…'}</div>;

  const S = normalizeSettings(t.settings);
  const shared = { t, teams, matches, pool, auction, nameOf, canManage, admin, id, reload: load, S, user, login };
  return (
    <>
      <div className="page-head"><div className="title">
        <h1>🏆 {t.name} <span className="muted" style={{ fontSize: 14, fontWeight: 400 }}>{STLABEL[t.status]}</span></h1>
        <p className="sub" style={{ margin: 0 }}>{FORMAT_LABEL[S.format]} · 최대 {t.max_teams}팀 · 시드 {SEED_LABEL[S.seeding]}{S.bestOf > 1 ? ` · BO${S.bestOf}` : ''}</p>
      </div></div>
      {tab === 'notice' && <Notice {...shared} />}
      {tab === 'apply' && <Apply {...shared} />}
      {tab === 'stats' && <Stats {...shared} />}
      {tab === 'scrim' && <div className="panel center muted" style={{ padding: '40px 0' }}>🎯 스크림 기능은 준비 중이에요. (연습경기 매칭·일정 — 원하는 형태 알려주면 붙일게요)</div>}
      {tab === 'scoreboard' && <Scoreboard {...shared} />}
      {tab === 'auction' && (!user
        ? <div className="panel center muted" style={{ padding: '32px 0' }}>경매는 로그인 후 볼 수 있어요. <button className="btn" style={{ marginLeft: 8 }} onClick={login}><span className="gg">G</span> 로그인</button></div>
        : S.teamFormation === 'auction'
          ? <LiveAuction t={t} teams={teams} pool={pool} auction={auction} canManage={canManage} id={id} reload={load} user={user} S={S} />
          : <div className="panel center muted" style={{ padding: '32px 0' }}>이 대회는 경매 방식이 아니에요. (팀 구성: {FORMATION_LABEL[S.teamFormation]})</div>)}
      {tab === 'admin' && <AdminTab {...shared} />}
    </>
  );
}

// ─── 📢 공지 ───
function Notice({ t, teams, matches, nameOf, canManage, admin, S }) {
  const [txt, setTxt] = useState(t.notice || '');
  const [editing, setEditing] = useState(false);
  const totalRounds = matches.length ? Math.max(...matches.map((m) => m.round)) : 0;
  const champion = t.status === 'done' ? matches.find((m) => m.round === totalRounds)?.winner : null;
  const approved = teams.filter((x) => x.status === 'approved').length;
  const el = S.eligibility;
  const tierRange = el.tierCap || el.tierFloor ? `${el.tierCap ? TIER_LABEL[el.tierCap] : '무제한'} ~ ${el.tierFloor ? TIER_LABEL[el.tierFloor] : '무제한'}` : '없음';
  return (
    <>
      {champion && <div className="panel center" style={{ fontSize: 18, borderColor: '#e8c07d' }}>🏆 우승 — <b>{nameOf(champion)}</b></div>}
      <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <div className="stat-card"><div className="label">상태</div><div className="value" style={{ fontSize: 18 }}>{STLABEL[t.status]}</div></div>
        <div className="stat-card"><div className="label">참가팀</div><div className="value">{approved}<span className="muted" style={{ fontSize: 14 }}>/{t.max_teams}</span></div></div>
        <div className="stat-card"><div className="label">티어 제한</div><div className="value" style={{ fontSize: 15 }}>{tierRange}</div></div>
      </div>
      <div className="panel">
        <div style={{ display: 'flex', alignItems: 'center' }}><h2 style={{ margin: 0 }}>📢 공지</h2>
          {canManage && <button className="mini" style={{ marginLeft: 'auto' }} onClick={() => { setEditing(!editing); setTxt(t.notice || ''); }}>{editing ? '취소' : '✏️ 편집'}</button>}
        </div>
        {editing ? (
          <div style={{ marginTop: 10 }}>
            <textarea value={txt} onChange={(e) => setTxt(e.target.value)} rows={6} style={{ width: '100%', ...inp, resize: 'vertical' }} placeholder="대회 규칙·일정·안내를 적어주세요" />
            <button className="btn" style={{ marginTop: 8 }} onClick={() => { admin({ notice: txt }, '', 'PATCH'); setEditing(false); }}>저장</button>
          </div>
        ) : (
          <div style={{ marginTop: 10, whiteSpace: 'pre-wrap', color: t.notice ? '#ddd' : '#888', fontSize: 14, lineHeight: 1.7 }}>{t.notice || '아직 공지가 없어요.'}</div>
        )}
      </div>
    </>
  );
}

// ─── ⚙️ 관리자 탭 ───
function AdminTab({ t, S, admin, canManage, id, reload, user, login }) {
  if (!user) return <div className="panel center muted" style={{ padding: '32px 0' }}>관리자 기능은 로그인이 필요해요. <button className="btn" style={{ marginLeft: 8 }} onClick={login}><span className="gg">G</span> 로그인</button></div>;
  if (!canManage) return <div className="panel center muted" style={{ padding: '32px 0' }}>대회 운영자만 볼 수 있어요.</div>;
  return (
    <>
      <SettingsEditor S={S} admin={admin} />
      <AdminsManager id={id} t={t} reload={reload} user={user} />
    </>
  );
}

// ─── 👥 공동운영자 관리 ───
function AdminsManager({ id, t, reload, user }) {
  const [members, setMembers] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  const isHost = !!user && user.id === t.owner_id;
  const loadMembers = useCallback(() => {
    apiFetch(`/api/tournaments/${id}/members`).then((x) => x.json()).then((r) => { if (r.ok) { setMembers(r.members || []); setCandidates(r.candidates || []); } });
  }, [id]);
  useEffect(loadMembers, [loadMembers]);
  async function setRole(uid, role, info = {}) {
    setBusy(true);
    try {
      const r = await apiFetch(`/api/tournaments/${id}/members`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: uid, role, ...info }) }).then((x) => x.json());
      if (!r.ok) { alert('실패: ' + r.error); return; }
      loadMembers(); reload();
    } finally { setBusy(false); }
  }
  const admins = members.filter((m) => m.role === 'admin');
  const adminIds = new Set(admins.map((m) => m.user_id));
  const addable = candidates.filter((c) => c.user_id !== t.owner_id && !adminIds.has(c.user_id));
  const picked = addable.find((c) => c.user_id === pick);
  const ownerName = members.find((m) => m.user_id === t.owner_id)?.name;
  const label = (c) => c.name || c.email || (c.user_id || '').slice(0, 8);

  return (
    <div className="panel">
      <h2>👥 공동운영자</h2>
      <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>사이트에 로그인한 적 있는 유저 중에서 골라 권한을 줄 수 있어요. (상대가 이 대회에 미리 들어올 필요 없음)</div>
      {isHost ? (
        <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
          <select value={pick} onChange={(e) => setPick(e.target.value)} style={{ ...inp, minWidth: 220 }}>
            <option value="">로그인 유저 선택…</option>
            {addable.map((c) => <option key={c.user_id} value={c.user_id}>{label(c)}</option>)}
          </select>
          <button className="btn" disabled={busy || !picked} onClick={() => { if (picked) { setRole(picked.user_id, 'admin', { name: picked.name, email: picked.email }); setPick(''); } }}>공동운영 지정</button>
        </div>
      ) : <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>공동운영자 지정·해제는 대회장만 할 수 있어요.</div>}

      <div style={{ marginTop: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderTop: '1px solid #2a2a33' }}>
          <b>{ownerName || '대회장'}</b><span className="muted" style={{ fontSize: 11 }}>👑 대회장</span>
        </div>
        {admins.length === 0 && <div className="muted" style={{ fontSize: 12, padding: '6px 0' }}>아직 공동운영자가 없어요.</div>}
        {admins.map((m) => (
          <div key={m.user_id} style={{ display: 'flex', alignItems: 'center', gap: 8, borderTop: '1px solid #2a2a33', padding: '8px 0' }}>
            <b>{m.name || m.email || '유저'}</b><span className="muted" style={{ fontSize: 11 }}>🛠 공동운영</span>
            {isHost && <button className="mini" style={{ marginLeft: 'auto' }} disabled={busy} onClick={() => setRole(m.user_id, 'viewer')}>해제</button>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── ⚙️ 대회 설정 (주최자) ───
function SettingsEditor({ S, admin }) {
  const [open, setOpen] = useState(false);
  const [d, setD] = useState(S);
  const [busy, setBusy] = useState(false);
  const el = d.eligibility;
  const setEl = (k, v) => setD((x) => ({ ...x, eligibility: { ...x.eligibility, [k]: v } }));
  const tierOpts = [<option key="" value="">무제한</option>, ...TIER_ORDER.map((k) => <option key={k} value={k}>{TIER_LABEL[k]}</option>)];
  const lbl = { fontSize: 11.5, color: '#999', fontWeight: 700, display: 'block', marginBottom: 3 };
  const cell = { display: 'flex', flexDirection: 'column', gap: 0 };
  async function save() {
    setBusy(true);
    try { await admin({ settings: d }, '', 'PATCH'); setOpen(false); } finally { setBusy(false); }
  }
  return (
    <div className="panel">
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <h2 style={{ margin: 0 }}>⚙️ 대회 설정 <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>주최자만 보여요</span></h2>
        <button className="mini" style={{ marginLeft: 'auto' }} onClick={() => { setD(S); setOpen(!open); }}>{open ? '취소' : '✏️ 편집'}</button>
      </div>
      {!open ? (
        <div className="muted" style={{ fontSize: 13, marginTop: 8, lineHeight: 1.8 }}>
          로스터 {el.rosterMin}~{el.rosterMax}명 · {TIER_BASIS_LABEL[el.tierBasis]} {el.tierCap ? TIER_LABEL[el.tierCap] : '무제한'}~{el.tierFloor ? TIER_LABEL[el.tierFloor] : '무제한'}
          {el.minGames > 0 ? ` · ${el.minGames}판+` : ''}{el.minLevel > 0 ? ` · 최소 ${el.minLevel}레벨` : ''} · {FORMAT_LABEL[d.format]} · 시드 {SEED_LABEL[d.seeding]}{d.bestOf > 1 ? ` · BO${d.bestOf}` : ''} · <b style={{ color: '#cfae6f' }}>{FORMATION_LABEL[d.teamFormation]}</b>
        </div>
      ) : (
        <div style={{ marginTop: 12, display: 'grid', gap: 14 }}>
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: '#cfae6f', marginBottom: 7 }}>📋 참가 자격</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10 }}>
              <div style={cell}><label style={lbl}>로스터 최소</label><input type="number" min={1} max={10} value={el.rosterMin} onChange={(e) => setEl('rosterMin', +e.target.value)} style={inp} /></div>
              <div style={cell}><label style={lbl}>로스터 최대</label><input type="number" min={1} max={10} value={el.rosterMax} onChange={(e) => setEl('rosterMax', +e.target.value)} style={inp} /></div>
              <div style={cell}><label style={lbl}>최소 레벨</label><input type="number" min={0} value={el.minLevel} onChange={(e) => setEl('minLevel', +e.target.value)} style={inp} placeholder="0=제한없음" /></div>
              <div style={cell}><label style={lbl}>티어 선정 기준</label>
                <select value={el.tierBasis} onChange={(e) => setEl('tierBasis', e.target.value)} style={inp}>
                  {TIER_BASES.map((b) => <option key={b} value={b}>{TIER_BASIS_LABEL[b]}</option>)}
                </select>
              </div>
              <div style={cell}><label style={lbl}>티어 상한(이하)</label><select value={el.tierCap || ''} onChange={(e) => setEl('tierCap', e.target.value || null)} style={inp}>{tierOpts}</select></div>
              <div style={cell}><label style={lbl}>티어 하한(이상)</label><select value={el.tierFloor || ''} onChange={(e) => setEl('tierFloor', e.target.value || null)} style={inp}>{tierOpts}</select></div>
              <div style={cell}><label style={lbl}>현재 시즌 최소 판수</label><input type="number" min={0} value={el.minGames} onChange={(e) => setEl('minGames', +e.target.value)} style={inp} placeholder="0=제한없음" /></div>
              <div style={cell}><label style={lbl}>조회 지역</label>
                <select value={el.region} onChange={(e) => setEl('region', e.target.value)} style={inp}>{REGIONS.map((rg) => <option key={rg} value={rg}>{rg}</option>)}</select>
              </div>
              <div style={cell}><label style={lbl}>랭크 큐</label>
                <select value={el.allowFlex ? 'both' : 'solo'} onChange={(e) => setEl('allowFlex', e.target.value === 'both')} style={inp}>
                  <option value="both">솔로+자유랭</option>
                  <option value="solo">솔로랭크만</option>
                </select>
              </div>
            </div>
          </div>
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: '#cfae6f', marginBottom: 7 }}>🏆 대회 방식</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10 }}>
              <div style={cell}><label style={lbl}>대진 방식</label>
                <select value={d.format} onChange={(e) => setD((x) => ({ ...x, format: e.target.value }))} style={inp}>
                  <option value="single_elim">싱글 엘리미네이션</option>
                  <option value="group_stage">그룹 스테이지 → 본선</option>
                  <option value="double_elim">더블 엘리미네이션 (패자조)</option>
                </select>
              </div>
              {d.format === 'group_stage' && (
                <>
                  <div style={cell}><label style={lbl}>조 개수</label><input type="number" min={1} max={8} value={d.groups.count} onChange={(e) => setD((x) => ({ ...x, groups: { ...x.groups, count: +e.target.value } }))} style={inp} /></div>
                  <div style={cell}><label style={lbl}>조별 진출 팀</label><input type="number" min={1} max={8} value={d.groups.advance} onChange={(e) => setD((x) => ({ ...x, groups: { ...x.groups, advance: +e.target.value } }))} style={inp} /></div>
                </>
              )}
              {d.format === 'double_elim' && (
                <div style={{ gridColumn: '1 / -1', fontSize: 11.5, color: '#d0a56f' }}>⚠️ 더블 엘리는 승인 팀이 <b>4·8·16·32…</b> (2의 거듭제곱)일 때 대진이 생성돼요. 최종결승은 단판이에요.</div>
              )}
              <div style={cell}><label style={lbl}>시드 배정</label>
                <select value={d.seeding} onChange={(e) => setD((x) => ({ ...x, seeding: e.target.value }))} style={inp}>
                  <option value="order">신청 순서</option><option value="tier">티어 시드(강팀 분산)</option><option value="random">랜덤 추첨</option>
                </select>
              </div>
              <div style={cell}><label style={lbl}>경기 방식</label>
                <select value={d.bestOf} onChange={(e) => setD((x) => ({ ...x, bestOf: +e.target.value }))} style={inp}>
                  <option value={1}>단판 (BO1)</option><option value={3}>3판2선 (BO3)</option><option value={5}>5판3선 (BO5)</option>
                </select>
              </div>
              <div style={cell}><label style={lbl}>팀 구성 방식</label>
                <select value={d.teamFormation} onChange={(e) => setD((x) => ({ ...x, teamFormation: e.target.value }))} style={inp}>
                  <option value="auction">경매 드래프트</option>
                  <option value="score">점수제 (드래그 밸런싱)</option>
                </select>
              </div>
              {d.teamFormation === 'auction' && (
                <>
                  <div style={cell}><label style={lbl}>팀별 예산(포인트)</label><input type="number" min={1} value={d.auction.budget} onChange={(e) => setD((x) => ({ ...x, auction: { ...x.auction, budget: +e.target.value } }))} style={inp} /></div>
                  <div style={cell}><label style={lbl}>입찰 제한시간(초)</label><input type="number" min={5} max={600} value={d.auction.bidSeconds} onChange={(e) => setD((x) => ({ ...x, auction: { ...x.auction, bidSeconds: +e.target.value } }))} style={inp} /></div>
                  <div style={cell}><label style={lbl}>타이머 연장 상한(0=무제한)</label><input type="number" min={0} max={100} value={d.auction.bidMaxExtends} onChange={(e) => setD((x) => ({ ...x, auction: { ...x.auction, bidMaxExtends: +e.target.value } }))} style={inp} /></div>
                  <div style={cell}><label style={lbl}>이 금액↑ 연장중단(0=off)</label><input type="number" min={0} value={d.auction.bidNoResetOver} onChange={(e) => setD((x) => ({ ...x, auction: { ...x.auction, bidNoResetOver: +e.target.value } }))} style={inp} /></div>
                </>
              )}
              {d.teamFormation === 'score' && (
                <div style={cell}><label style={lbl}>팀 점수 상한</label><input type="number" min={1} value={d.scoreCap} onChange={(e) => setD((x) => ({ ...x, scoreCap: +e.target.value }))} style={inp} /></div>
              )}
            </div>
          </div>
          <button className="btn" disabled={busy} onClick={save} style={{ justifySelf: 'start' }}>저장</button>
        </div>
      )}
    </div>
  );
}

// ─── 📊 점수제 팀 빌더 (드래그/클릭 배치 · 실시간 밸런스) — 누구나 개인 화면에서 시뮬 ───
function ScoreTableRef() {
  return (
    <div style={{ overflowX: 'auto', margin: '8px 0' }}>
      <table className="tg-table">
        <thead><tr><th style={{ textAlign: 'left' }}>티어</th>{POS.map((p) => <th key={p}>{POS_KR[p]}</th>)}</tr></thead>
        <tbody>
          {TIER_ORDER.map((kk) => (
            <tr key={kk}><td style={{ textAlign: 'left' }} className={tierClass(kk)}>{TIER_LABEL[kk]}</td>{TABLE[kk].map((v, i) => <td key={i}>{v}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ScoreFormation({ pool, S, id, reload, user, login }) {
  const cap = S.scoreCap;
  const byId = Object.fromEntries(pool.map((p) => [p.id, p]));
  const [slots, setSlots] = useState([null, null, null, null, null]); // 라인별 poolId (탑~서폿)
  const [teamName, setTeamName] = useState('');
  const [sel, setSel] = useState(null);
  const [busy, setBusy] = useState(false);
  const r1 = (n) => Math.round(n * 10) / 10;
  const placed = new Set(slots.filter(Boolean));
  const unassigned = pool.filter((p) => !p.sold_to && !placed.has(p.id)); // 이미 팀 배정된(sold_to) 선수 제외
  const laneScore = (pid, lane) => { const p = byId[pid]; return (p && TABLE[p.tier]) ? tierPts(p.tier, lane) : null; };
  const total = r1(slots.reduce((s, pid, lane) => s + (pid ? (laneScore(pid, lane) || 0) : 0), 0));
  const full = slots.every(Boolean);
  const over = total > cap;

  const place = (pid, lane) => { setSel(null); setSlots((s) => { const a = [...s]; const i = a.indexOf(pid); if (i >= 0) a[i] = null; a[lane] = pid; return a; }); };
  const unassign = (pid) => setSlots((s) => s.map((x) => (x === pid ? null : x)));
  const reset = () => { setSlots([null, null, null, null, null]); setSel(null); setTeamName(''); };
  async function submit() {
    if (!full) { alert('5개 라인을 모두 채우세요'); return; }
    if (over) { alert(`팀 합계 ${total}점이 상한 ${cap}점을 초과해요`); return; }
    if (!teamName.trim()) { alert('팀 이름을 입력하세요'); return; }
    setBusy(true);
    try {
      const members = slots.map((pid, lane) => ({ poolId: pid, role: POS[lane] }));
      const r = await apiFetch(`/api/tournaments/${id}/score`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: teamName, members }) }).then((x) => x.json());
      if (!r.ok) throw new Error(r.error);
      reset(); reload();
    } catch (e) { alert('제출 실패: ' + e.message); } finally { setBusy(false); }
  }

  const Card = ({ pid, lane }) => {
    const p = byId[pid]; if (!p) return null;
    const sc = lane != null ? laneScore(pid, lane) : (TABLE[p.tier] ? Math.max(...POS.map((_, i) => tierPts(p.tier, i))) : null);
    return (
      <div className={`sf-card ${sel === pid ? 'sel' : ''}`} draggable
        onDragStart={(e) => e.dataTransfer.setData('pid', pid)}
        onClick={(e) => { e.stopPropagation(); setSel(sel === pid ? null : pid); }}>
        <span className="sf-nm">{p.game_name}</span>
        <span className={tierClass(p.tier)} style={{ fontSize: 10.5 }}>{p.tier ? (TIER_LABEL[p.tier] || p.tier) : '미확인'}</span>
        {sc != null && <span className="sf-sc">{r1(sc)}</span>}
        {lane != null && <button className="sf-x" onClick={(e) => { e.stopPropagation(); unassign(pid); }}>×</button>}
      </div>
    );
  };
  const Slot = ({ lane }) => {
    const pid = slots[lane];
    return (
      <div className="sf-slot" onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); const d = e.dataTransfer.getData('pid'); if (d) place(d, lane); }}
        onClick={() => { if (sel) place(sel, lane); }}>
        <span className="sf-lane">{POS_KR[POS[lane]]}</span>
        {pid ? <Card pid={pid} lane={lane} /> : <span className="sf-empty">{sel ? '여기 배치' : '비어있음'}</span>}
      </div>
    );
  };

  return (
    <div className="panel">
      <h2>📊 점수제 팀 짜기 <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>· 합계 <b>{cap}점 이내</b>로 드래그해서 팀을 맞춰 제출</span></h2>
      <div className="sf-layout">
        {/* 신청자 리스트 (드래그 소스) */}
        <div className="sf-side">
          <div className="sf-coltitle">신청자 ({unassigned.length}){sel ? ' · 라인 클릭' : ''}</div>
          <div className="sf-poolcol" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { const d = e.dataTransfer.getData('pid'); if (d) unassign(d); }}>
            {unassigned.map((p) => <Card key={p.id} pid={p.id} lane={null} />)}
            {unassigned.length === 0 && <span className="muted" style={{ fontSize: 12 }}>모두 배치됨</span>}
          </div>
        </div>
        {/* 시뮬레이션 툴 */}
        <div className="sf-tool">
          <div className="sf-summary">
            <span>합계 <b className={over ? 'sf-over' : 'sf-ok'}>{total}</b> <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>/ 상한 {cap}</span></span>
            <span className={`sf-light ${over ? 'red' : full ? 'green' : 'yellow'}`}>{over ? `⚠ ${r1(total - cap)}점 초과` : full ? `✅ 통과 (여유 ${r1(cap - total)})` : `${5 - slots.filter(Boolean).length}자리 남음`}</span>
            <button className="mini" onClick={reset}>초기화</button>
          </div>
          <div className="sf-team t-blue">{POS.map((_, i) => <Slot key={i} lane={i} />)}</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <input placeholder="우리 팀 이름" value={teamName} onChange={(e) => setTeamName(e.target.value)} style={{ ...inp, flex: 1, minWidth: 140 }} />
            {user
              ? <button className="btn" disabled={busy || !full || over || !teamName.trim()} onClick={submit}>{busy ? '제출 중…' : '팀 제출'}</button>
              : <button className="btn" onClick={login}><span className="gg">G</span> 로그인 후 제출</button>}
          </div>
        </div>
        {/* 점수표 (항상 표시) */}
        <div className="sf-side">
          <div className="sf-coltitle">📋 점수표</div>
          <div className="sf-tablecol"><ScoreTableRef /></div>
        </div>
      </div>
    </div>
  );
}

// ─── 📝 개인 신청 (인게임 티어 자동 배정) — 모든 방식 공통 ───
function ApplyPlayer({ t, id, reload, S }) {
  const [name, setName] = useState(''); const [role, setRole] = useState('');
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState(null); const [err, setErr] = useState(null);
  const el = S.eligibility;
  async function apply() {
    const [gn, tg] = (name || '').split('#');
    if (!gn || !tg) { setErr('게임닉#태그 형식으로 입력하세요 (예: Hide on bush#KR1)'); return; }
    setBusy(true); setErr(null); setMsg(null);
    try {
      // 인게임 티어 자동 배정 (개최자 기준: 지역·기준·큐)
      const prof = await fetch(`/api/seed?name=${encodeURIComponent(gn.trim())}&tag=${encodeURIComponent(tg.trim())}&region=${el.region}`).then((x) => x.json()).catch(() => ({}));
      const usable = el.allowFlex || el.tierBasis !== 'current' || prof.basis === '현재 솔랭'; // 솔로만 요구 시 현재 자유랭 티어 배제
      const pickBasis = { current: prof.suggestedTier, currentPeak: prof.curHighTier, lastSeason: prof.lastSeasonTier, peak: prof.peakTier };
      const tier = prof.found && usable ? (pickBasis[el.tierBasis] || prof.suggestedTier || null) : null;
      const games = prof.games ?? null;
      const r = await apiFetch(`/api/tournaments/${id}/auction`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ game_name: gn.trim(), tag_line: tg.trim(), tier, role: role || null, games }) }).then((x) => x.json());
      if (!r.ok) throw new Error(r.error);
      setMsg(`✅ 신청 완료 — 배정 티어 ${tier ? (TIER_LABEL[tier] || tier) : '미확인'}${games ? ` · 현재시즌 ${games}판` : ''}`);
      setName(''); setRole(''); reload();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  return (
    <div className="panel">
      <h2>📝 선수 신청 <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>· 인게임 티어 자동 배정</span></h2>
      <div style={{ background: 'rgba(207,174,111,.08)', border: '1px solid rgba(207,174,111,.25)', borderRadius: 8, padding: '8px 12px', fontSize: 12.5, color: '#d8c48f', margin: '8px 0' }}>
        📋 기준 <b>{TIER_BASIS_LABEL[el.tierBasis]}</b> · <b>{el.region}</b> · {el.allowFlex ? '솔로+자유랭' : '솔로랭크만'}
        {(el.tierCap || el.tierFloor) ? <> · {el.tierCap ? TIER_LABEL[el.tierCap] : '무제한'} ~ {el.tierFloor ? TIER_LABEL[el.tierFloor] : '무제한'}</> : ' · 티어 제한 없음'}
        {el.minGames > 0 ? <> · 현재시즌 <b>{el.minGames}판+</b></> : ''}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input placeholder="게임닉#태그 (예: Hide on bush#KR1)" value={name} onChange={(e) => setName(e.target.value)} style={{ ...inp, flex: 1, minWidth: 200 }} />
        <select value={role} onChange={(e) => setRole(e.target.value)} style={{ ...inp, width: 110 }}><option value="">선호 라인</option>{LANES.map((l) => <option key={l} value={l}>{POS_KR[l] || l}</option>)}</select>
        <button className="btn" disabled={busy || !name.trim()} onClick={apply}>{busy ? '티어 조회 중…' : '신청'}</button>
      </div>
      {msg && <div className="muted" style={{ marginTop: 8, color: '#7fd4a8' }}>{msg}</div>}
      {err && <div className="err" style={{ whiteSpace: 'pre-wrap' }}>{err}</div>}
    </div>
  );
}

// ─── 🧑‍🤝‍🧑 신청자 목록 (티어 배정됨) ───
function PoolList({ pool, canManage, id, reload }) {
  const [busy, setBusy] = useState(false);
  async function remove(pid) {
    if (!confirm('이 신청자를 삭제할까요?')) return;
    setBusy(true);
    try {
      const r = await apiFetch(`/api/tournaments/${id}/auction`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'remove', poolId: pid }) }).then((x) => x.json());
      if (!r.ok) { alert('실패: ' + r.error); return; }
      reload();
    } finally { setBusy(false); }
  }
  return (
    <div className="panel">
      <h2>🧑‍🤝‍🧑 신청자 <span className="muted" style={{ fontSize: 13, fontWeight: 400 }}>{pool.length}명</span></h2>
      {pool.length === 0 && <div className="muted" style={{ marginTop: 8 }}>아직 신청자가 없어요.</div>}
      {pool.map((p) => (
        <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, borderTop: '1px solid #2a2a33', padding: '7px 0' }}>
          <b style={{ minWidth: 130 }}>{p.game_name}{p.tag_line ? <span className="muted" style={{ fontWeight: 400, fontSize: 11 }}>#{p.tag_line}</span> : ''}</b>
          <span className={tierClass(p.tier)} style={{ fontSize: 12.5, fontWeight: 700 }}>{p.tier ? (TIER_LABEL[p.tier] || p.tier) : '티어 미확인'}</span>
          {p.role && <span className="muted" style={{ fontSize: 11.5 }}>{POS_KR[p.role] || p.role}</span>}
          {p.sold_to && <span className="accent" style={{ fontSize: 11 }}>{p.price != null ? `낙찰 ${p.price}p` : '팀 배정됨'}</span>}
          {canManage && !p.sold_to && <button className="mini" style={{ marginLeft: 'auto' }} disabled={busy} onClick={() => remove(p.id)}>🗑</button>}
        </div>
      ))}
    </div>
  );
}

// ─── ⚡ 실시간 경매 (관리자가 팀장 지정 → 팀장 입찰 → 낙찰) ───
function LiveAuction({ teams, pool, auction, canManage, id, reload, user, S }) {
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(0);
  const [amt, setAmt] = useState(''); const [pTeam, setPTeam] = useState(''); const [pAmt, setPAmt] = useState('');
  const firedRef = useRef(null);
  const auc = auction || { status: 'idle', current_bid: 0, increment: 5 };
  const inc = auc.increment || 5;
  const captainTeams = teams.filter((tm) => tm.is_captain_team);
  const hasCaptains = captainTeams.length > 0;
  const byId = Object.fromEntries(pool.map((p) => [p.id, p]));
  const waiting = pool.filter((p) => !p.sold_to && !p.passed); // 대기 신청자
  const passedPlayers = pool.filter((p) => !p.sold_to && p.passed); // 유찰 명단
  const remainingTotal = waiting.length + passedPlayers.length;
  const drafted = pool.filter((p) => p.sold_to && p.price > 0);
  const nominated = auc.current_pool_id ? byId[auc.current_pool_id] : null;
  const bidderTeam = auc.current_bidder ? teams.find((x) => x.id === auc.current_bidder) : null;
  const active = hasCaptains && auc.status !== 'done';
  const deadlineMs = auc.bid_deadline ? new Date(auc.bid_deadline).getTime() : null;
  const remainSec = (deadlineMs && now) ? Math.max(0, Math.ceil((deadlineMs - now) / 1000)) : null;

  useEffect(() => { // 진행 중 1.3s 폴링
    if (!active) return undefined;
    const iv = setInterval(reload, 1300);
    return () => clearInterval(iv);
  }, [active, reload]);
  useEffect(() => { // 카운트다운용 로컬 틱
    setNow(Date.now());
    const iv = setInterval(() => setNow(Date.now()), 400);
    return () => clearInterval(iv);
  }, []);

  async function act(body, base = '/live', method = 'POST') {
    setBusy(true);
    try {
      const r = await apiFetch(`/api/tournaments/${id}${base}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((x) => x.json());
      if (!r.ok) { alert('실패: ' + r.error); return; }
      reload();
    } finally { setBusy(false); }
  }
  // 시간 종료 → 관리자 클라이언트가 자동 마감(낙찰/유찰). 선수당 1회만.
  useEffect(() => {
    if (!canManage || auc.status !== 'bidding' || !auc.current_pool_id || remainSec == null) return;
    if (remainSec <= 0 && firedRef.current !== auc.current_pool_id) {
      firedRef.current = auc.current_pool_id;
      act(auc.current_bidder ? { action: 'sell' } : { action: 'pass' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remainSec, canManage, auc.status, auc.current_pool_id, auc.current_bidder]);
  const suggested = (auc.current_bid || 0) + inc;
  const au = S.auction || {};
  const extCnt = auc.extends || 0;
  const locked = (au.bidMaxExtends > 0 && extCnt >= au.bidMaxExtends) || (au.bidNoResetOver > 0 && (auc.current_bid || 0) >= au.bidNoResetOver);
  const extInfo = auc.status === 'bidding' ? (locked ? '🔒 시간 고정' : (au.bidMaxExtends > 0 ? `연장 ${extCnt}/${au.bidMaxExtends}` : null)) : null;
  const myTeam = captainTeams.find((tm) => tm.captain_user_id === user?.id);
  const proxyTeams = captainTeams.filter((tm) => !tm.captain_user_id); // 팀장 유저 미지정 → 관리자 대리
  const doBid = (teamId, amount) => act({ action: 'bid', teamId, amount });

  return (
    <div className="panel">
      <h2>⚡ 실시간 경매 <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>· 팀별 예산 {S.auction.budget}p · 입찰단위 {inc}p</span></h2>

      {/* 팀장 · 신청자 리스트 (모두 관전) */}
      <div className="la-lists">
        <div className="sf-side">
          <div className="sf-coltitle">🧑‍✈️ 팀장 ({captainTeams.length})</div>
          {captainTeams.length === 0 && <div className="muted" style={{ fontSize: 12.5 }}>아직 팀장이 없어요{canManage ? ' — 신청자에서 팀장으로 승격하세요.' : '.'}</div>}
          <div className="la-teams">
            {captainTeams.map((tm) => (
              <div key={tm.id} className={`la-team ${bidderTeam?.id === tm.id ? 'high' : ''} ${tm.captain_user_id === user?.id ? 'mine' : ''}`}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><b>{tm.name}</b><span className="accent">{tm.budget ?? 0}p</span></div>
                <div className="muted" style={{ fontSize: 11, marginTop: 3 }}>{(tm.members || []).map((m) => m.game_name).join(', ')}</div>
                {canManage && (tm.members || []).length <= 1 && auc.status === 'idle' && <button className="mini" style={{ marginTop: 6 }} disabled={busy} onClick={() => { if (confirm('팀장 해제?')) act({ action: 'removeCaptain', teamId: tm.id }); }}>팀장 해제</button>}
              </div>
            ))}
          </div>
        </div>
        <div className="sf-side">
          <div className="sf-coltitle">🧑‍🤝‍🧑 대기 신청자 ({waiting.length})</div>
          <div className="la-applicants">
            {waiting.length === 0 && <div className="muted" style={{ fontSize: 12.5 }}>대기 신청자가 없어요.</div>}
            {waiting.map((p) => (
              <div key={p.id} className={`la-app ${nominated?.id === p.id ? 'nom' : ''}`}>
                <b>{p.game_name}</b>
                <span className={tierClass(p.tier)} style={{ fontSize: 11 }}>{p.tier ? (TIER_LABEL[p.tier] || p.tier) : '미확인'}</span>
                {p.role && <span className="muted" style={{ fontSize: 11 }}>{POS_KR[p.role] || p.role}</span>}
                {canManage && auc.status !== 'bidding' && <button className="mini" style={{ marginLeft: 'auto' }} disabled={busy} onClick={() => act({ action: 'makeCaptain', poolId: p.id })}>팀장 승격</button>}
              </div>
            ))}
          </div>
          {passedPlayers.length > 0 && (
            <>
              <div className="sf-coltitle" style={{ marginTop: 12, color: '#e0925a' }}>🔁 유찰 명단 ({passedPlayers.length})</div>
              <div className="la-applicants">
                {passedPlayers.map((p) => (
                  <div key={p.id} className={`la-app ${nominated?.id === p.id ? 'nom' : ''}`} style={{ opacity: 0.9 }}>
                    <b>{p.game_name}</b>
                    <span className={tierClass(p.tier)} style={{ fontSize: 11 }}>{p.tier ? (TIER_LABEL[p.tier] || p.tier) : '미확인'}</span>
                    {p.role && <span className="muted" style={{ fontSize: 11 }}>{POS_KR[p.role] || p.role}</span>}
                    {canManage && auc.status !== 'bidding' && <button className="mini" style={{ marginLeft: 'auto' }} disabled={busy} onClick={() => act({ action: 'nominate', poolId: p.id })}>재경매</button>}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* 실시간 경매 무대 */}
      {hasCaptains && (
        <div className="la-stage">
          {auc.status === 'done' ? (
            <div className="la-done">🏁 경매 종료 — 팀 구성 완료</div>
          ) : nominated ? (
            <>
              <div className="la-nom">
                <div className="la-nomname"><b>{nominated.game_name}</b> <span className={tierClass(nominated.tier)}>{nominated.tier ? (TIER_LABEL[nominated.tier] || nominated.tier) : ''}</span>{nominated.role ? <span className="muted"> · {POS_KR[nominated.role] || nominated.role}</span> : ''}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  {remainSec != null && <span className={`la-timer ${remainSec <= 5 || locked ? 'urgent' : ''}`}>⏱ {remainSec}s</span>}
                  {extInfo && <span className={`la-ext ${locked ? 'locked' : ''}`}>{extInfo}</span>}
                  <div className="la-bidnow">현재가 <b className="accent">{auc.current_bid}p</b> {bidderTeam ? <>— <b>{bidderTeam.name}</b></> : <span className="muted">입찰 없음</span>}</div>
                </div>
              </div>
              <div className="la-bidctrls">
                {myTeam && (
                  <div className="la-bidctrl">
                    <span className="la-bidteam">{myTeam.name} <span className="muted">잔여 {myTeam.budget ?? 0}p</span></span>
                    <input type="number" min={suggested} placeholder={`${suggested}+`} value={amt} onChange={(e) => setAmt(e.target.value)} style={{ ...inp, width: 96 }} />
                    <button className="btn" disabled={busy || bidderTeam?.id === myTeam.id} onClick={() => { doBid(myTeam.id, amt || suggested); setAmt(''); }}>입찰</button>
                  </div>
                )}
                {canManage && proxyTeams.length > 0 && (
                  <div className="la-bidctrl">
                    <span className="muted" style={{ fontSize: 12 }}>대리:</span>
                    <select value={pTeam} onChange={(e) => setPTeam(e.target.value)} style={{ ...inp, width: 130 }}><option value="">팀 선택</option>{proxyTeams.map((tm) => <option key={tm.id} value={tm.id}>{tm.name}</option>)}</select>
                    <input type="number" min={suggested} placeholder={`${suggested}+`} value={pAmt} onChange={(e) => setPAmt(e.target.value)} style={{ ...inp, width: 80 }} />
                    <button className="mini" disabled={busy || !pTeam} onClick={() => { doBid(pTeam, pAmt || suggested); setPAmt(''); }}>입찰</button>
                  </div>
                )}
                {!myTeam && !(canManage && proxyTeams.length > 0) && <span className="muted" style={{ fontSize: 12.5 }}>입찰은 해당 팀 팀장만 가능해요.</span>}
              </div>
              {canManage && <div className="la-admin"><button className="btn" disabled={busy || !auc.current_bidder} onClick={() => act({ action: 'sell' })}>✅ 낙찰</button><button className="mini" disabled={busy} onClick={() => act({ action: 'pass' })}>유찰</button></div>}
            </>
          ) : (
            <div className="la-idle">
              <span className="muted">대기 중 — {remainingTotal ? '다음 선수를 지명하세요.' : '남은 선수가 없어요.'}</span>
              {canManage && (waiting.length > 0 || passedPlayers.length > 0) && <button className="btn" disabled={busy} onClick={() => act({ action: 'nominate' })}>🎲 {waiting.length ? '다음 선수' : '유찰 재경매'} (랜덤)</button>}
              {canManage && remainingTotal > 0 && <button className="mini" disabled={busy} onClick={() => { if (confirm(`남은 ${remainingTotal}명을 잔여 예산 많은 팀 순서로 배정하고 종료할까요?`)) act({ action: 'distribute' }); }}>잔여 포인트순 배정+종료</button>}
              {canManage && remainingTotal === 0 && auc.status !== 'done' && <button className="btn" disabled={busy} onClick={() => act({ action: 'end' })}>경매 종료</button>}
            </div>
          )}
        </div>
      )}

      {canManage && hasCaptains && drafted.length > 0 && (
        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="muted" style={{ fontSize: 12 }}>최근 낙찰:</span>
          {drafted.slice(-5).reverse().map((p) => (
            <span key={p.id} style={{ fontSize: 11.5 }} className="muted">{p.game_name}({p.price}p)<button className="sf-x" disabled={busy} onClick={() => act({ action: 'undo', poolId: p.id }, '/auction', 'PATCH')} title="낙찰 취소">↩</button></span>
          ))}
        </div>
      )}
      {canManage && (
        <div style={{ marginTop: 14, paddingTop: 10, borderTop: '1px solid #23232b', display: 'flex', justifyContent: 'flex-end' }}>
          <button className="mini" style={{ color: '#e06a78', borderColor: 'rgba(224,106,120,.4)' }} disabled={busy} onClick={() => { if (confirm('경매를 완전히 초기화할까요?\n\n팀·낙찰·대진이 모두 삭제되고 신청자 전원이 풀로 복원됩니다. 예산도 리셋돼요. (테스트용)')) act({ action: 'reset' }); }}>🔄 경매 초기화 (테스트)</button>
        </div>
      )}
    </div>
  );
}

// ─── 📝 신청 ───
function Apply({ t, teams, pool, auction, canManage, admin, id, reload, S, user, login }) {
  const isAuction = S.teamFormation === 'auction';
  const approved = teams.filter((x) => x.status === 'approved');
  const loginGate = (
    <div className="panel center" style={{ padding: '28px 0' }}>
      <div className="muted" style={{ marginBottom: 10 }}>둘러보기는 로그인 없이 되지만, <b>신청은 로그인이 필요해요.</b></div>
      <button className="btn" onClick={login}><span className="gg">G</span> 로그인</button>
    </div>
  );
  return (
    <>
      {/* ① 개인 신청 → 인게임 티어 자동 배정 (경매/점수제 공통) */}
      {t.status === 'recruiting' && (user ? <ApplyPlayer t={t} id={id} reload={reload} S={S} /> : loginGate)}
      {/* ② 신청자 목록 (티어 배정됨) */}
      <PoolList pool={pool} canManage={canManage} id={id} reload={reload} />
      {/* ③ 팀 짜기 — 경매=경매 탭, 점수제=점수표 탭 */}
      {t.status === 'recruiting' && <div className="panel center muted" style={{ padding: '18px 0' }}>{isAuction ? <>실시간 경매는 <b>🔨 경매 탭</b>에서 진행돼요.</> : <>점수제 팀 짜기는 <b>🏅 점수표 탭</b>에서 진행돼요.</>}</div>}
      {/* ④ 짜인 팀 + 대진 생성 */}
      <div className="panel">
        <h2>참가팀 ({approved.length}{t.status === 'recruiting' ? ` · 대기 ${teams.filter((x) => x.status === 'pending').length}` : ''})</h2>
        {teams.length === 0 && <div className="muted">아직 신청한 팀이 없어요.</div>}
        {teams.map((tm) => (
          <div key={tm.id} style={{ borderTop: '1px solid #2a2a33', padding: '8px 0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <b>{tm.seed ? `${tm.seed}. ` : ''}{tm.name}</b>
              <span className="muted" style={{ fontSize: 11 }}>{TST[tm.status]}{tm.captain ? ` · 주장 ${tm.captain}` : ''}</span>
              {canManage && t.status === 'recruiting' && (
                <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                  {tm.status !== 'approved' && <button className="mini" onClick={() => admin({ teamId: tm.id, status: 'approved' })}>승인</button>}
                  {tm.status !== 'rejected' && <button className="mini" onClick={() => admin({ teamId: tm.id, status: 'rejected' })}>거절</button>}
                  <button className="mini" onClick={() => { if (confirm('팀 삭제?')) admin({ teamId: tm.id, action: 'delete' }); }}>🗑</button>
                </span>
              )}
            </div>
            <div className="muted" style={{ fontSize: 11.5, marginTop: 3 }}>{tm.members.map((mm) => `${mm.game_name}${mm.tier ? `(${mm.tier})` : ''}`).join(' · ') || '로스터 없음'}</div>
          </div>
        ))}
        {canManage && t.status === 'recruiting' && (
          <button className="btn" style={{ marginTop: 12 }} disabled={approved.length < 2} onClick={() => { if (confirm(`승인 ${approved.length}팀으로 대진을 생성할까요? (신청 마감)`)) admin({}, '/bracket', 'POST'); }} title={approved.length < 2 ? '승인 2팀 이상 필요' : ''}>⚔️ 대진 생성 ({approved.length}팀)</button>
        )}
      </div>
    </>
  );
}

// ─── 📊 통계 ───
function Stats({ teams, matches, nameOf }) {
  const done = matches.filter((m) => m.winner);
  return (
    <>
      <div className="panel">
        <h2>참가팀 로스터·티어</h2>
        {teams.filter((x) => x.status === 'approved').map((tm) => (
          <div key={tm.id} style={{ borderTop: '1px solid #2a2a33', padding: '8px 0' }}>
            <b>{tm.name}</b>
            <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>{tm.members.map((mm) => `${mm.game_name}${mm.tier ? ` (${mm.tier})` : ''}`).join(' · ')}</div>
          </div>
        ))}
        {teams.filter((x) => x.status === 'approved').length === 0 && <div className="muted">승인된 팀이 없어요.</div>}
      </div>
      <div className="panel">
        <h2>경기 결과 ({done.length})</h2>
        {done.length === 0 && <div className="muted">아직 진행된 경기가 없어요.</div>}
        {done.map((m) => (
          <div key={m.id} style={{ borderTop: '1px solid #2a2a33', padding: '7px 0', fontSize: 13 }}>
            <span className="muted" style={{ fontSize: 11 }}>R{m.round}</span>　{nameOf(m.team_a)} vs {nameOf(m.team_b)} → <b className="accent">{nameOf(m.winner)}</b>{m.score_a != null ? ` (${m.score_a}:${m.score_b})` : ''}
          </div>
        ))}
      </div>
    </>
  );
}

// 점수제: 제출된 팀별 합계 점수 + 상한 대비
function ScoreOverview({ teams, S }) {
  const cap = S.scoreCap;
  const teamScore = (tm) => {
    let total = 0, ok = (tm.members || []).length === 5;
    (tm.members || []).forEach((m) => { if (m.role && TABLE[m.tier]) total += tierPts(m.tier, POS.indexOf(m.role)); else ok = false; });
    return { total: Math.round(total * 10) / 10, complete: ok };
  };
  return (
    <div className="panel">
      <h2>📊 팀 점수 <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>· 상한 {cap}점</span></h2>
      {teams.length === 0 && <div className="muted" style={{ marginTop: 8 }}>아직 제출된 팀이 없어요.</div>}
      {teams.map((tm) => {
        const { total, complete } = teamScore(tm);
        return (
          <div key={tm.id} style={{ borderTop: '1px solid #2a2a33', padding: '8px 0' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <b>{tm.seed ? `${tm.seed}. ` : ''}{tm.name}</b>
              <span className={total > cap ? 'sf-over' : 'sf-ok'} style={{ fontWeight: 800 }}>{complete ? total : '—'}</span>
              <span className="muted" style={{ fontSize: 11 }}>/ {cap}</span>
            </div>
            <div className="muted" style={{ fontSize: 11.5, marginTop: 3 }}>{(tm.members || []).map((m) => `${POS_KR[m.role] || m.role || '?'} ${m.game_name}(${m.tier || '?'})`).join(' · ') || '멤버 없음'}</div>
          </div>
        );
      })}
    </div>
  );
}

// ─── 🏅 점수표 (팀 점수 + 대진) ───
function Scoreboard({ t, matches, teams, pool, nameOf, canManage, admin, S, id, reload, user, login }) {
  const isScore = S.teamFormation === 'score';
  // 점수제: 드래그 팀 빌더 + 제출 팀 점수
  const builder = isScore ? <ScoreFormation pool={pool} S={S} id={id} reload={reload} user={user} login={login} /> : null;
  const overview = isScore ? <ScoreOverview teams={teams} S={S} /> : null;
  if (matches.length === 0) {
    return (
      <>
        {builder}
        {overview}
        {!isScore && <div className="panel center muted" style={{ padding: '32px 0' }}>아직 대진이 생성되지 않았어요. (신청 탭에서 대진 생성)</div>}
      </>
    );
  }
  const groupM = matches.filter((m) => m.bracket === 'G');
  const kM = matches.filter((m) => m.bracket === 'K');
  const wM = matches.filter((m) => m.bracket === 'W');
  if (wM.length > 0) return <>{builder}{overview}<DoubleElimBoard matches={matches} t={t} nameOf={nameOf} canManage={canManage} admin={admin} /></>;
  if (groupM.length === 0) return <>{builder}{overview}<BracketView matches={matches} title="대진표" t={t} nameOf={nameOf} canManage={canManage} admin={admin} /></>;

  // 그룹 스테이지 모드
  const gmap = {};
  groupM.forEach((x) => { (gmap[x.grp] = gmap[x.grp] || new Set()); if (x.team_a) gmap[x.grp].add(x.team_a); if (x.team_b) gmap[x.grp].add(x.team_b); });
  const groups = Object.keys(gmap).sort((a, b) => a - b).map((gi) => [...gmap[gi]]);
  const standings = groupStandings(matches, groups);
  const advance = S.groups.advance;
  return (
    <>
      {builder}{overview}
      <div className="panel">
        <h2>조별 리그 <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>· 조별 {advance}팀 진출</span></h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14, marginTop: 10 }}>
          {groups.map((g, gi) => (
            <div key={gi} className="tg-group">
              <div className="tg-gtitle">{String.fromCharCode(65 + gi)}조</div>
              <table className="tg-table">
                <thead><tr><th>#</th><th style={{ textAlign: 'left' }}>팀</th><th>승</th><th>패</th></tr></thead>
                <tbody>
                  {standings[gi].map((s, i) => (
                    <tr key={s.id} className={i < advance ? 'tg-adv' : ''}>
                      <td>{i + 1}</td><td style={{ textAlign: 'left' }}>{nameOf(s.id)}</td><td>{s.w}</td><td>{s.l}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="tg-matches">
                {groupM.filter((mm) => mm.grp === gi).sort((a, b) => a.pos - b.pos).map((mm) => (
                  <div key={mm.id} className="tg-m">
                    <span className={mm.winner === mm.team_a ? 'tg-win' : ''}>{nameOf(mm.team_a)}</span>
                    <span className="muted" style={{ fontSize: 10 }}>vs</span>
                    <span className={mm.winner === mm.team_b ? 'tg-win' : ''}>{nameOf(mm.team_b)}</span>
                    {canManage && t.status === 'running' && !mm.winner && (
                      <span className="tg-btns">
                        <button className="mini" title={`${nameOf(mm.team_a)} 승`} onClick={() => admin({ matchId: mm.id, winner: mm.team_a }, '/bracket', 'PATCH')}>◀</button>
                        <button className="mini" title={`${nameOf(mm.team_b)} 승`} onClick={() => admin({ matchId: mm.id, winner: mm.team_b }, '/bracket', 'PATCH')}>▶</button>
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        {canManage && t.status === 'running' && <p className="hint" style={{ marginTop: 8 }}>각 경기에서 이긴 팀 방향(◀/▶) 버튼 클릭. 초록 = 진출권.</p>}
      </div>
      {kM.length > 0
        ? <BracketView matches={kM} title="본선 대진표" t={t} nameOf={nameOf} canManage={canManage} admin={admin} />
        : <div className="panel center muted" style={{ padding: '24px 0' }}>조별 경기가 모두 끝나면 본선 대진이 자동으로 생성돼요.</div>}
    </>
  );
}

// 더블 엘리: 승자조·패자조·최종결승 3단
function DoubleElimBoard({ matches, t, nameOf, canManage, admin }) {
  const W = matches.filter((m) => m.bracket === 'W');
  const L = matches.filter((m) => m.bracket === 'L');
  const GF = matches.filter((m) => m.bracket === 'GF');
  return (
    <>
      <BracketView matches={W} title="🏆 승자조" t={t} nameOf={nameOf} canManage={canManage} admin={admin}
        roundLabel={(r, tot) => (r === tot ? '승자조 결승' : `${2 ** (tot - r + 1)}강`)} />
      <BracketView matches={L} title="💀 패자조" t={t} nameOf={nameOf} canManage={canManage} admin={admin}
        roundLabel={(r, tot) => (r === tot ? '패자조 결승' : `패자조 R${r}`)} />
      <BracketView matches={GF} title="👑 최종 결승" t={t} nameOf={nameOf} canManage={canManage} admin={admin}
        roundLabel={() => '최종 결승'} />
    </>
  );
}

// 싱글엘리/본선/각 브라켓 공용 렌더
function BracketView({ matches, title, t, nameOf, canManage, admin, roundLabel }) {
  const totalRounds = Math.max(...matches.map((m) => m.round));
  const rl = roundLabel || ((round) => (round === totalRounds ? '결승' : `${2 ** (totalRounds - round + 1)}강`));
  return (
    <div className="panel" style={{ overflowX: 'auto' }}>
      <h2>{title}</h2>
      <div style={{ display: 'flex', gap: 24, minWidth: 'min-content', paddingBottom: 8 }}>
        {Array.from({ length: totalRounds }, (_, r) => r + 1).map((round) => (
          <div key={round} style={{ display: 'flex', flexDirection: 'column', gap: 10, justifyContent: 'space-around', minWidth: 160 }}>
            <div className="muted" style={{ fontSize: 11, textAlign: 'center' }}>{rl(round, totalRounds)}</div>
            {matches.filter((m) => m.round === round).sort((a, b) => a.pos - b.pos).map((m) => (
              <div key={m.id} style={{ border: '1px solid #33333c', borderRadius: 8, background: '#1c1c22' }}>
                {[m.team_a, m.team_b].map((tid, k) => (
                  <div key={k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 9px', borderTop: k ? '1px solid #2a2a33' : 'none', background: m.winner === tid && tid ? 'rgba(79,182,214,.18)' : 'transparent', fontWeight: m.winner === tid ? 700 : 400, borderRadius: 6 }}>
                    <span style={{ fontSize: 13 }}>{tid ? nameOf(tid) : <span className="muted">미정</span>}</span>
                    {canManage && t.status === 'running' && tid && !m.winner && m.team_a && m.team_b && (
                      <button className="mini" style={{ padding: '1px 7px', fontSize: 10 }} onClick={() => admin({ matchId: m.id, winner: tid }, '/bracket', 'PATCH')}>승</button>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        ))}
      </div>
      {canManage && t.status === 'running' && <p className="hint" style={{ marginTop: 8 }}>이긴 팀의 <b>승</b> 버튼 → 다음 라운드 자동 진출.</p>}
    </div>
  );
}
