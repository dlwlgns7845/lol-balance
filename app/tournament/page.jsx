'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useGroup } from '../../components/GroupProvider.jsx';
import { apiFetch } from '../../components/api.js';

const ST = { recruiting: '🟢 모집중', running: '🔵 진행중', done: '🏁 종료' };
const inp = { background: '#26262e', color: '#ddd', border: '1px solid #33333c', borderRadius: 6, padding: '6px 10px', fontSize: 13 };

export default function TournamentListPage() {
  const { group, isAdmin } = useGroup();
  const gid = group?.id;
  const [list, setList] = useState([]);
  const [name, setName] = useState('');
  const [maxTeams, setMaxTeams] = useState(8);
  const [tierCap, setTierCap] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const load = () => { if (gid) fetch('/api/tournaments?gid=' + gid).then((x) => x.json()).then((r) => r.ok && setList(r.tournaments || [])); };
  useEffect(load, [gid]);

  async function create() {
    setBusy(true); setErr(null);
    try {
      const r = await apiFetch('/api/tournaments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ gid, name, max_teams: maxTeams, tier_cap: tierCap || null }) }).then((x) => x.json());
      if (!r.ok) throw new Error(r.error);
      setName(''); setTierCap(''); load();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="content" style={{ maxWidth: 900 }}>
      <div className="page-head"><div className="title"><h1>🏆 멸망전</h1><p className="sub" style={{ margin: 0 }}>커뮤니티 대회 — 팀 신청·대진·진행 (내전과 별개)</p></div></div>

      {isAdmin && (
        <div className="panel" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <b>➕ 새 대회</b>
          <input placeholder="대회 이름" value={name} onChange={(e) => setName(e.target.value)} style={{ ...inp, flex: 1, minWidth: 160 }} />
          <select value={maxTeams} onChange={(e) => setMaxTeams(+e.target.value)} style={inp}>{[4, 8, 16, 32].map((n) => <option key={n} value={n}>{n}팀</option>)}</select>
          <input placeholder="티어제한(선택, 예 D2)" value={tierCap} onChange={(e) => setTierCap(e.target.value)} style={{ ...inp, width: 150 }} />
          <button className="btn" disabled={busy || !name.trim()} onClick={create}>만들기</button>
          {err && <span className="err">{err}</span>}
        </div>
      )}

      <div style={{ display: 'grid', gap: 10, marginTop: 14 }}>
        {list.length === 0 && <div className="panel center muted">아직 대회가 없어요.{isAdmin ? ' 위에서 만들어보세요.' : ''}</div>}
        {list.map((t) => (
          <Link key={t.id} href={`/tournament/${t.id}`} className="panel" style={{ display: 'flex', alignItems: 'center', gap: 12, textDecoration: 'none' }}>
            <b style={{ fontSize: 16 }}>{t.name}</b>
            <span className="muted">{ST[t.status] || t.status}</span>
            <span className="muted">· {t.approvedTeams}/{t.max_teams}팀{t.tier_cap ? ` · ${t.tier_cap} 이하` : ''}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
