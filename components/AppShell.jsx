'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useGroup } from './GroupProvider.jsx';
import { apiFetch } from './api.js';

const NAV = [
  { href: '/', label: '통계', ic: '📊' },
  { href: '/balancer', label: '밸런서', ic: '⚔️' },
  { href: '/recruit', label: '오늘 내전', ic: '🎮' },
  { href: '/people', label: '멤버 관리', ic: '👥' },
  { href: '/settings', label: '점수표', ic: '⚙️' },
];

export default function AppShell({ children }) {
  const { group, leave, user, canEdit, authOn, isAdmin, login, logout, claim } = useGroup();
  const path = usePathname();
  const nav = isAdmin ? [...NAV, { href: '/admin', label: '관리자', ic: '🛡' }] : NAV;
  const [menu, setMenu] = useState(false);
  // 이 방에 연결된 디코 서버 브랜딩(아이콘·이름). 없으면 기본 로고 유지.
  const [brand, setBrand] = useState(null);
  useEffect(() => {
    if (!group?.id) { setBrand(null); return; }
    let alive = true;
    fetch('/api/room-brand?gid=' + group.id).then((r) => r.json())
      .then((r) => { if (alive && r.ok) setBrand(r.brand); }).catch(() => {});
    return () => { alive = false; };
  }, [group?.id]);

  async function clearTraces() {
    setMenu(false);
    if (!window.confirm('내 로그인 기록(관람 흔적·이메일 노출)을 지우고 로그아웃할까요?\n\n다시 로그인하면 정상적으로 이용할 수 있어요.')) return;
    try { await apiFetch('/api/directory-optout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); } catch { /* 무시 */ }
    if (logout) logout();
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="tb-brand">
          <img src={brand?.icon || '/logo.webp'} alt="로고" className="tb-logo-img"
            onError={(e) => { e.currentTarget.style.display = 'none'; const f = e.currentTarget.parentElement.querySelector('.tb-logo'); if (f) f.style.display = 'grid'; }} />
          <span className="tb-logo" style={{ display: 'none' }}>LoL</span>
          <div className="tb-title">
            <div className="tb-name">{brand?.name ? brand.name : <><span className="accent">내전</span> 밸런스 · 통계</>}</div>
            <div className="tb-sub">{brand?.name ? '내전 밸런스 · 통계' : 'CUSTOM BALANCE · GAME STATS'}</div>
          </div>
        </div>

        <nav className="tb-nav">
          {nav.map((n) => (
            <Link key={n.href} href={n.href} className={path === n.href ? 'active' : ''}>
              <span className="ic">{n.ic}</span>{n.label}
            </Link>
          ))}
        </nav>

        <div className="tb-actions">
          {!canEdit && <span className="tb-view">👀 구경 모드</span>}
          {canEdit && (
            <Link href="/record" className={`btn tb-record${path === '/record' ? ' ghost' : ''}`}>📸 결과 추가</Link>
          )}
          {!group.owner_id && user && (
            <button className="btn ghost tb-claim" onClick={claim} title="이 방(주인 없음)의 방장이 되어 권한을 관리합니다">👑 방장 되기</button>
          )}
          <span className="tb-room">{group.name} <span className="muted">#{group.code}</span></span>
          {authOn && (user ? (
            <div className="tb-usermenu">
              <button className="btn ghost tb-user" onClick={() => setMenu((v) => !v)} title={user.email || ''}>
                {(user.user_metadata?.full_name || user.email || '?').slice(0, 1).toUpperCase()}
              </button>
              {menu && (
                <>
                  <div className="tb-menu-backdrop" onClick={() => setMenu(false)} />
                  <div className="tb-menu">
                    <div className="tb-menu-email">{user.email}</div>
                    <button onClick={() => { setMenu(false); logout && logout(); }}>로그아웃</button>
                    <button className="danger" onClick={clearTraces}>🙈 로그인 기록 삭제 후 로그아웃</button>
                  </div>
                </>
              )}
            </div>
          ) : (
            <button className="btn ghost" onClick={login}><span className="gg">G</span> 로그인</button>
          ))}
          <button className="btn ghost" onClick={leave}># 방 전환</button>
        </div>
      </header>

      <main className="main">
        <div className="content">{children}</div>
      </main>
      <footer className="site-credit">
        티어·전적 데이터 제공: <a href="https://op.gg" target="_blank" rel="noreferrer">OP.GG</a>
      </footer>
    </div>
  );
}
