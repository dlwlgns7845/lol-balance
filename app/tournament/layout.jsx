'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useGroup } from '../../components/GroupProvider.jsx';
import { apiFetch } from '../../components/api.js';

const TABS = [['notice', '📢 공지'], ['apply', '📝 신청'], ['stats', '📊 통계'], ['scrim', '🎯 스크림'], ['scoreboard', '🏅 점수표']];
const ST = { recruiting: '🟢', running: '🔵', done: '🏁' };
const sInp = { background: '#26262e', color: '#ddd', border: '1px solid #33333c', borderRadius: 6, padding: '5px 8px', fontSize: 12.5 };

export default function TournamentLayout({ children }) {
  const { user, login, logout } = useGroup() || {};
  const path = usePathname() || '';
  const parts = path.split('/').filter(Boolean); // ['tournament', id?, tab?]
  const selId = parts[1] || null;
  const tab = parts[2] || 'notice';
  const [list, setList] = useState([]);
  const [name, setName] = useState('');
  const [maxTeams, setMaxTeams] = useState(8);
  const [busy, setBusy] = useState(false);

  const load = () => fetch('/api/tournaments').then((x) => x.json()).then((r) => r.ok && setList(r.tournaments || []));
  useEffect(() => { load(); }, [path]);

  async function create() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const r = await apiFetch('/api/tournaments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, max_teams: maxTeams }) }).then((x) => x.json());
      if (r.ok) { setName(''); window.location.href = '/tournament/' + r.tournament.id + '/notice'; }
      else alert('실패: ' + r.error);
    } finally { setBusy(false); }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="tb-brand">
          <a href="/" style={{ textDecoration: 'none', color: 'inherit', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="tb-logo" style={{ display: 'grid', placeItems: 'center', fontSize: 20, background: 'transparent' }}>🏆</span>
            <div className="tb-title"><div className="tb-name">멸망전</div><div className="tb-sub">COMMUNITY TOURNAMENT</div></div>
          </a>
        </div>
        <nav className="tb-nav">
          {selId && TABS.map(([k, label]) => (
            <Link key={k} href={`/tournament/${selId}/${k}`} className={tab === k ? 'active' : ''}>{label}</Link>
          ))}
          {selId && user && list.find((x) => x.id === selId)?.settings?.teamFormation === 'auction' && (
            <Link href={`/tournament/${selId}/auction`} className={tab === 'auction' ? 'active' : ''}>🔨 경매</Link>
          )}
          {selId && user && (
            <Link href={`/tournament/${selId}/admin`} className={tab === 'admin' ? 'active' : ''}>⚙️ 관리자</Link>
          )}
        </nav>
        <div className="tb-actions">
          {user
            ? <button className="btn ghost tb-user" onClick={logout} title={(user.email || '') + ' · 로그아웃'}>{(user.user_metadata?.full_name || user.email || '?').slice(0, 1).toUpperCase()}</button>
            : <button className="btn ghost" onClick={login}><span className="gg">G</span> 로그인</button>}
          <a className="btn ghost" href="/" style={{ textDecoration: 'none' }}># 방 입장</a>
        </div>
      </header>

      <div style={{ display: 'flex', minHeight: 'calc(100vh - 56px)' }}>
        <aside style={{ width: 220, flexShrink: 0, borderRight: '1px solid #1e1e26', background: '#0f0f14', padding: '14px 10px' }}>
          <div className="muted" style={{ fontSize: 11, padding: '0 6px 8px', fontWeight: 700 }}>대회 목록</div>
          {list.length === 0 && <div className="muted" style={{ fontSize: 12, padding: 6 }}>아직 없어요</div>}
          {list.map((t) => (
            <Link key={t.id} href={`/tournament/${t.id}/notice`} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px', borderRadius: 7, textDecoration: 'none', color: selId === t.id ? '#fff' : '#bbb', background: selId === t.id ? 'rgba(79,182,214,.15)' : 'transparent', fontWeight: selId === t.id ? 700 : 400, fontSize: 13, marginBottom: 2 }}>
              <span>{ST[t.status] || '·'}</span><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
            </Link>
          ))}
          {user && (
            <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid #1e1e26' }}>
              <div className="muted" style={{ fontSize: 11, padding: '0 6px 6px', fontWeight: 700 }}>+ 새 대회</div>
              <input placeholder="대회 이름" value={name} onChange={(e) => setName(e.target.value)} style={{ width: '100%', ...sInp, marginBottom: 5 }} />
              <select value={maxTeams} onChange={(e) => setMaxTeams(+e.target.value)} style={{ width: '100%', ...sInp, marginBottom: 5 }}>{[4, 8, 16, 32].map((n) => <option key={n} value={n}>{n}팀</option>)}</select>
              <button className="btn" style={{ width: '100%' }} disabled={busy || !name.trim()} onClick={create}>만들기</button>
            </div>
          )}
        </aside>
        <main className="main" style={{ flex: 1 }}><div className="content" style={{ maxWidth: 1320 }}>{children}</div></main>
      </div>
    </div>
  );
}
