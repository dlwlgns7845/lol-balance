'use client';
import { createContext, useContext, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import AppShell from './AppShell.jsx';
import { apiFetch } from './api.js';
import { supabaseBrowser, authConfigured } from '../src/supabase-browser.js';
import { useLang, LangSwitch } from './i18n.jsx';

const Ctx = createContext(null);
export function useGroup() { return useContext(Ctx); }

// Supabase user → 디스코드 프로필 { id(스노플레이크), name, avatar }. 디코 연결 없으면 null.
// 계정이 이메일로 병합됐어도(구글+디코) 디코 identity_data에서 직접 읽음 → 구글 메타에 안 가려짐.
function discordIdentity(user) {
  if (!user) return null;
  const di = (user.identities || []).find((i) => i.provider === 'discord');
  if (di) {
    const d = di.identity_data || {};
    const id = di.id || d.provider_id || d.sub;
    if (id) return { id: String(id), name: d.full_name || d.name || d.global_name || d.custom_claims?.global_name || null, avatar: d.avatar_url || d.picture || null };
  }
  // 폴백: 디코로만 로그인해 user_metadata가 디코인 경우
  const md = user.user_metadata || {};
  if ((md.provider === 'discord' || md.iss?.includes?.('discord')) && (md.provider_id || md.sub)) {
    return { id: String(md.provider_id || md.sub), name: md.full_name || md.name || md.global_name || null, avatar: md.avatar_url || md.picture || null };
  }
  return null;
}

const KEY = 'lol-balance-group';
const ADMIN_EMAILS = ['dlwlgns714@gmail.com', 'fbwlgkr7845@gmail.com'];

export default function GroupProvider({ children }) {
  const [group, setGroup] = useState(null);
  const [role, setRole] = useState(null);      // owner | editor | viewer | null
  const [canEdit, setCanEdit] = useState(true); // 레거시 방이면 기본 true (멤버관리·설정)
  const [canRecord, setCanRecord] = useState(true); // 기록(리플·경기) 권한 — recorder 포함
  const [ownerless, setOwnerless] = useState(false);
  const [user, setUser] = useState(null);      // 구글 로그인 유저
  const [authReady, setAuthReady] = useState(!authConfigured());
  const [loaded, setLoaded] = useState(false);
  const path = usePathname();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const { t, lang } = useLang();

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
    setCanEdit(r?.canEdit ?? true); setCanRecord(r?.canRecord ?? r?.canEdit ?? true); setOwnerless(r?.ownerless ?? !g?.owner_id);
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

  function leave() { setGroup(null); setRole(null); setCanEdit(true); setCanRecord(true); localStorage.removeItem(KEY); }

  async function login(provider = 'discord') {
    const sb = supabaseBrowser();
    if (!sb) { setMsg(t('로그인이 아직 설정되지 않았어요 (관리자 설정 필요)')); return; }
    const opts = { redirectTo: window.location.origin + window.location.pathname };
    if (provider === 'discord') opts.scopes = 'identify'; // 디코 유저ID·닉·아바타만 (이메일·서버목록 불필요)
    await sb.auth.signInWithOAuth({ provider, options: opts });
  }
  async function logout() { const sb = supabaseBrowser(); if (sb) await sb.auth.signOut(); }

  async function enter(create) {
    const c = code.trim().toLowerCase();
    if (!c) { setMsg(t('방 코드를 입력하세요')); return; }
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
    if (!user) { window.alert(t('먼저 로그인하세요 (디스코드 권장).')); return; }
    setBusy(true); setMsg(null);
    try {
      const r = await apiFetch('/api/rooms/claim', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gid: group.id }),
      }).then((x) => x.json());
      if (!r.ok) throw new Error(r.error || '실패');
      applyEntry(r.group, { role: 'owner', canEdit: true, ownerless: false });
      window.alert(t('✅ 이제 이 방의 방장이에요! 편집 권한이 적용됩니다.'));
    } catch (e) {
      window.alert(t('방장 되기 실패: ') + t(e.message));
      setMsg(e.message);
    }
    setBusy(false);
  }

  // 칭호(명예의 전당 + 인라인 뱃지) 노출 on/off — 방장/관리자. 성공 시 즉시 반영.
  async function setShowAwards(v) {
    if (!group) return;
    try {
      const r = await apiFetch('/api/awards-setting?gid=' + group.id, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: v }),
      }).then((x) => x.json());
      if (!r.ok) throw new Error(r.error || '실패');
      setGroup((g) => { const ng = { ...g, show_awards: v }; try { localStorage.setItem(KEY, JSON.stringify(ng)); } catch {} return ng; });
    } catch (e) { window.alert(t('칭호 설정 변경 실패: ') + t(e.message)); }
  }

  // 승률 보정(티어보정) on/off — 방장/관리자. 성공 시 즉시 반영.
  async function setWinAdjEnabled(v) {
    if (!group) return;
    try {
      const r = await apiFetch('/api/winadj-setting?gid=' + group.id, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: v }),
      }).then((x) => x.json());
      if (!r.ok) throw new Error(r.error || '실패');
      setGroup((g) => { const ng = { ...g, winadj_enabled: v }; try { localStorage.setItem(KEY, JSON.stringify(ng)); } catch {} return ng; });
    } catch (e) { window.alert(t('승률 보정 설정 변경 실패: ') + t(e.message)); }
  }

  // 관리자가 대시보드에서 아무 방이나 입장
  async function enterRoomByCode(code) {
    try { const r = await fetchGroupByCode(code); applyEntry(r.group, r); }
    catch (e) { window.alert(t('입장 실패: ') + t(e.message)); }
  }

  // 방 삭제 (방장만) — 확인 후 삭제하고 게이트로
  async function deleteRoom() {
    if (!group || busy) return;
    if (!window.confirm(t('정말 "{name}" 방을 삭제할까요?\n이 방의 모든 경기·통계·사람·멤버가 영구 삭제됩니다. 되돌릴 수 없어요.', { name: group.name }))) return;
    setBusy(true);
    try {
      const r = await apiFetch('/api/rooms/delete', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gid: group.id }),
      }).then((x) => x.json());
      if (!r.ok) throw new Error(r.error || '실패');
      window.alert(t('방이 삭제됐어요.'));
      leave();
    } catch (e) { window.alert(t('방 삭제 실패: ') + t(e.message)); }
    setBusy(false);
  }

  if (!loaded || !authReady) return null;

  // 🏆 멸망전 — 방과 무관한 독립 진입. 방 게이트 우회. 크롬(상단바·사이드바)은 app/tournament/layout.jsx가 담당.
  if (path && path.startsWith('/tournament')) {
    return (
      <Ctx.Provider value={{ group: null, user, discord: discordIdentity(user), login, logout,
        isAdmin: !!user && ADMIN_EMAILS.includes((user.email || '').toLowerCase()), authOn: authConfigured() }}>
        {children}
      </Ctx.Provider>
    );
  }

  if (!group) {
    return (
      <div className="gate-wrap">
        <LangSwitch className="gate-lang" />
        <div className="panel gate">
          <img src="/logo.webp" alt="logo" className="gate-logo" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
          <div className="brand-big">{lang === 'en' ? <><span className="accent">Inhouse</span> Balance · Stats</> : <><span className="accent">내전</span> 밸런스 · 통계</>}</div>
          <div className="tagline"><span className="pill"><span className="dot" />{t('AI 밸런싱 · 스크린샷 자동 기록')}</span></div>

          {authConfigured() && <div className="gate-auth">
            {user ? (
              <div className="gate-user">
                {(() => { const dc = discordIdentity(user); return (
                  <span className="muted" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    {dc?.avatar && <img src={dc.avatar} alt="" style={{ width: 20, height: 20, borderRadius: '50%' }} />}
                    {t('로그인됨')} · <b>{dc?.name || user.user_metadata?.full_name || user.email}</b>
                  </span>
                ); })()}
                <button className="linkbtn" onClick={logout}>{t('로그아웃')}</button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
                <button className="btn dbtn" onClick={() => login('discord')} type="button">
                  <span className="dg" aria-hidden>◈</span> {t('디스코드로 로그인')}
                </button>
                <button className="linkbtn" onClick={() => login('google')} type="button" style={{ fontSize: 12 }}>{t('또는 구글로 로그인')}</button>
              </div>
            )}
            <p className="muted gate-auth-note">
              {user ? t('방을 만들면 방장이 돼요.') : t('로그인 없이도 방 코드로 구경 가능. 방을 만들거나 기록하려면 로그인하세요.')}
            </p>
          </div>}

          <h2>{t('내전 방 입장')}</h2>
          <input placeholder={t('방 코드 (예: bingsu)')} value={code}
            onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && enter(false)} />
          <input placeholder={t('방 이름 (새로 만들 때, 예: 빙수방 내전)')} value={name}
            onChange={(e) => setName(e.target.value)} />
          <div className="controls" style={{ marginTop: 12 }}>
            <button className="btn" disabled={busy} onClick={() => enter(false)}>{t('들어가기 (구경)')}</button>
            <button className="btn ghost" disabled={busy} onClick={() => enter(true)}>{t('새 방 만들기')}</button>
          </div>
          {msg && <div className="err">{t(msg)}</div>}

          <div style={{ marginTop: 18, paddingTop: 16, borderTop: '1px solid #24242c', textAlign: 'center' }}>
            <a className="btn ghost" href="/tournament" style={{ textDecoration: 'none' }}>🏆 {t('멸망전 (커뮤니티 대회)')}</a>
            <p className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>{t('내전과 별개 · 팀 신청/대진/진행')}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <Ctx.Provider value={{ group, role, canEdit, canRecord, ownerless, user, discord: discordIdentity(user),
      isAdmin: !!user && ADMIN_EMAILS.includes((user.email || '').toLowerCase()),
      authOn: authConfigured(), showAwards: group.show_awards !== false, setShowAwards,
      winAdjEnabled: group.winadj_enabled !== false, setWinAdjEnabled,
      leave, login, logout, claim, deleteRoom, enterRoomByCode }}>
      <AppShell>{children}</AppShell>
    </Ctx.Provider>
  );
}
