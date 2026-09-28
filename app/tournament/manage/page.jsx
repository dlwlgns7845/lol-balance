'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useGroup } from '../../../components/GroupProvider.jsx';
import { apiFetch } from '../../../components/api.js';
import { useLang } from '../../../components/i18n.jsx';

const ST = { recruiting: '🟢 모집중', running: '🔵 진행중', done: '🏁 종료' };

export default function TournamentManage() {
  const { user, isAdmin, login } = useGroup() || {};
  const { t } = useLang();
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
    } catch (e) { window.alert(t('실패: ') + t(e.message)); }
    setBusy(null);
  }

  if (!user) return <div className="panel center muted" style={{ padding: '32px 0' }}>{t('로그인이 필요해요.')} <button className="btn dbtn" style={{ marginLeft: 8 }} onClick={() => login('discord')}>{t('디스코드로 로그인')}</button></div>;
  if (!isAdmin) return <div className="panel center muted" style={{ padding: '32px 0' }}>{t('전역 관리자 전용 페이지예요.')}</div>;

  const pending = (list || []).filter((tm) => tm.visible === false);
  const live = (list || []).filter((tm) => tm.visible !== false);
  const Row = (tm) => (
    <div key={tm.id} className="panel" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', marginBottom: 8 }}>
      <span style={{ fontSize: 12.5, color: '#9a9aa6', width: 74, flexShrink: 0 }}>{t(ST[tm.status] || tm.status)}</span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <Link href={`/tournament/${tm.id}/notice`} style={{ fontWeight: 700, color: '#fff', textDecoration: 'none' }}>{tm.name}</Link>
        <div className="muted" style={{ fontSize: 11.5 }}>{t('승인팀')} {tm.approvedTeams || 0} · {t('코드')} {tm.code || '—'}{tm.visible === false ? ' · ⏳ ' + t('승인 대기') : ''}</div>
      </div>
      {tm.visible === false
        ? <button className="btn" disabled={busy === tm.id} onClick={() => setVisible(tm.id, true)}>✅ {t('승인(공개)')}</button>
        : <button className="btn ghost" disabled={busy === tm.id} onClick={() => setVisible(tm.id, false)}>🙈 {t('숨김')}</button>}
    </div>
  );

  return (
    <div>
      <div className="page-head"><div className="title"><h1>🛡 {t('멸망전 전체 관리')}</h1><p className="sub" style={{ margin: 0 }}>{t('새 대회는 승인해야 목록에 공개돼요.')}</p></div></div>
      {list === null ? <div className="panel center muted">{t('불러오는 중…')}</div> : (
        <>
          <h2 style={{ fontSize: 15, margin: '6px 2px 10px' }}>{t('승인 대기')} <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>{t('{n}개', { n: pending.length })}</span></h2>
          {pending.length ? pending.map(Row) : <div className="panel center muted" style={{ padding: '18px 0' }}>{t('대기 중인 대회 없음')}</div>}
          <h2 style={{ fontSize: 15, margin: '18px 2px 10px' }}>{t('공개된 대회')} <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>{t('{n}개', { n: live.length })}</span></h2>
          {live.length ? live.map(Row) : <div className="panel center muted" style={{ padding: '18px 0' }}>{t('공개된 대회 없음')}</div>}
        </>
      )}
    </div>
  );
}
