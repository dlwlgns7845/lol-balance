'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useGroup } from '../../../components/GroupProvider.jsx';
import { apiFetch } from '../../../components/api.js';

const ST = { recruiting: '🟢 모집중', running: '🔵 진행중', done: '🏁 종료' };

export default function TournamentManage() {
  const { user, isAdmin, login } = useGroup() || {};
  const [list, setList] = useState(null);
  const [busy, setBusy] = useState(null);

  const load = () => apiFetch('/api/tournaments').then((x) => x.json()).then((r) => { if (r.ok) setList(r.tournaments || []); });
  useEffect(() => { if (user) load(); }, [user]);

  async function setVisible(id, visible) {
    setBusy(id);
    try {
      const r = await apiFetch(`/api/tournaments/${id}/visible`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ visible }) }).then((x) => x.json());
      if (!r.ok) throw new Error(r.error);
      await load();
    } catch (e) { window.alert('실패: ' + e.message); }
    setBusy(null);
  }

  if (!user) return <div className="panel center muted" style={{ padding: '32px 0' }}>로그인이 필요해요. <button className="btn dbtn" style={{ marginLeft: 8 }} onClick={() => login('discord')}>디스코드로 로그인</button></div>;
  if (!isAdmin) return <div className="panel center muted" style={{ padding: '32px 0' }}>전역 관리자 전용 페이지예요.</div>;

  const pending = (list || []).filter((t) => t.visible === false);
  const live = (list || []).filter((t) => t.visible !== false);
  const Row = (t) => (
    <div key={t.id} className="panel" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', marginBottom: 8 }}>
      <span style={{ fontSize: 12.5, color: '#9a9aa6', width: 74, flexShrink: 0 }}>{ST[t.status] || t.status}</span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <Link href={`/tournament/${t.id}/notice`} style={{ fontWeight: 700, color: '#fff', textDecoration: 'none' }}>{t.name}</Link>
        <div className="muted" style={{ fontSize: 11.5 }}>승인팀 {t.approvedTeams || 0} · 코드 {t.code || '—'}{t.visible === false ? ' · ⏳ 승인 대기' : ''}</div>
      </div>
      {t.visible === false
        ? <button className="btn" disabled={busy === t.id} onClick={() => setVisible(t.id, true)}>✅ 승인(공개)</button>
        : <button className="btn ghost" disabled={busy === t.id} onClick={() => setVisible(t.id, false)}>🙈 숨김</button>}
    </div>
  );

  return (
    <div>
      <div className="page-head"><div className="title"><h1>🛡 멸망전 전체 관리</h1><p className="sub" style={{ margin: 0 }}>새 대회는 승인해야 목록에 공개돼요.</p></div></div>
      {list === null ? <div className="panel center muted">불러오는 중…</div> : (
        <>
          <h2 style={{ fontSize: 15, margin: '6px 2px 10px' }}>승인 대기 <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>{pending.length}개</span></h2>
          {pending.length ? pending.map(Row) : <div className="panel center muted" style={{ padding: '18px 0' }}>대기 중인 대회 없음</div>}
          <h2 style={{ fontSize: 15, margin: '18px 2px 10px' }}>공개된 대회 <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>{live.length}개</span></h2>
          {live.length ? live.map(Row) : <div className="panel center muted" style={{ padding: '18px 0' }}>공개된 대회 없음</div>}
        </>
      )}
    </div>
  );
}
