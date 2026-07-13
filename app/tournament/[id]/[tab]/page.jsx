'use client';
import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { useGroup } from '../../../../components/GroupProvider.jsx';
import { apiFetch } from '../../../../components/api.js';
import { normalizeSettings } from '../../../../src/tournament-settings.js';
import { TIER_ORDER, TIER_LABEL } from '../../../../src/table.js';

const LANES = ['top', 'jungle', 'mid', 'adc', 'sup'];
const STLABEL = { recruiting: '🟢 팀 모집중', running: '🔵 진행중', done: '🏁 종료' };
const TST = { pending: '⏳대기', approved: '✅승인', rejected: '❌거절', eliminated: '💀탈락' };
const inp = { background: '#26262e', color: '#ddd', border: '1px solid #33333c', borderRadius: 6, padding: '6px 10px', fontSize: 13 };
const emptyRoster = (n) => Array.from({ length: n }, () => ({ name: '', tier: '', role: '' }));
const FORMAT_LABEL = { single_elim: '싱글 엘리미네이션', double_elim: '더블 엘리미네이션', group_stage: '그룹 스테이지(예선)' };
const SEED_LABEL = { order: '신청 순서', tier: '티어 시드(강팀 분산)', random: '랜덤 추첨' };

export default function TournamentTab() {
  const { id, tab } = useParams();
  const { user, isAdmin } = useGroup() || {};
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);

  const load = useCallback(() => { if (id) fetch('/api/tournaments/' + id).then((x) => x.json()).then((r) => { if (r.ok) setData(r); else setErr(r.error); }); }, [id]);
  useEffect(load, [load]);

  const t = data?.tournament;
  const teams = data?.teams || [];
  const matches = data?.matches || [];
  const nameOf = (tid) => teams.find((x) => x.id === tid)?.name || '?';
  const canManage = !!user && !!t && (user.id === t.owner_id || isAdmin);

  async function admin(body, path = '/teams', method = 'PATCH') {
    const r = await apiFetch('/api/tournaments/' + id + path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((x) => x.json());
    if (!r.ok) { alert('실패: ' + r.error); return; }
    if (r.tournament) setData(r); else load();
  }

  if (!t) return <div className="panel center muted">{err || '불러오는 중…'}</div>;

  const S = normalizeSettings(t.settings);
  const shared = { t, teams, matches, nameOf, canManage, admin, id, reload: load, S };
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
      {canManage && t.status === 'recruiting' && <SettingsEditor t={t} S={S} admin={admin} />}
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
          로스터 {el.rosterMin}~{el.rosterMax}명 · 티어 {el.tierCap ? TIER_LABEL[el.tierCap] : '무제한'}~{el.tierFloor ? TIER_LABEL[el.tierFloor] : '무제한'}
          {el.minLevel > 0 ? ` · 최소 ${el.minLevel}레벨` : ''} · {FORMAT_LABEL[d.format]} · 시드 {SEED_LABEL[d.seeding]}{d.bestOf > 1 ? ` · BO${d.bestOf}` : ''}
        </div>
      ) : (
        <div style={{ marginTop: 12, display: 'grid', gap: 14 }}>
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: '#cfae6f', marginBottom: 7 }}>📋 참가 자격</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10 }}>
              <div style={cell}><label style={lbl}>로스터 최소</label><input type="number" min={1} max={10} value={el.rosterMin} onChange={(e) => setEl('rosterMin', +e.target.value)} style={inp} /></div>
              <div style={cell}><label style={lbl}>로스터 최대</label><input type="number" min={1} max={10} value={el.rosterMax} onChange={(e) => setEl('rosterMax', +e.target.value)} style={inp} /></div>
              <div style={cell}><label style={lbl}>최소 레벨</label><input type="number" min={0} value={el.minLevel} onChange={(e) => setEl('minLevel', +e.target.value)} style={inp} placeholder="0=제한없음" /></div>
              <div style={cell}><label style={lbl}>티어 상한(이하)</label><select value={el.tierCap || ''} onChange={(e) => setEl('tierCap', e.target.value || null)} style={inp}>{tierOpts}</select></div>
              <div style={cell}><label style={lbl}>티어 하한(이상)</label><select value={el.tierFloor || ''} onChange={(e) => setEl('tierFloor', e.target.value || null)} style={inp}>{tierOpts}</select></div>
            </div>
          </div>
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: '#cfae6f', marginBottom: 7 }}>🏆 대회 방식</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10 }}>
              <div style={cell}><label style={lbl}>대진 방식</label>
                <select value={d.format} onChange={(e) => setD((x) => ({ ...x, format: e.target.value }))} style={inp}>
                  <option value="single_elim">싱글 엘리미네이션</option>
                  <option value="double_elim" disabled>더블 엘리 (준비 중)</option>
                  <option value="group_stage" disabled>그룹 스테이지 (준비 중)</option>
                </select>
              </div>
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
              <div style={cell}><label style={lbl}>팀 구성</label>
                <select value={d.teamFormation} onChange={(e) => setD((x) => ({ ...x, teamFormation: e.target.value }))} style={inp}>
                  <option value="roster">직접 로스터 신청</option>
                  <option value="auction" disabled>경매 드래프트 (준비 중)</option>
                </select>
              </div>
            </div>
          </div>
          <button className="btn" disabled={busy} onClick={save} style={{ justifySelf: 'start' }}>저장</button>
        </div>
      )}
    </div>
  );
}

// ─── 📝 신청 ───
function Apply({ t, teams, canManage, admin, id, reload, S }) {
  const [teamName, setTeamName] = useState('');
  const [captain, setCaptain] = useState('');
  const [roster, setRoster] = useState(emptyRoster(5));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const approved = teams.filter((x) => x.status === 'approved');

  async function measure(i) {
    const [gn, tg] = (roster[i].name || '').trim().split('#');
    if (!tg) { setRoster((r) => r.map((x, idx) => idx === i ? { ...x, tier: '#태그 필요' } : x)); return; }
    setRoster((r) => r.map((x, idx) => idx === i ? { ...x, tier: '…' } : x));
    const prof = await fetch(`/api/seed?name=${encodeURIComponent(gn.trim())}&tag=${encodeURIComponent(tg.trim())}&region=NA`).then((x) => x.json()).catch(() => ({}));
    setRoster((r) => r.map((x, idx) => idx === i ? { ...x, tier: prof.found ? (prof.suggestedTier || '?') : '못찾음' } : x));
  }
  async function apply() {
    setBusy(true); setErr(null);
    try {
      const members = roster.filter((m) => m.name.trim()).map((m) => { const [gn, tg] = m.name.split('#'); return { game_name: (gn || '').trim(), tag_line: (tg || '').trim(), tier: m.tier, role: m.role || null }; });
      const r = await fetch('/api/tournaments/' + id + '/teams', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: teamName, captain, members }) }).then((x) => x.json());
      if (!r.ok) throw new Error(r.error);
      setTeamName(''); setCaptain(''); setRoster(emptyRoster(5)); reload();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <>
      {t.status === 'recruiting' && (
        <div className="panel">
          <h2>📝 팀 신청</h2>
          <div style={{ background: 'rgba(207,174,111,.08)', border: '1px solid rgba(207,174,111,.25)', borderRadius: 8, padding: '8px 12px', fontSize: 12.5, color: '#d8c48f', marginBottom: 12 }}>
            📋 참가 자격 — 로스터 <b>{S.eligibility.rosterMin}~{S.eligibility.rosterMax}명</b>
            {(S.eligibility.tierCap || S.eligibility.tierFloor) ? <> · 티어 <b>{S.eligibility.tierCap ? TIER_LABEL[S.eligibility.tierCap] : '무제한'} ~ {S.eligibility.tierFloor ? TIER_LABEL[S.eligibility.tierFloor] : '무제한'}</b></> : ' · 티어 제한 없음'}
            {S.eligibility.minLevel > 0 ? <> · 최소 <b>{S.eligibility.minLevel}레벨</b></> : ''}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            <input placeholder="팀 이름" value={teamName} onChange={(e) => setTeamName(e.target.value)} style={{ ...inp, flex: 1, minWidth: 140 }} />
            <input placeholder="주장 (디코 등)" value={captain} onChange={(e) => setCaptain(e.target.value)} style={inp} />
          </div>
          {roster.map((m, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 5 }}>
              <span className="muted" style={{ width: 14 }}>{i + 1}</span>
              <input placeholder="게임닉#태그" value={m.name} onChange={(e) => setRoster((r) => r.map((x, idx) => idx === i ? { ...x, name: e.target.value } : x))} style={{ ...inp, flex: 1 }} />
              <button className="mini" type="button" onClick={() => measure(i)}>🔎</button>
              <span className="muted" style={{ width: 66, fontSize: 12 }}>{m.tier}</span>
              <select value={m.role} onChange={(e) => setRoster((r) => r.map((x, idx) => idx === i ? { ...x, role: e.target.value } : x))} style={{ ...inp, width: 78 }}>
                <option value="">라인</option>{LANES.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </div>
          ))}
          <button className="btn" disabled={busy || !teamName.trim()} onClick={apply} style={{ marginTop: 8 }}>신청하기</button>
          {err && <div className="err">{err}</div>}
        </div>
      )}
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

// ─── 🏅 점수표 (브라켓) ───
function Scoreboard({ t, matches, nameOf, canManage, admin }) {
  if (matches.length === 0) return <div className="panel center muted" style={{ padding: '40px 0' }}>아직 대진이 생성되지 않았어요. (신청 탭에서 대진 생성)</div>;
  const totalRounds = Math.max(...matches.map((m) => m.round));
  const roundLabel = (round) => round === totalRounds ? '결승' : `${2 ** (totalRounds - round + 1)}강`;
  return (
    <div className="panel" style={{ overflowX: 'auto' }}>
      <h2>대진표</h2>
      <div style={{ display: 'flex', gap: 24, minWidth: 'min-content', paddingBottom: 8 }}>
        {Array.from({ length: totalRounds }, (_, r) => r + 1).map((round) => (
          <div key={round} style={{ display: 'flex', flexDirection: 'column', gap: 10, justifyContent: 'space-around', minWidth: 160 }}>
            <div className="muted" style={{ fontSize: 11, textAlign: 'center' }}>{roundLabel(round)}</div>
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
