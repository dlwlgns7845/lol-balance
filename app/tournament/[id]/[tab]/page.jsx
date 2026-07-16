'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import { useGroup } from '../../../../components/GroupProvider.jsx';
import { apiFetch } from '../../../../components/api.js';
import { useDdragon } from '../../../../components/ddragon.js';
import { parseRofl } from '../../../../components/rofl.js';
import { RichScoreboard } from '../../../../components/MatchHistory.jsx';
import Avatar from '../../../../components/Avatar.jsx';
import PlayerCard from '../../../../components/PlayerCard.jsx';
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
const P2 = (n) => String(n).padStart(2, '0');
const fmtSched = (iso) => { if (!iso) return ''; const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()} ${P2(d.getHours())}:${P2(d.getMinutes())}`; };
const toLocalInput = (iso) => { if (!iso) return ''; const d = new Date(iso); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };

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
  const games = data?.games || [];
  const shared = { t, teams, matches, pool, auction, games, nameOf, canManage, admin, id, reload: load, S, user, login };
  return (
    <>
      <div className="page-head"><div className="title">
        <h1>🏆 {t.name} <span className="muted" style={{ fontSize: 14, fontWeight: 400 }}>{STLABEL[t.status]}</span></h1>
        <p className="sub" style={{ margin: 0 }}>{FORMAT_LABEL[S.format]} · 최대 {t.max_teams}팀 · 시드 {SEED_LABEL[S.seeding]}{S.bestOf > 1 ? ` · BO${S.bestOf}` : ''}{S.bestOfFinalRounds > 0 && S.bestOfFinal !== S.bestOf ? ` (후반 BO${S.bestOfFinal})` : ''}</p>
      </div></div>
      {tab === 'notice' && <Notice {...shared} />}
      {tab === 'apply' && <Apply {...shared} />}
      {tab === 'stats' && <Stats {...shared} />}
      {tab === 'scrim' && <Stats {...shared} />}
      {tab === 'scoreboard' && <Scoreboard {...shared} />}
      {tab === 'schedule' && <Schedule {...shared} />}
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
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  const isHost = !!user && user.id === t.owner_id;
  const loadMembers = useCallback(() => {
    apiFetch(`/api/tournaments/${id}/members`).then((x) => x.json()).then((r) => { if (r.ok) setMembers(r.members || []); });
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
  // 후보 = 이 대회를 연 로그인 유저 중 대회장·공동운영 제외
  const addable = members.filter((m) => m.user_id !== t.owner_id && m.role !== 'admin');
  const picked = addable.find((c) => c.user_id === pick);
  const ownerName = members.find((m) => m.user_id === t.owner_id)?.name;
  const label = (c) => c.name || c.email || (c.user_id || '').slice(0, 8);

  return (
    <div className="panel">
      <h2>👥 공동운영자</h2>
      <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>공동운영할 사람에게 이 대회 링크를 주고 <b>로그인해서 한 번 들어오면</b> 아래 목록에 떠요. (사이트 전체가 아니라 이 대회에 들어온 사람만)</div>
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
          {el.minGames > 0 ? ` · ${el.minGames}판+` : ''}{el.minLevel > 0 ? ` · 최소 ${el.minLevel}레벨` : ''} · {FORMAT_LABEL[d.format]} · 시드 {SEED_LABEL[d.seeding]}{d.bestOf > 1 ? ` · BO${d.bestOf}` : ''}{d.bestOfFinalRounds > 0 && d.bestOfFinal !== d.bestOf ? ` (후반 BO${d.bestOfFinal})` : ''} · <b style={{ color: '#cfae6f' }}>{FORMATION_LABEL[d.teamFormation]}</b>
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
              {d.format !== 'double_elim' && (
                <div style={cell}><label style={lbl}>3·4위전</label>
                  <select value={d.thirdPlace ? '1' : '0'} onChange={(e) => setD((x) => ({ ...x, thirdPlace: e.target.value === '1' }))} style={inp}>
                    <option value="0">없음</option><option value="1">있음 (준결승 패자끼리)</option>
                  </select>
                </div>
              )}
              <div style={cell}><label style={lbl}>시드 배정</label>
                <select value={d.seeding} onChange={(e) => setD((x) => ({ ...x, seeding: e.target.value }))} style={inp}>
                  <option value="order">신청 순서</option><option value="tier">티어 시드(강팀 분산)</option><option value="random">랜덤 추첨</option>
                </select>
              </div>
              <div style={cell}><label style={lbl}>경기 방식 (기본)</label>
                <select value={d.bestOf} onChange={(e) => setD((x) => ({ ...x, bestOf: +e.target.value }))} style={inp}>
                  <option value={1}>단판 (BO1)</option><option value={3}>3판2선 (BO3)</option><option value={5}>5판3선 (BO5)</option>
                </select>
              </div>
              <div style={cell}><label style={lbl}>후반 라운드 BO</label>
                <select value={d.bestOfFinal} onChange={(e) => setD((x) => ({ ...x, bestOfFinal: +e.target.value }))} style={inp}>
                  <option value={1}>단판 (BO1)</option><option value={3}>3판2선 (BO3)</option><option value={5}>5판3선 (BO5)</option>
                </select>
              </div>
              <div style={cell}><label style={lbl}>후반 BO 적용 범위</label>
                <select value={d.bestOfFinalRounds} onChange={(e) => setD((x) => ({ ...x, bestOfFinalRounds: +e.target.value }))} style={inp}>
                  <option value={0}>전체 동일 (기본 BO만)</option>
                  <option value={1}>결승만</option>
                  <option value={2}>준결승(4강)부터</option>
                  <option value={3}>8강부터</option>
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

function ScoreFormation({ pool, S, id, reload, user, login, canManage }) {
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
      const r = await apiFetch(`/api/tournaments/${id}/score`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'assemble', name: teamName, members }) }).then((x) => x.json());
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
      <h2>🧪 팀 시뮬레이터 <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>· 합계 <b>{cap}점 이내</b> 밸런스 미리보기{canManage ? ' (운영자는 바로 조립 가능)' : ' — 실제 팀은 아래에서'}</span></h2>
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
          {canManage
            ? (
              <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                <input placeholder="팀 이름 (운영자 직접 조립)" value={teamName} onChange={(e) => setTeamName(e.target.value)} style={{ ...inp, flex: 1, minWidth: 140 }} />
                <button className="btn" disabled={busy || !full || over || !teamName.trim()} onClick={submit}>{busy ? '조립 중…' : '운영자 조립 등록'}</button>
              </div>
            )
            : <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>🧪 미리보기 전용이에요. 실제 팀은 아래 <b>팀 목록</b>에서 방장이 만들고 합류 신청을 받아요.</div>}
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
      const level = prof.level ?? null;
      const r = await apiFetch(`/api/tournaments/${id}/auction`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ game_name: gn.trim(), tag_line: tg.trim(), tier, role: role || null, games, level }) }).then((x) => x.json());
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
      {/* ③ 팀 짜기 — 점수제=방장 승인제 팀 목록+시뮬(여기서 바로), 경매=경매 탭 */}
      {S.teamFormation === 'score' && (
        <>
          <ScoreTeams teams={teams} pool={pool} S={S} id={id} reload={reload} user={user} login={login} canManage={canManage} t={t} admin={admin} />
          {t.status === 'recruiting' && <ScoreFormation pool={pool} S={S} id={id} reload={reload} user={user} login={login} canManage={canManage} />}
        </>
      )}
      {isAuction && t.status === 'recruiting' && <div className="panel center muted" style={{ padding: '18px 0' }}>실시간 경매는 <b>🔨 경매 탭</b>에서 진행돼요.</div>}
      {/* ④ 짜인 팀 + 대진 생성 — 점수제는 팀 목록에서 처리하므로 숨김 */}
      {S.teamFormation !== 'score' && (
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
      )}
    </>
  );
}

// ─── 📊 통계 (멸망전 전용 경기기록 · 팀별/선수별 집계 · 리플 업로드) ───
const normG = (s) => (s || '').toLowerCase().replace(/[​-‏‪-‮⁠-⁯﻿]/g, '').split('#')[0].replace(/\s+/g, '');
const r1 = (n) => Math.round(n * 10) / 10;
const kfmt = (n) => (n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(Math.round(n || 0)));
function rosterTeamMap(teams) {
  const map = {};
  teams.forEach((t) => (t.members || []).forEach((m) => { const key = normG(m.game_name); if (key) map[key] = { id: t.id, name: t.name }; }));
  return map;
}
function pKey(p) { return normG(p.gameName || p.name); }
// 선수별 집계 (소속팀 = 로스터 매칭)
function aggregatePlayers(games, rmap) {
  const by = {};
  games.forEach((g) => (g.participants || []).forEach((p) => {
    const key = pKey(p); if (!key) return;
    const rt = rmap[key];
    const e = by[key] || (by[key] = { key, name: p.name || p.gameName, teamId: rt?.id || null, teamName: rt?.name || '미배정', g: 0, w: 0, k: 0, d: 0, a: 0, dmg: 0, gold: 0, cs: 0, champs: {} });
    e.g += 1; if (g.winner === p.team) e.w += 1;
    e.k += p.k || 0; e.d += p.d || 0; e.a += p.a || 0; e.dmg += p.damage || 0; e.gold += p.gold || 0; e.cs += p.cs || 0;
    if (p.champion) e.champs[p.champion] = (e.champs[p.champion] || 0) + 1;
  }));
  return Object.values(by);
}
// 팀별 집계 (팀의 다수 선수가 있는 쪽 = 그 팀의 진영)
function aggregateTeams(games, teams, rmap) {
  const by = {};
  teams.forEach((t) => { by[t.id] = { id: t.id, name: t.name, g: 0, w: 0, k: 0, d: 0, a: 0, gold: 0 }; });
  games.forEach((g) => {
    const side = {};
    (g.participants || []).forEach((p) => { const rt = rmap[pKey(p)]; if (!rt) return; (side[rt.id] = side[rt.id] || { A: 0, B: 0 })[p.team] += 1; });
    Object.entries(side).forEach(([tid, sc]) => {
      const e = by[tid]; if (!e) return;
      const s = sc.A >= sc.B ? 'A' : 'B';
      e.g += 1; if (g.winner === s) e.w += 1;
      (g.participants || []).forEach((p) => { if (p.team === s && rmap[pKey(p)]?.id === tid) { e.k += p.k || 0; e.d += p.d || 0; e.a += p.a || 0; e.gold += p.gold || 0; } });
    });
  });
  return Object.values(by).filter((t) => t.g > 0).sort((a, b) => (b.w / b.g) - (a.w / a.g) || b.g - a.g);
}
// 경기 3분류: 팀 확정 전 자유 스크림 / 팀 확정 후 팀 스크림 / 실제 경기 (legacy 'scrim'→open)
const GKINDS = [['open', '🎯 자유 스크림', '팀 확정 전 자유 경기'], ['team', '🛡 팀 스크림', '팀 확정 후 팀별 연습'], ['match', '🏆 실제 경기', '본선 시합']];
const GKIND_LABEL = { open: '자유 스크림', team: '팀 스크림', match: '실제 경기' };
const kindOf = (g) => (g.kind === 'team' ? 'team' : g.kind === 'match' ? 'match' : 'open');
// 통계용 2분류: 스크림(자유+팀) vs 실제경기
const kindGroup = (g) => (kindOf(g) === 'match' ? 'match' : 'scrim');
const POS_ORDER = ['top', 'jungle', 'mid', 'adc', 'sup'];
// 챔피언 상세 집계 (딜/CS/골드 분당 · 시야 · 멀티킬 — 내전 챔피언 상세와 동일 축)
function champStat(rows, games) {
  // rows: [{p, min}] 참가자+경기시간
  const by = {};
  rows.forEach(({ p, min, win }) => {
    if (!p.champion) return;
    const c = by[p.champion] || (by[p.champion] = { champion: p.champion, g: 0, w: 0, k: 0, d: 0, a: 0, dmg: 0, cs: 0, gold: 0, sec: 0, vision: 0, wards: 0, mk: 0, penta: 0 });
    c.g += 1; if (win) c.w += 1; c.k += p.k || 0; c.d += p.d || 0; c.a += p.a || 0;
    c.dmg += p.damage || 0; c.cs += p.cs || 0; c.gold += p.gold || 0; c.sec += min * 60;
    const det = p.detail || {};
    c.vision += det.visionScore || 0; c.wards += det.wardsPlaced || 0;
    c.mk += (det.double || 0) + (det.triple || 0) + (det.quadra || 0) + (det.penta || 0); c.penta += det.penta || 0;
  });
  return Object.values(by).map((c) => { const m = c.sec / 60, n = c.g || 1; return {
    champion: c.champion, g: c.g, w: c.w, winrate: c.g ? c.w / c.g : 0, k: c.k, d: c.d, a: c.a,
    kda: c.d ? r1((c.k + c.a) / c.d) : c.k + c.a, avgK: r1(c.k / n), avgD: r1(c.d / n), avgA: r1(c.a / n),
    avgDmg: Math.round(c.dmg / n), dmgPerMin: m ? Math.round(c.dmg / m) : 0, avgCs: Math.round(c.cs / n), csPerMin: m ? r1(c.cs / m) : 0,
    avgGold: Math.round(c.gold / n), goldPerMin: m ? Math.round(c.gold / m) : 0, avgVision: r1(c.vision / n), avgWards: r1(c.wards / n),
    multikills: c.mk, pentas: c.penta, hasDetail: c.dmg > 0 || c.sec > 0 || c.vision > 0,
  }; }).sort((a, b) => b.g - a.g || b.winrate - a.winrate || b.kda - a.kda);
}
function aggregateChamps(games) {
  const rows = [];
  games.forEach((g) => { const min = g.duration_sec ? g.duration_sec / 60 : 0; (g.participants || []).forEach((p) => rows.push({ p, min, win: g.winner === p.team })); });
  return champStat(rows, games);
}
// 특정 선수(key)의 챔프 상세 + 포지션 집계
function playerBreakdown(key, games) {
  const rows = [], pos = {};
  games.forEach((g) => { const min = g.duration_sec ? g.duration_sec / 60 : 0; (g.participants || []).forEach((p) => {
    if (pKey(p) !== key) return;
    rows.push({ p, min, win: g.winner === p.team });
    const ps = p.position; if (ps && POS_ORDER.includes(ps)) { const o = pos[ps] || (pos[ps] = { g: 0, w: 0 }); o.g += 1; if (g.winner === p.team) o.w += 1; }
  }); });
  return { champs: champStat(rows, games), positions: pos };
}
// 멸망전 선수 → 내전 PlayerCard 형식으로 변환 (컴포넌트 재사용)
function tPlayerCardData(key, games, rmap, teams) {
  const agg = aggregatePlayers(games, rmap).find((p) => p.key === key);
  if (!agg) return null;
  const bd = playerBreakdown(key, games);
  const g = agg.g || 1;
  const member = teams.flatMap((t) => t.members || []).find((m) => normG(m.game_name) === key);
  const kda = agg.d ? (agg.k + agg.a) / agg.d : (agg.k + agg.a);
  const positions = {}, positionStats = {};
  POS_ORDER.forEach((pp) => { if (bd.positions[pp]) { positions[pp] = bd.positions[pp].g; positionStats[pp] = { games: bd.positions[pp].g, wins: bd.positions[pp].w }; } });
  const mainPos = Object.entries(positions).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  const topChamps = bd.champs.slice(0, 3).map((c) => ({ champion: c.champion, games: c.g }));
  const champions = bd.champs.map((c) => ({ champion: c.champion, games: c.g, wins: c.w, winrate: c.winrate, k: c.k, d: c.d, a: c.a, kda: c.kda }));
  const history = games.filter((gm) => (gm.participants || []).some((p) => pKey(p) === key)).map((gm) => { const me = gm.participants.find((p) => pKey(p) === key); return { champion: me.champion, k: me.k, d: me.d, a: me.a, win: gm.winner === me.team, cs: me.cs, damage: me.damage, played_at: gm.played_at }; }).sort((a, b) => new Date(b.played_at || 0) - new Date(a.played_at || 0));
  const maxKill = history.reduce((b, m) => (!b || (m.k || 0) > b.kills ? { kills: m.k, champion: m.champion } : b), null);
  const maxKda = history.reduce((b, m) => { const v = m.d ? (m.k + m.a) / m.d : (m.k + m.a); return (!b || v > b.v ? { v: Math.round(v * 100) / 100, champion: m.champion } : b); }, null);
  const player = {
    id: key, name: agg.name, nickname: null, profile: null, base_tier: member?.tier || null,
    games: agg.g, kda, winrate: agg.w / g, wins: agg.w, losses: agg.g - agg.w, mvp: 0, ace: 0,
    avgDamage: Math.round(agg.dmg / g), avgCs: Math.round(agg.cs / g), champPool: Object.keys(agg.champs).length,
    positions, positionStats, totalK: agg.k, totalD: agg.d, totalA: agg.a, statGames: agg.g, topChamps, mainPos,
  };
  const detail = { champions, best: [], worst: [], history, recent: history.slice(0, 12), records: { maxKill, maxKda } };
  return { player, detail };
}
// 리치 스코어보드용 변환 (내전 표시 컴포넌트 재사용)
function gameToMatch(g) {
  const sum = (arr, f) => arr.reduce((s, p) => s + (p[f] || 0), 0);
  const toRow = (p) => ({ name: p.name || p.gameName, champion: p.champion, k: p.k || 0, d: p.d || 0, a: p.a || 0, damage: p.damage || 0, cs: p.cs || 0, gold: p.gold || 0, detail: p.detail || null, tier: p.tier || null, personId: pKey(p), mvp: false, ace: false });
  const A = (g.participants || []).filter((p) => p.team === 'A').map(toRow);
  const B = (g.participants || []).filter((p) => p.team === 'B').map(toRow);
  return { A, B, winner: g.winner, objectives: g.objectives, killsA: sum(A, 'k'), killsB: sum(B, 'k'), goldA: sum(A, 'gold'), goldB: sum(B, 'gold'), durationMin: g.duration_sec ? g.duration_sec / 60 : null };
}
// 경기의 한 진영 팀 이름 (로스터 다수결)
function sideTeamName(g, side, rmap) {
  const cnt = {};
  (g.participants || []).filter((p) => p.team === side).forEach((p) => { const rt = rmap[pKey(p)]; if (rt) cnt[rt.name] = (cnt[rt.name] || 0) + 1; });
  const top = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0];
  return top ? top[0] : (side === 'A' ? '블루' : '레드');
}

function GameUpload({ teams, id, reload, user, login }) {
  const [kind, setKind] = useState('match');
  const [parsed, setParsed] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const roflRef = useRef();
  const rmap = rosterTeamMap(teams);
  async function onRofl(e) {
    const file = e.target.files?.[0]; if (!file) return;
    setErr(null); setBusy(true);
    try { setParsed(await parseRofl(file)); } catch (er) { setErr('리플 분석 실패: ' + er.message); }
    setBusy(false); if (roflRef.current) roflRef.current.value = '';
  }
  async function save() {
    if (!parsed) return;
    setBusy(true); setErr(null);
    const participants = parsed.players.map((p) => ({ team: p.team, name: p.riotId || p.gameName, gameName: p.gameName, tag: p.tag, champion: p.champion, k: p.k, d: p.d, a: p.a, damage: p.damage, cs: p.cs, gold: p.gold, position: p.position, detail: p.detail }));
    try {
      const r = await apiFetch(`/api/tournaments/${id}/games`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, winner: parsed.winner, durationSec: parsed.durationSec, objectives: parsed.objectives, participants, source: 'replay' }) }).then((x) => x.json());
      if (!r.ok) throw new Error(r.error);
      setParsed(null); reload();
    } catch (e) { setErr('저장 실패: ' + e.message); } finally { setBusy(false); }
  }
  if (!user) return <div className="panel center muted" style={{ padding: '18px 0' }}>경기 기록은 <button className="mini" onClick={login}><span className="gg">G</span> 로그인</button> 후 올릴 수 있어요.</div>;
  const matched = parsed ? parsed.players.filter((p) => rmap[normG(p.gameName)]).length : 0;
  return (
    <div className="panel">
      <h2>🎬 경기 기록 올리기 <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>· .rofl 리플 → 팀 로스터 자동 귀속</span></h2>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 8 }}>
        <span style={{ display: 'inline-flex', gap: 4 }}>
          {GKINDS.map(([k, label, hint]) => <button key={k} className={`mini ${kind === k ? 'on' : ''}`} title={hint} onClick={() => setKind(k)}>{label}</button>)}
        </span>
        <input ref={roflRef} type="file" accept=".rofl" onChange={onRofl} disabled={busy} style={{ width: 'auto' }} />
        {busy && <span className="muted">처리 중…</span>}
      </div>
      {parsed && (
        <div style={{ marginTop: 10, padding: '9px 12px', background: '#181820', borderRadius: 8, border: '1px solid #2a2a33' }}>
          <div style={{ fontSize: 13, marginBottom: 6 }}>분석 완료 · {parsed.players.length}명 · <b className="accent">{parsed.winner === 'A' ? '블루' : '레드'} 승</b> {parsed.durationSec ? `· ${Math.floor(parsed.durationSec / 60)}분` : ''} · 로스터 매칭 <b className={matched >= 2 ? 'accent' : 'red'}>{matched}명</b></div>
          <div className="muted" style={{ fontSize: 11.5 }}>{parsed.players.map((p) => `${p.team === 'A' ? '🟦' : '🟥'}${p.gameName}(${p.champion})`).join(' · ')}</div>
          {matched < 2 && <div style={{ fontSize: 11.5, color: '#d0a56f', marginTop: 4 }}>⚠️ 로스터와 매칭되는 선수가 적어요. 팀 로스터 게임닉을 확인하세요(그래도 저장은 됩니다 · 미배정으로 집계).</div>}
          <button className="btn" style={{ marginTop: 8 }} disabled={busy} onClick={save}>{busy ? '저장 중…' : `${GKIND_LABEL[kind]} 기록 저장`}</button>
        </div>
      )}
      {err && <div className="err" style={{ whiteSpace: 'pre-wrap' }}>{err}</div>}
    </div>
  );
}

function Stats({ teams, games, id, reload, user, login, canManage }) {
  const dd = useDdragon();
  const [view, setView] = useState('records'); // records | rank | champs | players
  const [kindF, setKindF] = useState('all');    // all | open | team | match
  const [openG, setOpenG] = useState(null);     // 펼친 경기 id
  const [sel, setSel] = useState(null);         // 선택 선수 key (카드 모달)
  const [selTeam, setSelTeam] = useState(null); // 선택 팀 id (카드 모달)
  const [teamPage, setTeamPage] = useState(null); // 팀 상세 페이지
  const [q, setQ] = useState(''); const [focusS, setFocusS] = useState(false); // 선수·팀 검색
  const [busy, setBusy] = useState(false);
  const rmap = rosterTeamMap(teams);
  const fgames = kindF === 'all' ? games : games.filter((g) => kindGroup(g) === kindF);
  const players = aggregatePlayers(fgames, rmap).sort((a, b) => (b.w / (b.g || 1)) - (a.w / (a.g || 1)) || b.g - a.g);
  const tstats = aggregateTeams(fgames, teams, rmap);
  const champs = aggregateChamps(fgames);
  // 리더보드: 내전과 동일 점수 공식 (보정승률×0.9 + ln(판수)×10 + √KDA×12 + 딜(k)×0.4)
  const scoreOf = (g, w, kda, avgDmg) => { if (!g) return 0; const adj = (w + 2) / (g + 4); return Math.round((adj * 100 * 0.9 + Math.log(g) * 10 + Math.sqrt(kda || 0) * 12 + (avgDmg || 0) / 1000 * 0.4) * 10) / 10; };
  const lbPlayers = players.map((p) => {
    const kda = p.d ? (p.k + p.a) / p.d : (p.k + p.a);
    const avgDamage = p.dmg / p.g;
    const topChamps = Object.entries(p.champs).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([champion, gm]) => ({ champion, games: gm }));
    return { ...p, kAvg: r1(p.k / p.g), dAvg: r1(p.d / p.g), aAvg: r1(p.a / p.g), kda, avgDamage, winrate: p.w / p.g, wins: p.w, losses: p.g - p.w, topChamps, score: scoreOf(p.g, p.w, kda, avgDamage) };
  }).sort((a, b) => b.score - a.score);
  const maxDmg = Math.max(1, ...lbPlayers.map((p) => p.avgDamage || 0));
  const medal = (i) => ['🥇', '🥈', '🥉'][i] || null;
  const wrCls = (w) => (w >= 0.6 ? 'green' : w >= 0.5 ? 'yellow' : 'red');
  const allAgg = aggregatePlayers(games, rmap);
  const pcMax = { kda: Math.max(1, ...allAgg.map((p) => (p.d ? (p.k + p.a) / p.d : (p.k + p.a)))), dmg: Math.max(1, ...allAgg.map((p) => p.dmg / (p.g || 1))), cs: Math.max(1, ...allAgg.map((p) => p.cs / (p.g || 1))), pool: Math.max(1, ...allAgg.map((p) => Object.keys(p.champs).length)) };
  const qn = q.trim().toLowerCase();
  const playerHits = qn ? allAgg.filter((p) => (p.name || '').toLowerCase().includes(qn)).slice(0, 8) : [];
  const teamHits = qn ? teams.filter((t) => (t.name || '').toLowerCase().includes(qn)).slice(0, 6) : [];
  const mostChamp = (c) => { const e = Object.entries(c).sort((a, b) => b[1] - a[1])[0]; return e ? e[0] : '-'; };
  const champImg = (c) => dd.icon(c);
  const canDel = (g) => canManage || (user && g.uploader_user_id === user.id);
  async function del(gameId) {
    if (!confirm('이 경기 기록을 삭제할까요?')) return;
    setBusy(true);
    try { const r = await apiFetch(`/api/tournaments/${id}/games`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ gameId }) }).then((x) => x.json()); if (!r.ok) alert('실패: ' + r.error); else reload(); } finally { setBusy(false); }
  }
  const selPlayer = sel ? aggregatePlayers(games, rmap).find((p) => p.key === sel) : null;
  const selGames = sel ? games.filter((g) => (g.participants || []).some((p) => pKey(p) === sel)) : [];

  function GameRow({ g }) {
    const open = openG === g.id;
    return (
      <div style={{ borderTop: '1px solid #2a2a33' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 2px', cursor: 'pointer' }} onClick={() => setOpenG(open ? null : g.id)}>
          <span className="mini" style={{ padding: '1px 7px', fontSize: 10.5 }}>{GKIND_LABEL[kindOf(g)]}</span>
          <span style={{ fontSize: 12.5 }}><b className={g.winner === 'A' ? 'accent' : ''}>{sideTeamName(g, 'A', rmap)}</b> <span className="muted">vs</span> <b className={g.winner === 'B' ? 'accent' : ''}>{sideTeamName(g, 'B', rmap)}</b></span>
          <span className="muted" style={{ fontSize: 11 }}>{g.duration_sec ? `${Math.floor(g.duration_sec / 60)}분` : ''}</span>
          <span style={{ display: 'flex', gap: 2, marginLeft: 6 }}>{(g.participants || []).map((p, i) => champImg(p.champion) ? <img key={i} src={champImg(p.champion)} alt="" width={18} height={18} style={{ borderRadius: 4, opacity: g.winner === p.team ? 1 : 0.5 }} /> : null)}</span>
          {canDel(g) && <button className="mini" style={{ marginLeft: 'auto' }} disabled={busy} onClick={(e) => { e.stopPropagation(); del(g.id); }}>🗑</button>}
          <span className="muted" style={{ marginLeft: canDel(g) ? 6 : 'auto', fontSize: 12 }}>{open ? '▴' : '▾'}</span>
        </div>
        {open && <div style={{ padding: '2px 0 10px' }}><RichScoreboard m={gameToMatch(g)} dd={dd} onPlayer={(key) => setSel(key)} /></div>}
      </div>
    );
  }

  return (
    <>
      <GameUpload teams={teams} id={id} reload={reload} user={user} login={login} />

      <div className="panel" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ display: 'inline-flex', gap: 4 }}>
          {[['records', '🎮 경기기록'], ['rank', '🏆 리더보드'], ['champs', '🥷 챔피언']].map(([k, l]) => (
            <button key={k} className={`mini ${view === k ? 'on' : ''}`} onClick={() => { setView(k); setSel(null); setSelTeam(null); setTeamPage(null); }}>{l}</button>
          ))}
        </span>
        <span style={{ display: 'inline-flex', gap: 4 }}>
          {[['all', '전체'], ['scrim', '🎯 스크림'], ['match', '🏆 실제경기']].map(([k, l]) => (
            <button key={k} className={`mini ${kindF === k ? 'on' : ''}`} onClick={() => setKindF(k)}>{l}</button>
          ))}
        </span>
        <div style={{ marginLeft: 'auto', position: 'relative' }}>
          <input placeholder="🔎 선수·팀 검색" value={q} onChange={(e) => setQ(e.target.value)} onFocus={() => setFocusS(true)} onBlur={() => setTimeout(() => setFocusS(false), 150)} style={{ ...inp, width: 190 }} />
          {focusS && qn && (
            <div style={{ position: 'absolute', top: '100%', right: 0, zIndex: 30, background: '#16161c', border: '1px solid #2a2a33', borderRadius: 8, minWidth: 230, maxHeight: 300, overflowY: 'auto', marginTop: 4, boxShadow: '0 8px 24px rgba(0,0,0,.5)' }}>
              {teamHits.map((t) => (
                <button key={t.id} onMouseDown={() => { setTeamPage(t.id); setSel(null); setQ(''); setFocusS(false); }} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', background: 'none', border: 'none', color: '#ddd', padding: '8px 12px', cursor: 'pointer', fontSize: 13 }}>🛡 <b>{t.name}</b></button>
              ))}
              {playerHits.map((p) => (
                <button key={p.key} onMouseDown={() => { setSel(p.key); setQ(''); setFocusS(false); }} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', background: 'none', border: 'none', color: '#ddd', padding: '8px 12px', cursor: 'pointer', fontSize: 13 }}>👤 <b>{p.name}</b> <span className="muted" style={{ fontSize: 11, marginLeft: 'auto' }}>{p.teamName}</span></button>
              ))}
              {teamHits.length === 0 && playerHits.length === 0 && <div className="muted" style={{ padding: '10px 12px', fontSize: 12.5 }}>검색 결과 없음</div>}
            </div>
          )}
        </div>
      </div>

      {games.length === 0 && <div className="panel center muted" style={{ padding: '26px 0' }}>아직 기록된 경기가 없어요. 위에서 리플을 올려보세요.</div>}

      {!sel && !teamPage && view ==='records' && (kindF === 'all' ? ['open', 'team', 'match'] : kindF === 'scrim' ? ['open', 'team'] : ['match']).map((kind) => {
        const gs = games.filter((g) => kindOf(g) === kind);
        if (!gs.length) return null;
        const info = GKINDS.find((x) => x[0] === kind);
        return (
          <div key={kind} className="panel">
            <h2>{info[1]} <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>· {info[2]} · {gs.length}경기</span></h2>
            {gs.map((g) => <GameRow key={g.id} g={g} />)}
          </div>
        );
      })}

      {!sel && !teamPage && view ==='rank' && (
        <>
          {tstats.length > 0 && (
            <div className="panel">
              <h2>🏅 팀 순위 <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>· 승률순</span></h2>
              <div style={{ overflowX: 'auto' }}><table className="rec-table" style={{ marginTop: 8 }}>
                <thead><tr><th>#</th><th className="l">팀</th><th>경기</th><th>승</th><th>패</th><th>승률</th><th>KDA</th><th>골드/경기</th></tr></thead>
                <tbody>{tstats.map((t, i) => (
                  <tr key={t.id} style={{ cursor: 'pointer' }} onClick={() => setSelTeam(t.id)}><td>{i + 1}</td><td className="l"><b>{t.name}</b></td><td>{t.g}</td><td>{t.w}</td><td>{t.g - t.w}</td><td>{Math.round(t.w / t.g * 100)}%</td><td className="muted">{t.k}/{t.d}/{t.a}</td><td className="muted">{kfmt(t.gold / t.g)}</td></tr>
                ))}</tbody>
              </table></div>
            </div>
          )}
          {lbPlayers.length > 0 && (
            <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
              <div className="lb-head">
                <h2 style={{ margin: 0 }}>리더보드 <span className="muted" style={{ fontWeight: 400, fontSize: 11 }}>· 내전 점수순 (라플라스 보정)</span></h2>
                <span className="formula">보정승률×0.9 + ln(판수)×10 + √KDA×12 + 딜(k)×0.4</span>
              </div>
              <div className="lbx">
                <div className="lbx-row lbx-hd lbx-hd-static">
                  <div /><div>선수</div><div className="hd-c">KDA</div><div className="hd-c">딜량</div><div className="lbx-badges">팀</div><div className="hd-c">승률</div><div className="lbx-most">모스트</div><div className="hd-c">점수</div>
                </div>
                {lbPlayers.map((p, i) => {
                  const splash = dd.splash(p.topChamps?.[0]?.champion);
                  return (
                    <div key={p.key} className={`lbx-row ${i === 0 ? 'top1' : i === 1 ? 'top2' : i === 2 ? 'top3' : ''}`} style={{ cursor: 'pointer' }} onClick={() => setSel(p.key)}>
                      {splash && <div className="lbx-splash" style={{ backgroundImage: `url(${splash})` }} />}
                      <div className="lbx-rank">{medal(i) || <span className="num">{i + 1}</span>}</div>
                      <div className="lbx-name">
                        <Avatar name={p.name} size={30} />
                        <div className="lbx-nm-txt"><b>{p.name}</b><span className="muted">{p.teamName}</span></div>
                      </div>
                      <div className="lbx-kda">
                        <div className="kda-line">{p.kAvg}/<span className="red">{p.dAvg}</span>/{p.aAvg}</div>
                        <div className={`kda-val ${p.kda >= 5 ? 'kv-5' : p.kda >= 4 ? 'kv-4' : p.kda >= 3 ? 'kv-3' : ''}`}>{p.kda != null ? p.kda.toFixed(2) : '-'} KDA</div>
                      </div>
                      <div className="lbx-dmg" title="평균 딜량">
                        <span className="dnum">{p.avgDamage ? (p.avgDamage / 1000).toFixed(1) + 'k' : '-'}</span>
                        {p.avgDamage ? <div className="dbar"><span style={{ width: Math.round((p.avgDamage / maxDmg) * 100) + '%' }} /></div> : null}
                      </div>
                      <div className="lbx-badges"><span className="muted" style={{ fontSize: 10.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.teamName}</span></div>
                      <div className="lbx-wr">
                        <div className="wrbar"><span className={wrCls(p.winrate)} style={{ width: Math.round(p.winrate * 100) + '%' }} /></div>
                        <span className="wrpct">{Math.round(p.winrate * 100)}% <span className="muted">{p.wins}-{p.losses}</span></span>
                      </div>
                      <div className="lbx-most">
                        {p.topChamps?.map((c) => (champImg(c.champion) ? <img key={c.champion} src={champImg(c.champion)} alt="" title={`${c.champion} ${c.games}판`} width={26} height={26} style={{ borderRadius: 5 }} /> : null))}
                      </div>
                      <div className="lbx-score"><b>{p.score}</b><span>점</span></div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {!sel && !teamPage && view ==='champs' && (
        <div className="panel">
          <h2>🥷 챔피언 <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>· 픽·승률·KDA·딜/CS/골드(분당)·시야·멀티킬</span></h2>
          {champs.length === 0 && <div className="muted" style={{ marginTop: 8 }}>데이터가 없어요.</div>}
          {champs.length > 0 && <div style={{ overflowX: 'auto' }}><table className="rec-table" style={{ marginTop: 8 }}>
            <thead><tr><th className="l">챔피언</th><th>픽</th><th>승률</th><th>KDA</th><th className="l">평균 K/D/A</th><th>딜(분당)</th><th>CS(분당)</th><th>골드(분당)</th><th>시야</th><th>멀티킬</th></tr></thead>
            <tbody>{champs.map((c) => (
              <tr key={c.champion}>
                <td className="l"><span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>{champImg(c.champion) ? <img src={champImg(c.champion)} alt="" width={24} height={24} style={{ borderRadius: 5 }} /> : null}<b>{c.champion}</b></span></td>
                <td>{c.g}</td><td className={c.winrate >= 0.6 ? 'accent' : c.winrate < 0.4 ? 'red' : ''}>{Math.round(c.winrate * 100)}%</td>
                <td><b>{c.kda}</b></td><td className="l muted">{c.avgK}/<span className="red">{c.avgD}</span>/{c.avgA}</td>
                <td>{c.hasDetail ? <><b>{kfmt(c.avgDmg)}</b> <span className="muted">({c.dmgPerMin})</span></> : <span className="muted">-</span>}</td>
                <td>{c.hasDetail ? <><b>{c.avgCs}</b> <span className="muted">({c.csPerMin})</span></> : <span className="muted">-</span>}</td>
                <td>{c.hasDetail ? <><b>{kfmt(c.avgGold)}</b> <span className="muted">({c.goldPerMin})</span></> : <span className="muted">-</span>}</td>
                <td className="muted">{c.hasDetail ? <>{c.avgVision} <span style={{ fontSize: 10.5 }}>👁{c.avgWards}</span></> : '-'}</td>
                <td>{c.multikills ? <b className="gold">{c.multikills}{c.pentas ? ` · P${c.pentas}` : ''}</b> : <span className="muted">-</span>}</td>
              </tr>
            ))}</tbody>
          </table></div>}
        </div>
      )}

      {selTeam && (() => {
        const t = teams.find((x) => x.id === selTeam);
        if (!t) return null;
        const ts = aggregateTeams(games, teams, rmap).find((x) => x.id === selTeam);
        const allP = aggregatePlayers(games, rmap);
        return (
          <div className="modal-back" onClick={() => setSelTeam(null)}>
            <div className="pcard" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
              <button className="pcard-x" onClick={() => setSelTeam(null)}>✕</button>
              <div style={{ padding: '20px 22px' }}>
                <h2 style={{ margin: 0 }}>{t.name}</h2>
                {ts ? <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>{ts.g}경기 · <b className="accent">{Math.round(ts.w / ts.g * 100)}%</b> ({ts.w}승 {ts.g - ts.w}패) · KDA {ts.k}/{ts.d}/{ts.a} · 골드/경기 {kfmt(ts.gold / ts.g)}</div> : <div className="muted" style={{ marginTop: 4, fontSize: 12.5 }}>경기 기록 없음</div>}
                <h3 style={{ margin: '14px 0 6px', fontSize: 14 }}>로스터</h3>
                {(t.members || []).length === 0 && <div className="muted" style={{ fontSize: 12 }}>로스터 없음</div>}
                {(t.members || []).map((m, i) => {
                  const k = normG(m.game_name); const has = allP.find((pp) => pp.key === k);
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderTop: '1px solid #23232b', fontSize: 13, cursor: has ? 'pointer' : 'default' }} onClick={() => { if (has) { setSelTeam(null); setSel(k); } }}>
                      <span className="muted" style={{ width: 34 }}>{POS_KR[m.role] || ''}</span>
                      <b style={{ flex: 1 }}>{m.game_name}</b>
                      {m.tier && <span className="muted" style={{ fontSize: 11 }}>{TIER_LABEL[m.tier] || m.tier}</span>}
                      {has && <span className="accent" style={{ fontSize: 11 }}>{has.g}경기 {Math.round(has.w / has.g * 100)}%</span>}
                    </div>
                  );
                })}
                <button className="btn" style={{ marginTop: 14, width: '100%' }} onClick={() => { setTeamPage(selTeam); setSelTeam(null); }}>팀 상세보기 →</button>
              </div>
            </div>
          </div>
        );
      })()}

      {teamPage && (() => {
        const t = teams.find((x) => x.id === teamPage);
        if (!t) return null;
        const ts = aggregateTeams(games, teams, rmap).find((x) => x.id === teamPage);
        const tPlayers = aggregatePlayers(games, rmap).filter((p) => p.teamId === teamPage).sort((a, b) => (b.w / (b.g || 1)) - (a.w / (a.g || 1)) || b.g - a.g);
        const tGames = games.filter((g) => (g.participants || []).some((p) => rmap[pKey(p)]?.id === teamPage));
        return (
          <div className="panel">
            <button className="mini" onClick={() => setTeamPage(null)}>← 통계</button>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginTop: 10, flexWrap: 'wrap' }}>
              <h2 style={{ margin: 0 }}>🛡 {t.name}</h2>
              {ts && <span className="muted">{ts.g}경기 · <b className="accent">{Math.round(ts.w / ts.g * 100)}%</b> ({ts.w}승 {ts.g - ts.w}패) · KDA {ts.k}/{ts.d}/{ts.a} · 골드/경기 {kfmt(ts.gold / ts.g)}</span>}
            </div>
            <h3 style={{ margin: '14px 0 4px', fontSize: 14 }}>팀원 통계 <span className="muted" style={{ fontSize: 11.5, fontWeight: 400 }}>· 클릭 → 선수 카드</span></h3>
            <div style={{ overflowX: 'auto' }}><table className="rec-table">
              <thead><tr><th className="l">선수</th><th>경기</th><th>승률</th><th>평균KDA</th><th>평균딜</th><th className="l">모스트</th></tr></thead>
              <tbody>{tPlayers.map((p) => (
                <tr key={p.key} style={{ cursor: 'pointer' }} onClick={() => setSel(p.key)}>
                  <td className="l"><b>{p.name}</b></td><td>{p.g}</td><td>{Math.round(p.w / p.g * 100)}%</td>
                  <td>{r1(p.k / p.g)}/<span className="red">{r1(p.d / p.g)}</span>/{r1(p.a / p.g)}</td><td className="muted">{kfmt(p.dmg / p.g)}</td><td className="l muted">{mostChamp(p.champs)}</td>
                </tr>
              ))}</tbody>
            </table></div>
            <h3 style={{ margin: '16px 0 4px', fontSize: 14 }}>경기 <span className="muted" style={{ fontSize: 11.5, fontWeight: 400 }}>{tGames.length}경기</span></h3>
            {tGames.map((g) => <GameRow key={g.id} g={g} />)}
          </div>
        );
      })()}

      {sel && (() => {
        const pc = tPlayerCardData(sel, games, rmap, teams);
        return pc ? <PlayerCard player={pc.player} detail={pc.detail} max={pcMax} dd={dd} onClose={() => setSel(null)} historyLabel="전적" showDetailLinks={false} /> : null;
      })()}
    </>
  );
}

// ─── 🏅 점수제 팀 (방장 승인제: 팀 생성 → 합류 신청 → 방장 수락/내보내기 → 확정) ───
function laneTotal(approved) {
  let total = 0;
  approved.forEach((m) => { if (m.role && TABLE[m.tier]) total += tierPts(m.tier, POS.indexOf(m.role)); });
  return Math.round(total * 10) / 10;
}
function ScoreTeams({ teams, pool, S, id, reload, user, login, canManage, t, admin }) {
  const cap = S.scoreCap;
  const recruiting = t.status === 'recruiting';
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [lane, setLane] = useState('');
  const r1 = (n) => Math.round(n * 10) / 10;

  const myPool = user ? pool.find((p) => p.user_id === user.id) : null;
  const allMembers = teams.flatMap((tm) => (tm.members || []).map((m) => ({ ...m, teamName: tm.name })));
  const myApproved = user ? allMembers.find((m) => m.user_id === user.id && m.join_status !== 'requested') : null;
  const myRequest = user ? allMembers.find((m) => m.user_id === user.id && m.join_status === 'requested') : null;
  const iCaptainAny = user && teams.some((tm) => tm.captain_user_id === user.id);
  const canJoin = recruiting && user && myPool && !myPool.sold_to && !myApproved && !iCaptainAny;

  async function act(body) {
    setBusy(true);
    try {
      const r = await apiFetch(`/api/tournaments/${id}/score`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((x) => x.json());
      if (!r.ok) { alert('실패: ' + r.error); return; }
      reload();
    } finally { setBusy(false); }
  }
  const approvedTeams = teams.filter((tm) => tm.status === 'approved').length;

  return (
    <div className="panel">
      <h2>🧑‍🤝‍🧑 팀 목록 <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>· 방장이 팀 생성 → 합류 신청 → 방장 수락 (동의한 사람만 팀에 들어가요)</span></h2>

      {myRequest && (
        <div style={{ background: 'rgba(207,174,111,.1)', border: '1px solid rgba(207,174,111,.3)', borderRadius: 8, padding: '8px 12px', margin: '10px 0', display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
          <span>⏳ <b>{myRequest.teamName}</b> 팀 · {POS_KR[myRequest.role] || myRequest.role} 합류 신청 대기 중</span>
          <button className="mini" style={{ marginLeft: 'auto' }} disabled={busy} onClick={() => act({ action: 'cancel', memberId: myRequest.id })}>신청 취소</button>
        </div>
      )}

      {teams.length === 0 && <div className="muted" style={{ marginTop: 10 }}>아직 만들어진 팀이 없어요. {recruiting ? '아래에서 팀을 만들어보세요.' : ''}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12, marginTop: 10 }}>
        {teams.map((tm) => {
          const members = tm.members || [];
          const approved = members.filter((m) => m.join_status !== 'requested');
          const requests = members.filter((m) => m.join_status === 'requested');
          const laneOf = Object.fromEntries(approved.map((m) => [m.role, m]));
          const total = laneTotal(approved);
          const isCap = user && tm.captain_user_id === user.id;
          const canCap = isCap || canManage;
          const confirmed = tm.status === 'approved';
          const full = approved.length === 5 && new Set(approved.map((m) => m.role)).size === 5;
          const over = total > cap;
          return (
            <div key={tm.id} className="tg-group" style={{ padding: '11px 13px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <b style={{ fontSize: 14 }}>{tm.name}</b>
                {confirmed ? <span className="accent" style={{ fontSize: 11 }}>✅ 확정</span> : <span className="muted" style={{ fontSize: 11 }}>모집중</span>}
                <span style={{ marginLeft: 'auto', fontWeight: 800 }} className={over ? 'sf-over' : 'sf-ok'}>{total}</span>
                <span className="muted" style={{ fontSize: 11 }}>/ {cap}</span>
              </div>
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {POS.map((l) => {
                  const m = laneOf[l];
                  return (
                    <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, padding: '3px 0', borderBottom: '1px solid #23232b' }}>
                      <span className="muted" style={{ width: 30, fontSize: 11 }}>{POS_KR[l]}</span>
                      {m ? (
                        <>
                          <span>{m.game_name}{m.user_id === tm.captain_user_id ? ' 👑' : ''}</span>
                          <span className={tierClass(m.tier)} style={{ fontSize: 10.5, marginLeft: 4 }}>{m.tier ? (TIER_LABEL[m.tier] || m.tier) : '미확인'}</span>
                          {canCap && recruiting && !confirmed && m.user_id !== tm.captain_user_id && <button className="sf-x" style={{ marginLeft: 'auto' }} disabled={busy} onClick={() => act({ action: 'kick', memberId: m.id })} title="내보내기">×</button>}
                        </>
                      ) : (
                        <>
                          <span className="muted" style={{ fontSize: 11 }}>비어있음</span>
                          {canJoin && !confirmed && <button className="mini" style={{ marginLeft: 'auto', padding: '1px 7px', fontSize: 10.5 }} disabled={busy} onClick={() => act({ action: 'request', teamId: tm.id, lane: l })}>합류 신청</button>}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>

              {canCap && requests.length > 0 && !confirmed && (
                <div style={{ marginTop: 8, paddingTop: 6, borderTop: '1px solid #2a2a33' }}>
                  <div className="muted" style={{ fontSize: 11, marginBottom: 4 }}>합류 신청 {requests.length}건</div>
                  {requests.map((rq) => (
                    <div key={rq.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '2px 0' }}>
                      <span>{POS_KR[rq.role] || rq.role} · {rq.game_name}</span>
                      <span className={tierClass(rq.tier)} style={{ fontSize: 10 }}>{rq.tier ? (TIER_LABEL[rq.tier] || rq.tier) : '미확인'}</span>
                      <span style={{ marginLeft: 'auto', display: 'flex', gap: 3 }}>
                        <button className="mini" style={{ padding: '1px 6px', fontSize: 10 }} disabled={busy} onClick={() => act({ action: 'resolve', memberId: rq.id, decision: 'approve' })}>수락</button>
                        <button className="mini" style={{ padding: '1px 6px', fontSize: 10 }} disabled={busy} onClick={() => act({ action: 'resolve', memberId: rq.id, decision: 'reject' })}>거절</button>
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {canCap && !confirmed && (
                <div style={{ display: 'flex', gap: 6, marginTop: 9 }}>
                  <button className="btn" style={{ flex: 1, padding: '5px 0', fontSize: 12 }} disabled={busy || !full || over} title={!full ? '5라인을 다 채워야 해요' : over ? '상한 초과' : ''} onClick={() => act({ action: 'submit', teamId: tm.id })}>팀 확정</button>
                  <button className="mini" disabled={busy} onClick={() => { if (confirm(`${tm.name} 팀을 해체할까요?`)) act({ action: 'disband', teamId: tm.id }); }}>해체</button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 팀 만들기 / 로그인·신청 안내 */}
      {recruiting && (
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid #23232b' }}>
          {!user ? (
            <div className="muted" style={{ fontSize: 13 }}>팀을 만들려면 <button className="mini" onClick={login}><span className="gg">G</span> 로그인</button> 후 선수 신청을 먼저 해주세요.</div>
          ) : !myPool ? (
            <div className="muted" style={{ fontSize: 13 }}>먼저 위에서 <b>선수 신청</b>을 하면 팀을 만들거나 합류할 수 있어요.</div>
          ) : myApproved ? (
            <div className="muted" style={{ fontSize: 13 }}>이미 <b>{myApproved.teamName}</b> 팀에 속해 있어요.</div>
          ) : iCaptainAny ? (
            <div className="muted" style={{ fontSize: 13 }}>내 팀을 운영 중이에요. 합류 신청을 수락해 5명을 채우세요.</div>
          ) : (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>➕ 내 팀 만들기</span>
              <input placeholder="팀 이름" value={name} onChange={(e) => setName(e.target.value)} style={{ ...inp, width: 150 }} />
              <select value={lane} onChange={(e) => setLane(e.target.value)} style={{ ...inp, width: 110 }}><option value="">내 라인</option>{POS.map((l) => <option key={l} value={l}>{POS_KR[l]}</option>)}</select>
              <button className="btn" disabled={busy || !name.trim() || !lane} onClick={() => { act({ action: 'create', name, lane }); setName(''); setLane(''); }}>만들기</button>
            </div>
          )}
        </div>
      )}

      {canManage && recruiting && (
        <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid #23232b' }}>
          <button className="btn" disabled={busy || approvedTeams < 2} title={approvedTeams < 2 ? '확정된 팀이 2팀 이상이어야 해요' : ''} onClick={() => { if (confirm(`확정 ${approvedTeams}팀으로 대진을 생성할까요? (모집 마감)`)) admin({}, '/bracket', 'POST'); }}>⚔️ 대진 생성 (확정 {approvedTeams}팀)</button>
        </div>
      )}
    </div>
  );
}

// 대진 결과 → 최종 순위 (우승/준우승/3위). 더블엘리=GF+패자조결승패자, 그 외=결승+준결승패자
function computePlacements(matches) {
  const de = matches.some((m) => m.bracket === 'GF');
  const hasK = matches.some((m) => m.bracket === 'K');
  const loserOf = (m) => (m.winner === m.team_a ? m.team_b : m.team_a);
  let finalMatch; const third = [];
  if (de) {
    finalMatch = matches.find((m) => m.bracket === 'GF');
    const lb = matches.filter((m) => m.bracket === 'L');
    if (lb.length) { const lbFinal = lb.find((m) => m.round === Math.max(...lb.map((x) => x.round))); if (lbFinal?.winner) third.push(loserOf(lbFinal)); }
  } else {
    const seg = matches.filter((m) => (hasK ? m.bracket === 'K' : m.bracket == null));
    if (!seg.length) return null;
    const maxR = Math.max(...seg.map((m) => m.round));
    finalMatch = seg.find((m) => m.round === maxR);
    // 3위전(bracket 'T')이 있으면 그 승자, 없으면 준결승 패자들(공동)
    const tp = matches.find((m) => m.bracket === 'T' && m.winner);
    if (tp) third.push(tp.winner);
    else seg.filter((m) => m.round === maxR - 1 && m.winner).forEach((m) => third.push(loserOf(m)));
  }
  if (!finalMatch?.winner) return null;
  return { champ: finalMatch.winner, runner: loserOf(finalMatch), third: third.filter(Boolean) };
}

function Placements({ matches, nameOf }) {
  const p = computePlacements(matches);
  if (!p) return null;
  return (
    <div className="panel" style={{ textAlign: 'center' }}>
      <h2 style={{ textAlign: 'left' }}>🏆 최종 순위</h2>
      <div className="pl-podium">
        <div className="pl-col pl-2"><div className="pl-bar">🥈</div><b>{nameOf(p.runner)}</b><div className="muted" style={{ fontSize: 12 }}>준우승</div></div>
        <div className="pl-col pl-1"><div className="pl-bar">🥇</div><b style={{ fontSize: 17 }}>{nameOf(p.champ)}</b><div className="muted" style={{ fontSize: 12 }}>우승</div></div>
        <div className="pl-col pl-3"><div className="pl-bar">🥉</div><b>{p.third.length ? p.third.map(nameOf).join(' · ') : '-'}</b><div className="muted" style={{ fontSize: 12 }}>3위</div></div>
      </div>
    </div>
  );
}

// ─── 🏅 점수표 (점수제 팀 구성 전용) ───
function Scoreboard({ teams, pool, S, id, reload, user, login, canManage, t, admin }) {
  if (S.teamFormation !== 'score') return <div className="panel center muted" style={{ padding: '32px 0' }}>점수제 대회에서 팀 짜기·점수를 보는 탭이에요.</div>;
  return (
    <>
      <ScoreTeams teams={teams} pool={pool} S={S} id={id} reload={reload} user={user} login={login} canManage={canManage} t={t} admin={admin} />
      {t.status === 'recruiting' && <ScoreFormation pool={pool} S={S} id={id} reload={reload} user={user} login={login} canManage={canManage} />}
    </>
  );
}

// ─── 🗓 일정·결과 (전체 일정 + 대진 + 최종순위) ───
function Schedule({ t, matches, teams, nameOf, canManage, admin, S }) {
  const podium = t.status === 'done' ? <Placements matches={matches} nameOf={nameOf} /> : null;
  const tPanel = matches.some((m) => m.bracket === 'T')
    ? <BracketView matches={matches.filter((m) => m.bracket === 'T')} title="🥉 3·4위전" t={t} nameOf={nameOf} canManage={canManage} admin={admin} bestOf={S.bestOf} roundLabel={() => '3·4위전'} />
    : null;
  // 운영 도구: 진행 중 대진 취소 → 모집중 (테스트/정정용)
  const adminBar = canManage && matches.length > 0 ? (
    <div className="panel" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '10px 14px' }}>
      <span className="muted" style={{ fontSize: 12.5 }}>🛠 운영 도구 {t.status === 'done' ? '(종료된 대회)' : ''}</span>
      <button className="mini" style={{ marginLeft: 'auto', color: '#e06a78', borderColor: 'rgba(224,106,120,.4)' }} onClick={() => { if (confirm('진행 중인 대진을 취소하고 모집중으로 되돌릴까요?\n\n대진(경기·결과)이 모두 삭제돼요. 팀·신청자는 유지됩니다. (테스트/정정용)')) admin({}, '/bracket', 'DELETE'); }}>🔄 대진 취소 (모집중으로)</button>
    </div>
  ) : null;
  if (matches.length === 0) {
    const approved = teams.filter((x) => x.status === 'approved');
    const dePow2 = S.format !== 'double_elim' || [4, 8, 16, 32].includes(approved.length);
    return (
      <div className="panel">
        <h2>참가팀 <span className="muted" style={{ fontSize: 13, fontWeight: 400 }}>{approved.length}팀 · {FORMAT_LABEL[S.format]} · 시드 {SEED_LABEL[S.seeding]}</span></h2>
        {approved.length === 0 && <div className="muted" style={{ marginTop: 8 }}>아직 승인된 팀이 없어요. (신청 탭에서 팀 승인)</div>}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8, marginTop: 10 }}>
          {approved.map((tm, i) => (
            <div key={tm.id} className="tg-group" style={{ padding: '8px 11px' }}>
              <b>{i + 1}. {tm.name}</b>
              <div className="muted" style={{ fontSize: 11, marginTop: 3 }}>{(tm.members || []).map((m) => m.game_name).join(', ') || '로스터 미정'}</div>
            </div>
          ))}
        </div>
        {canManage && (
          <>
            <button className="btn" style={{ marginTop: 14 }} disabled={approved.length < 2 || !dePow2} onClick={() => { if (confirm(`${approved.length}팀으로 ${FORMAT_LABEL[S.format]} 대진을 생성할까요? (자동 분배)`)) admin({}, '/bracket', 'POST'); }}>⚔️ 대진 생성 ({approved.length}팀)</button>
            {!dePow2 && <div style={{ fontSize: 12, marginTop: 6, color: '#d0a56f' }}>⚠️ 더블 엘리는 4·8·16·32팀일 때만 생성돼요.</div>}
          </>
        )}
      </div>
    );
  }
  const groupM = matches.filter((m) => m.bracket === 'G');
  const kM = matches.filter((m) => m.bracket === 'K');
  const wM = matches.filter((m) => m.bracket === 'W');
  if (wM.length > 0) return <>{adminBar}{podium}<DoubleElimBoard matches={matches} t={t} nameOf={nameOf} canManage={canManage} admin={admin} bestOf={S.bestOf} bestOfFinal={S.bestOfFinal} finalRounds={S.bestOfFinalRounds} /></>;
  if (groupM.length === 0) return <>{adminBar}{podium}<BracketView matches={matches.filter((m) => m.bracket !== 'T')} title="대진표" t={t} nameOf={nameOf} canManage={canManage} admin={admin} bestOf={S.bestOf} bestOfFinal={S.bestOfFinal} finalRounds={S.bestOfFinalRounds} />{tPanel}</>;

  // 그룹 스테이지 모드
  const gmap = {};
  groupM.forEach((x) => { (gmap[x.grp] = gmap[x.grp] || new Set()); if (x.team_a) gmap[x.grp].add(x.team_a); if (x.team_b) gmap[x.grp].add(x.team_b); });
  const groups = Object.keys(gmap).sort((a, b) => a - b).map((gi) => [...gmap[gi]]);
  const standings = groupStandings(matches, groups);
  const advance = S.groups.advance;
  return (
    <>
      {adminBar}
      {podium}
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
        ? <BracketView matches={kM} title="본선 대진표" t={t} nameOf={nameOf} canManage={canManage} admin={admin} bestOf={S.bestOf} bestOfFinal={S.bestOfFinal} finalRounds={S.bestOfFinalRounds} />
        : <div className="panel center muted" style={{ padding: '24px 0' }}>조별 경기가 모두 끝나면 본선 대진이 자동으로 생성돼요.</div>}
      {tPanel}
    </>
  );
}

// 더블 엘리: 승자조·패자조·최종결승 3단
function DoubleElimBoard({ matches, t, nameOf, canManage, admin, bestOf = 1, bestOfFinal = 1, finalRounds = 0 }) {
  const W = matches.filter((m) => m.bracket === 'W');
  const L = matches.filter((m) => m.bracket === 'L');
  const GF = matches.filter((m) => m.bracket === 'GF');
  return (
    <>
      <BracketView matches={W} title="🏆 승자조" t={t} nameOf={nameOf} canManage={canManage} admin={admin} bestOf={bestOf} bestOfFinal={bestOfFinal} finalRounds={finalRounds}
        roundLabel={(r, tot) => (r === tot ? '승자조 결승' : `${2 ** (tot - r + 1)}강`)} />
      <BracketView matches={L} title="💀 패자조" t={t} nameOf={nameOf} canManage={canManage} admin={admin} bestOf={bestOf} bestOfFinal={bestOfFinal} finalRounds={finalRounds}
        roundLabel={(r, tot) => (r === tot ? '패자조 결승' : `패자조 R${r}`)} />
      <BracketView matches={GF} title="👑 최종 결승" t={t} nameOf={nameOf} canManage={canManage} admin={admin} bestOf={bestOfFinal !== bestOf && finalRounds > 0 ? bestOfFinal : bestOf}
        roundLabel={() => '최종 결승'} />
    </>
  );
}

// 싱글엘리/본선/각 브라켓 공용 렌더
// BO 시리즈 가능한 스코어라인 (a=team_a 승수)
function serieLines(bestOf) {
  const w = Math.ceil((bestOf || 1) / 2);
  const lines = [];
  for (let l = 0; l < w; l += 1) lines.push({ a: w, b: l, side: 'a' });   // 2:0, 2:1 …
  for (let l = w - 1; l >= 0; l -= 1) lines.push({ a: l, b: w, side: 'b' }); // 1:2, 0:2 …
  return lines;
}

function BracketView({ matches, title, t, nameOf, canManage, admin, roundLabel, bestOf = 1, bestOfFinal = 1, finalRounds = 0 }) {
  const totalRounds = Math.max(...matches.map((m) => m.round));
  const rl = roundLabel || ((round) => (round === totalRounds ? '결승' : `${2 ** (totalRounds - round + 1)}강`));
  // 후반 라운드(결승 등)는 결승 BO 적용, 나머지는 기본 BO
  const boFor = (round) => (finalRounds > 0 && round > totalRounds - finalRounds ? bestOfFinal : bestOf);
  const hasEscalation = finalRounds > 0 && bestOfFinal !== bestOf;
  const schedulable = (m) => canManage && t.status === 'running' && m.team_a && m.team_b && !m.winner;
  return (
    <div className="panel" style={{ overflowX: 'auto' }}>
      <h2>{title}{bestOf > 1 || hasEscalation ? <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}> · BO{bestOf}{hasEscalation ? ` (후반 BO${bestOfFinal})` : ''}</span> : null}</h2>
      <div style={{ display: 'flex', gap: 24, minWidth: 'min-content', paddingBottom: 8 }}>
        {Array.from({ length: totalRounds }, (_, r) => r + 1).map((round) => {
          const rbo = boFor(round);
          const lines = serieLines(rbo);
          return (
            <div key={round} style={{ display: 'flex', flexDirection: 'column', gap: 10, justifyContent: 'space-around', minWidth: 168 }}>
              <div className="muted" style={{ fontSize: 11, textAlign: 'center' }}>{rl(round, totalRounds)}{rbo > 1 ? ` · BO${rbo}` : ''}</div>
              {matches.filter((m) => m.round === round).sort((a, b) => a.pos - b.pos).map((m) => {
                const ready = canManage && t.status === 'running' && !m.winner && m.team_a && m.team_b;
                return (
                  <div key={m.id} style={{ border: '1px solid #33333c', borderRadius: 8, background: '#1c1c22' }}>
                    {[m.team_a, m.team_b].map((tid, k) => (
                      <div key={k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6, padding: '5px 9px', borderTop: k ? '1px solid #2a2a33' : 'none', background: m.winner === tid && tid ? 'rgba(79,182,214,.18)' : 'transparent', fontWeight: m.winner === tid ? 700 : 400, borderRadius: 6 }}>
                        <span style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tid ? nameOf(tid) : <span className="muted">미정</span>}</span>
                        {m.winner && m.score_a != null && <span className="muted" style={{ fontSize: 12, fontWeight: 700 }}>{k === 0 ? m.score_a : m.score_b}</span>}
                        {ready && rbo === 1 && <button className="mini" style={{ padding: '1px 7px', fontSize: 10 }} onClick={() => admin({ matchId: m.id, winner: tid }, '/bracket', 'PATCH')}>승</button>}
                      </div>
                    ))}
                    {ready && rbo > 1 && (
                      <div style={{ padding: '4px 8px', borderTop: '1px solid #2a2a33' }}>
                        <select defaultValue="" onChange={(e) => { if (e.target.value === '') return; const l = lines[+e.target.value]; admin({ matchId: m.id, winner: l.side === 'a' ? m.team_a : m.team_b, score_a: l.a, score_b: l.b }, '/bracket', 'PATCH'); }} style={{ ...inp, width: '100%', fontSize: 11.5 }}>
                          <option value="">결과 입력 (위:아래)</option>
                          {lines.map((l, idx) => <option key={idx} value={idx}>{l.a} : {l.b}</option>)}
                        </select>
                      </div>
                    )}
                    {(m.scheduled_at || schedulable(m)) && (
                      <div className="bv-sched-row">
                        {m.scheduled_at && <span className="bv-sched">🗓 {fmtSched(m.scheduled_at)}</span>}
                        {schedulable(m) && <input type="datetime-local" value={toLocalInput(m.scheduled_at)} onChange={(e) => admin({ matchId: m.id, action: 'schedule', scheduledAt: e.target.value ? new Date(e.target.value).toISOString() : null }, '/bracket', 'PATCH')} className="bv-schedinput" />}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      {canManage && t.status === 'running' && <p className="hint" style={{ marginTop: 8 }}>{bestOf > 1 || hasEscalation ? '스코어 선택(위팀:아래팀) → 다음 라운드 자동 진출.' : '이긴 팀 승 버튼 → 다음 라운드 자동 진출.'}</p>}
    </div>
  );
}
