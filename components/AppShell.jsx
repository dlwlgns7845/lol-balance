'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useGroup } from './GroupProvider.jsx';

const NAV = [
  { href: '/', label: '밸런서', ic: '⚔️' },
  { href: '/recruit', label: '오늘 내전', ic: '🎮' },
  { href: '/stats', label: '통계', ic: '📊' },
  { href: '/player', label: '전적', ic: '📖' },
  { href: '/people', label: '사람 관리', ic: '👥' },
  { href: '/settings', label: '점수표', ic: '⚙️' },
];

export default function AppShell({ children }) {
  const { group, leave, user, canEdit, authOn, isAdmin, login, logout, claim } = useGroup();
  const path = usePathname();
  const nav = isAdmin ? [...NAV, { href: '/admin', label: '관리자', ic: '🛡' }] : NAV;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="tb-brand">
          <img src="/logo.webp" alt="로고" className="tb-logo-img"
            onError={(e) => { e.currentTarget.style.display = 'none'; const f = e.currentTarget.parentElement.querySelector('.tb-logo'); if (f) f.style.display = 'grid'; }} />
          <span className="tb-logo" style={{ display: 'none' }}>LoL</span>
          <div className="tb-title">
            <div className="tb-name"><span className="accent">내전</span> 밸런스 · 통계</div>
            <div className="tb-sub">CUSTOM BALANCE · GAME STATS</div>
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
            <button className="btn ghost tb-user" onClick={logout} title={user.email + ' · 클릭하면 로그아웃'}>
              {(user.user_metadata?.full_name || user.email || '?').slice(0, 1).toUpperCase()}
            </button>
          ) : (
            <button className="btn ghost" onClick={login}><span className="gg">G</span> 로그인</button>
          ))}
          <button className="btn ghost" onClick={leave}># 방 전환</button>
        </div>
      </header>

      <main className="main">
        <div className="content">{children}</div>
      </main>
    </div>
  );
}
