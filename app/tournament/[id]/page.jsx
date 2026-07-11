'use client';
import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { useGroup } from '../../../components/GroupProvider.jsx';
import { apiFetch } from '../../../components/api.js';

const LANES = ['top', 'jungle', 'mid', 'adc', 'sup'];
const ST = { recruiting: '🟢 팀 모집중', running: '🔵 진행중', done: '🏁 종료' };
const TST = { pending: '⏳대기', approved: '✅승인', rejected: '❌거절', eliminated: '💀탈락' };
const inp = { background: '#26262e', color: '#ddd', border: '1px solid #33333c', borderRadius: 6, padding: '6px 10px', fontSize: 13 };
const emptyRoster = (n) => Array.from({ length: n }, () => ({ name: '', tier: '', role: '' }));

export default function TournamentDetail() {
  const { id } = useParams();
  const { isAdmin } = useGroup();
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [teamName, setTeamName] = useState('');
  const [captain, setCaptain] = useState('');
  const [roster, setRoster] = useState(emptyRoster(5));
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => { if (id) fetch('/api/tournaments/' + id).then((x) => x.json()).then((r) => { if (r.ok) setData(r); else setErr(r.error); }); }, [id]);
  useEffect(load, [load]);

  const t = data?.tournament;
  const teams = data?.teams || [];
  const matches = data?.matches || [];
  const approved = teams.filter((x) => x.status === 'approved');
  const nameOf = (tid) => teams.find((x) => x.id === tid)?.name || '?';

  async function measure(i) {
    const raw = (roster[i].name || '').trim();
    const [gn, tg] = raw.split('#');
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
      setTeamName(''); setCaptain(''); setRoster(emptyRoster(5)); load();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  async function admin(body, path = '/teams', method = 'PATCH') {
    const r = await apiFetch('/api/tournaments/' + id + path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((x) => x.json());
    if (!r.ok) { alert('실패: ' + r.error); return; }
    if (r.tournament) setData(r); else load();
  }

  if (!t) return <div className="content"><div className="panel center muted">{err || '불러오는 중…'}</div></div>;

  const totalRounds = matches.length ? Math.max(...matches.map((m) => m.round)) : 0;
  const champion = t.status === 'done' ? matches.find((m) => m.round === totalRounds)?.winner : null;
  const roundLabel = (round) => round === totalRounds ? '결승' : `${2 ** (totalRounds - round + 1)}강`;

  return (
    <div className="content" style={{ maxWidth: 1100 }}>
      <div className="page-head"><div className="title">
        <h1>🏆 {t.name}</h1>
        <p className="sub" style={{ margin: 0 }}>{ST[t.status]} · 싱글 엘리 · 최대 {t.max_teams}팀{t.tier_cap ? ` · ${t.tier_cap} 이하` : ''}</p>
      </div></div>

      {champion && <div className="panel center" style={{ fontSize: 18, borderColor: '#e8c07d' }}>🏆 우승 — <b>{nameOf(champion)}</b></div>}

      {t.status === 'recruiting' && (
        <div className="panel">
          <h2>📝 팀 신청</h2>
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
              {isAdmin && t.status === 'recruiting' && (
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
        {isAdmin && t.status === 'recruiting' && (
          <button className="btn" style={{ marginTop: 12 }} disabled={approved.length < 2} onClick={() => { if (confirm(`승인 ${approved.length}팀으로 대진을 생성할까요? (신청 마감)`)) admin({}, '/bracket', 'POST'); }} title={approved.length < 2 ? '승인 2팀 이상 필요' : ''}>⚔️ 대진 생성 ({approved.length}팀)</button>
        )}
      </div>

      {matches.length > 0 && (
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
                        {isAdmin && t.status === 'running' && tid && !m.winner && m.team_a && m.team_b && (
                          <button className="mini" style={{ padding: '1px 7px', fontSize: 10 }} onClick={() => admin({ matchId: m.id, winner: tid }, '/bracket', 'PATCH')}>승</button>
                        )}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ))}
          </div>
          {isAdmin && t.status === 'running' && <p className="hint" style={{ marginTop: 8 }}>각 경기에서 이긴 팀의 <b>승</b> 버튼을 누르면 다음 라운드로 자동 진출해요.</p>}
        </div>
      )}
    </div>
  );
}
