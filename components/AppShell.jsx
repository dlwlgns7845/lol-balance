'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useGroup } from './GroupProvider.jsx';
import { apiFetch } from './api.js';
import MembersPanel from './MembersPanel.jsx';
import { useLang, LangSwitch } from './i18n.jsx';

const NAV = [
  { href: '/', label: '통계', ic: '📊' },
  { href: '/balancer', label: '밸런서', ic: '⚔️' },
  { href: '/recruit', label: '오늘 내전', ic: '🎮' },
  { href: '/people', label: '멤버 관리', ic: '👥' },
  { href: '/settings', label: '점수표', ic: '⚙️' },
];

export default function AppShell({ children }) {
  const { group, role, leave, user, discord, canEdit, canRecord, authOn, isAdmin, login, logout, claim, showAwards, setShowAwards, winAdjEnabled, setWinAdjEnabled } = useGroup();
  const { t, lang, setLang } = useLang();
  const path = usePathname();
  const canModerate = isAdmin || role === 'owner' || role === 'editor';
  let nav = canModerate ? [...NAV, { href: '/reports', label: '신고', ic: '🚨' }] : NAV;
  if (isAdmin) nav = [...nav, { href: '/admin', label: '관리자', ic: '🛡' }];
  const [menu, setMenu] = useState(false);
  const [settings, setSettings] = useState(false); // 설정 모달 — 언어(모두) + 방 설정·권한(방장)
  const canManage = isAdmin || (user && group?.owner_id && group.owner_id === user.id);
  // 로그인=본인선수 자동매칭 결과 { person:{id,name}|null, hasDiscord } — 헤더 "내 전적"·연결 유도용
  const [me, setMe] = useState(null);
  useEffect(() => {
    if (!user || !group?.id) { setMe(null); return; }
    let alive = true;
    apiFetch('/api/me?gid=' + group.id).then((r) => r.json())
      .then((r) => { if (alive && r.ok) setMe(r); }).catch(() => {});
    return () => { alive = false; };
  }, [user, group?.id]);
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
    if (!window.confirm(t('내 로그인 기록(관람 흔적·이메일 노출)을 지우고 로그아웃할까요?\n\n다시 로그인하면 정상적으로 이용할 수 있어요.'))) return;
    try { await apiFetch('/api/directory-optout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); } catch { /* 무시 */ }
    if (logout) logout();
  }

  const brandTitle = lang === 'en'
    ? <><span className="accent">Inhouse</span> Balance · Stats</>
    : <><span className="accent">내전</span> 밸런스 · 통계</>;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="tb-brand">
          <img src={brand?.icon || '/logo.webp'} alt="logo" className="tb-logo-img"
            onError={(e) => { e.currentTarget.style.display = 'none'; const f = e.currentTarget.parentElement.querySelector('.tb-logo'); if (f) f.style.display = 'grid'; }} />
          <span className="tb-logo" style={{ display: 'none' }}>LoL</span>
          <div className="tb-title">
            <div className="tb-name">{brand?.name ? brand.name : brandTitle}</div>
            <div className="tb-sub">{brand?.name ? t('내전 밸런스 · 통계') : 'CUSTOM BALANCE · GAME STATS'}</div>
          </div>
        </div>

        <nav className="tb-nav">
          {nav.map((n) => (
            <Link key={n.href} href={n.href} className={path === n.href ? 'active' : ''}>
              <span className="ic">{n.ic}</span>{t(n.label)}
            </Link>
          ))}
        </nav>

        <div className="tb-actions">
          {me?.person && <Link href={`/player?id=${me.person.id}`} className="btn ghost tb-myrec" title={t('{name} 전적', { name: me.person.name })}>📊 {t('내 전적')}</Link>}
          {!canRecord && <span className="tb-view">👀 {t('구경 모드')}</span>}
          {canRecord && (
            <Link href="/record" className={`btn tb-record${path === '/record' ? ' ghost' : ''}`}>📸 {t('결과 추가')}</Link>
          )}
          {!group.owner_id && user && (
            <button className="btn ghost tb-claim" onClick={claim} title={t('이 방(주인 없음)의 방장이 되어 권한을 관리합니다')}>👑 {t('방장 되기')}</button>
          )}
          <span className="tb-room">{group.name} <span className="muted">#{group.code}</span></span>
          {authOn && (user ? (
            <div className="tb-usermenu">
              <button className="btn ghost tb-user" onClick={() => setMenu((v) => !v)} title={discord?.name || user.email || ''}>
                {discord?.avatar
                  ? <img src={discord.avatar} alt="" className="tb-user-av" />
                  : (discord?.name || user.user_metadata?.full_name || user.email || '?').slice(0, 1).toUpperCase()}
              </button>
              {menu && (
                <>
                  <div className="tb-menu-backdrop" onClick={() => setMenu(false)} />
                  <div className="tb-menu">
                    <div className="tb-menu-email">{discord?.name ? <><b>{discord.name}</b> · {t('디스코드')}</> : user.email}</div>
                    <button onClick={() => { setMenu(false); setSettings(true); }}>⚙ {canManage ? t('설정 · 방 권한') : t('설정')}</button>
                    <button onClick={() => { setMenu(false); logout && logout(); }}>{t('로그아웃')}</button>
                    <button className="danger" onClick={clearTraces}>🙈 {t('로그인 기록 삭제 후 로그아웃')}</button>
                  </div>
                </>
              )}
            </div>
          ) : (
            <button className="btn ghost" onClick={() => login('discord')} title={t('디스코드로 로그인')}><span className="dg" aria-hidden>◈</span> {t('로그인')}</button>
          ))}
          <button className="btn ghost" onClick={leave}># {t('방 전환')}</button>
        </div>
      </header>

      <main className="main">
        <div className="content">{children}</div>
      </main>
      <footer className="site-credit">
        {t('티어·전적 데이터 제공:')} <a href="https://op.gg" target="_blank" rel="noreferrer">OP.GG</a>
        {/* 로그인 안 한 사람도 언어를 바꿀 수 있게 — 조용한 텍스트 링크 */}
        {!user && (
          <button type="button" className="linkbtn lang-link" onClick={() => setLang(lang === 'en' ? 'ko' : 'en')}>
            {lang === 'en' ? '한국어' : 'English'}
          </button>
        )}
      </footer>

      {settings && (
        <div className="modal-backdrop" onClick={() => setSettings(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <b>{t('설정')}</b>
              <button className="modal-x" onClick={() => setSettings(false)} aria-label={t('닫기')}>✕</button>
            </div>

            <div className="set-toggle">
              <div className="set-toggle-txt">
                <b>{t('언어')} · Language</b>
                <span className="muted">{t('이 브라우저에만 적용돼요')}</span>
              </div>
              <LangSwitch />
            </div>

            {canManage && (
              <>
                <div className="set-section-label">{t('방 설정 · 권한')}</div>
                <div className="set-toggle">
                  <div className="set-toggle-txt">
                    <b>{t('칭호 표시')}</b>
                    <span className="muted">🎖 {t('명예의 전당 + 이름 옆 칭호 뱃지 (공공의적·시체 등)')}</span>
                  </div>
                  <button className={`switch${showAwards ? ' on' : ''}`} role="switch" aria-checked={showAwards}
                    onClick={() => setShowAwards(!showAwards)}>
                    <span className="switch-knob" />
                  </button>
                </div>

                <div className="set-toggle">
                  <div className="set-toggle-txt">
                    <b>{t('승률 보정 (티어보정)')}</b>
                    <span className="muted">{t('내전 승률로 밸런스 점수 ±6 조정 · 판수 적으면 자동 축소 (극단은 관리자 수동)')}</span>
                  </div>
                  <button className={`switch${winAdjEnabled ? ' on' : ''}`} role="switch" aria-checked={winAdjEnabled}
                    onClick={() => setWinAdjEnabled(!winAdjEnabled)}>
                    <span className="switch-knob" />
                  </button>
                </div>

                <MembersPanel gid={group.id} />
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
