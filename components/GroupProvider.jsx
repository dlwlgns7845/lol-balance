'use client';
import { createContext, useContext, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import AppShell from './AppShell.jsx';
import { apiFetch } from './api.js';
import { supabaseBrowser, authConfigured } from '../src/supabase-browser.js';

const Ctx = createContext(null);
export function useGroup() { return useContext(Ctx); }

const KEY = 'lol-balance-group';
const ADMIN_EMAILS = ['dlwlgns714@gmail.com', 'fbwlgkr7845@gmail.com'];

export default function GroupProvider({ children }) {
  const [group, setGroup] = useState(null);
  const [role, setRole] = useState(null);      // owner | editor | viewer | null
  const [canEdit, setCanEdit] = useState(true); // 레거시 방이면 기본 true
  const [ownerless, setOwnerless] = useState(false);
  const [user, setUser] = useState(null);      // 구글 로그인 유저
  const [authReady, setAuthReady] = useState(!authConfigured());
  const [loaded, setLoaded] = useState(false);
  const path = usePathname();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  // ── 인증 세션 추적 ──
  useEffect(() => {
    const sb = supabaseBrowser();
    if (!sb) { setAuthReady(true); return; }
    sb.auth.getSession().then(({ data }) => { setUser(data?.session?.user || null); setAuthReady(true); });
    const { data: sub } = sb.auth.onAuthStateChange((_e, session) => setUser(session?.user || null));
    return () => sub?.subscription?.unsubscribe?.();
  }, []);

  function applyEntry(g, r) {
    setGroup(g); setRole(r?.role ?? null);
    setCanEdit(r?.canEdit ?? true); setOwnerless(r?.ownerless ?? !g?.owner_id);
    localStorage.setItem(KEY, JSON.stringify(g));
  }

  async function fetchGroupByCode(c) {
    const r = await apiFetch('/api/groups/' + encodeURIComponent(c)).then((x) => x.json());
    if (!r.ok) throw new Error(r.error);
    return r;
  }

  // 최초 로드: 저장된 방 or ?room= 공유링크
  useEffect(() => {
    let saved = null;
    try { const s = localStorage.getItem(KEY); if (s) saved = JSON.parse(s); } catch {}
    const room = new URLSearchParams(window.location.search).get('room');
    const target = room ? room.toLowerCase() : saved?.code;
    if (target) {
      fetchGroupByCode(target)
        .then((r) => applyEntry(r.group, r))
        .catch(() => saved && setGroup(saved))
        .finally(() => setLoaded(true));
      return;
    }
    setLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 로그인 상태 바뀌면 현재 방의 역할 재조회 (멤버 등록 + 권한 갱신)
  useEffect(() => {
    if (!group?.code || !authReady) return;
    fetchGroupByCode(group.code).then((r) => applyEntry(r.group, r)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, authReady]);

  function leave() { setGroup(null); setRole(null); setCanEdit(true); localStorage.removeItem(KEY); }

  async function login() {
    const sb = supabaseBrowser();
    if (!sb) { setMsg('로그인이 아직 설정되지 않았어요 (관리자 설정 필요)'); return; }
    await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin + window.location.pathname } });
  }
  async function logout() { const sb = supabaseBrowser(); if (sb) await sb.auth.signOut(); }

  async function enter(create) {
    const c = code.trim().toLowerCase();
    if (!c) { setMsg('방 코드를 입력하세요'); return; }
    setBusy(true); setMsg(null);
    try {
      if (create) {
        const r = await apiFetch('/api/groups', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: c, name: name.trim() || c }),
        }).then((x) => x.json());
        if (!r.ok) throw new Error(r.error);
        applyEntry(r.group, r);
      } else {
        const r = await fetchGroupByCode(c);
        applyEntry(r.group, r);
      }
    } catch (e) { setMsg(e.message); }
    setBusy(false);
  }

  // 레거시(주인 없는) 방을 내가 방장으로 가져오기
  async function claim() {
    if (!group || busy) return;
    if (!user) { window.alert('먼저 구글로 로그인하세요.'); return; }
    setBusy(true); setMsg(null);
    try {
      const r = await apiFetch('/api/rooms/claim', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gid: group.id }),
      }).then((x) => x.json());
      if (!r.ok) throw new Error(r.error || '실패');
      applyEntry(r.group, { role: 'owner', canEdit: true, ownerless: false });
      window.alert('✅ 이제 이 방의 방장이에요! 편집 권한이 적용됩니다.');
    } catch (e) {
      window.alert('방장 되기 실패: ' + e.message);
      setMsg(e.message);
    }
    setBusy(false);
  }

  // 관리자가 대시보드에서 아무 방이나 입장
  async function enterRoomByCode(code) {
    try { const r = await fetchGroupByCode(code); applyEntry(r.group, r); }
    catch (e) { window.alert('입장 실패: ' + e.message); }
  }

  // 방 삭제 (방장만) — 확인 후 삭제하고 게이트로
  async function deleteRoom() {
    if (!group || busy) return;
    if (!window.confirm(`정말 "${group.name}" 방을 삭제할까요?\n이 방의 모든 경기·통계·사람·멤버가 영구 삭제됩니다. 되돌릴 수 없어요.`)) return;
    setBusy(true);
    try {
      const r = await apiFetch('/api/rooms/delete', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gid: group.id }),
      }).then((x) => x.json());
      if (!r.ok) throw new Error(r.error || '실패');
      window.alert('방이 삭제됐어요.');
      leave();
    } catch (e) { window.alert('방 삭제 실패: ' + e.message); }
    setBusy(false);
  }

  if (!loaded || !authReady) return null;

  // 🏆 멸망전 — 방과 무관한 독립 진입. 방 게이트 우회 + 최소 셸 (내전 상단바 없음).
  if (path && path.startsWith('/tournament')) {
    return (
      <Ctx.Provider value={{ group: null, user, login, logout,
        isAdmin: !!user && ADMIN_EMAILS.includes((user.email || '').toLowerCase()), authOn: authConfigured() }}>
        <div style={{ minHeight: '100vh' }}>
          <header style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 20px', borderBottom: '1px solid #24242c', background: '#101015' }}>
            <a href="/" style={{ color: '#9aa0ad', textDecoration: 'none', fontSize: 13 }}>← 방 입장</a>
            <span style={{ fontWeight: 800 }}>🏆 멸망전</span>
            <span style={{ marginLeft: 'auto', fontSize: 13 }}>
              {user ? <button className="linkbtn" onClick={logout}>로그아웃 · {user.user_metadata?.full_name || user.email}</button>
                : (authConfigured() && <button className="btn" onClick={login}><span className="gg">G</span> 로그인</button>)}
            </span>
          </header>
          <main style={{ padding: '20px 16px' }}>{children}</main>
        </div>
      </Ctx.Provider>
    );
  }

  if (!group) {
    return (
      <div className="gate-wrap">
        <div className="panel gate">
          <img src="/logo.webp" alt="로고" className="gate-logo" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
          <div className="brand-big"><span className="accent">내전</span> 밸런스 · 통계</div>
          <div className="tagline"><span className="pill"><span className="dot" />AI 밸런싱 · 스크린샷 자동 기록</span></div>

          {authConfigured() && <div className="gate-auth">
            {user ? (
              <div className="gate-user">
                <span className="muted">로그인됨 · <b>{user.user_metadata?.full_name || user.email}</b></span>
                <button className="linkbtn" onClick={logout}>로그아웃</button>
              </div>
            ) : (
              <button className="btn gbtn" onClick={login} type="button">
                <span className="gg">G</span> 구글로 로그인
              </button>
            )}
            <p className="muted gate-auth-note">
              {user ? '방을 만들면 방장이 돼요.' : '로그인 없이도 방 코드로 구경 가능. 방을 만들거나 기록하려면 로그인하세요.'}
            </p>
          </div>}

          <h2>내전 방 입장</h2>
          <input placeholder="방 코드 (예: bingsu)" value={code}
            onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && enter(false)} />
          <input placeholder="방 이름 (새로 만들 때, 예: 빙수방 내전)" value={name}
            onChange={(e) => setName(e.target.value)} />
          <div className="controls" style={{ marginTop: 12 }}>
            <button className="btn" disabled={busy} onClick={() => enter(false)}>들어가기 (구경)</button>
            <button className="btn ghost" disabled={busy} onClick={() => enter(true)}>새 방 만들기</button>
          </div>
          {msg && <div className="err">{msg}</div>}

          <div style={{ marginTop: 18, paddingTop: 16, borderTop: '1px solid #24242c', textAlign: 'center' }}>
            <a className="btn ghost" href="/tournament" style={{ textDecoration: 'none' }}>🏆 멸망전 (커뮤니티 대회)</a>
            <p className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>내전과 별개 · 팀 신청/대진/진행</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <Ctx.Provider value={{ group, role, canEdit, ownerless, user,
      isAdmin: !!user && ADMIN_EMAILS.includes((user.email || '').toLowerCase()),
      authOn: authConfigured(), leave, login, logout, claim, deleteRoom, enterRoomByCode }}>
      <AppShell>{children}</AppShell>
    </Ctx.Provider>
  );
}
