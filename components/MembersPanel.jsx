'use client';
// 방장 전용 권한 관리: 권한 가진 사람만 목록에 + 방에 들어온 구경꾼 중 골라 권한 부여.
// 구경꾼(로그인만 한 사람)은 목록에 안 띄우고 "권한 추가" 드롭다운에서만 고른다.
import { useEffect, useState } from 'react';
import { apiFetch } from './api.js';
import { useGroup } from './GroupProvider.jsx';
import { useLang } from './i18n.jsx';

const ROLE_KR = { owner: '방장', editor: '편집자', recorder: '기록 담당자', viewer: '구경꾼' };

export default function MembersPanel({ gid }) {
  const { t } = useLang();
  const { deleteRoom } = useGroup() || {};
  const [members, setMembers] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(null);
  // 권한 추가 폼: 고른 사람 + 부여할 역할
  const [pick, setPick] = useState('');
  const [pickRole, setPickRole] = useState('recorder');

  async function load() {
    try {
      const r = await apiFetch('/api/members?gid=' + gid).then((x) => x.json());
      if (!r.ok) throw new Error(r.error);
      setMembers(r.members);
    } catch (e) { setErr(t(e.message)); }
  }
  useEffect(() => { if (gid) load(); /* eslint-disable-next-line */ }, [gid]);

  async function setRole(user_id, role) {
    setBusy(user_id); setErr(null);
    try {
      const r = await apiFetch('/api/members', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gid, user_id, role }),
      }).then((x) => x.json());
      if (!r.ok) throw new Error(r.error);
      await load();
    } catch (e) { setErr(t(e.message)); }
    setBusy(null);
  }

  async function remove(user_id, label) {
    if (!window.confirm(t('{label} 님을 방에서 내보낼까요?\n\n권한과 관람 흔적만 지워져요. 경기·통계 기록은 그대로 남아요.', { label }))) return;
    setBusy(user_id); setErr(null);
    try {
      const r = await apiFetch('/api/members', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gid, user_id }),
      }).then((x) => x.json());
      if (!r.ok) throw new Error(r.error);
      await load();
    } catch (e) { setErr(t(e.message)); }
    setBusy(null);
  }

  async function grant() {
    if (!pick) return;
    await setRole(pick, pickRole);
    setPick('');
  }

  if (!members) return null;

  const granted = members.filter((m) => m.role !== 'viewer'); // 방장·편집자·기록 담당자
  const viewers = members.filter((m) => m.role === 'viewer'); // 로그인만 한 사람 = 권한 후보
  const nameOf = (m) => m.name || m.email || t('이름 없음');

  return (
    <div className="panel members-panel">
      <h2>{t('권한 관리')} <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>{t('· 권한 가진 사람만 표시 · 방장만 변경')}</span></h2>
      {err && <div className="err">{err}</div>}

      <div className="mp-list">
        {granted.map((m) => (
          <div className="mp-row" key={m.user_id}>
            <span className="mp-av">{nameOf(m).slice(0, 1).toUpperCase()}</span>
            <div className="mp-id">
              <b>{nameOf(m)}</b>
              {m.email && <span className="muted">{m.email}</span>}
            </div>
            {m.role === 'owner' ? (
              <span className={`mp-role r-${m.role}`}>{t(ROLE_KR[m.role])} {t('· 본인')}</span>
            ) : (
              <>
                <select className="mp-rolesel" value={m.role} disabled={busy === m.user_id} onChange={(e) => setRole(m.user_id, e.target.value)} title={t('편집자=멤버관리·기록 다 / 기록 담당자=리플·경기 기록만')}>
                  <option value="editor">{t('편집자 (전체)')}</option>
                  <option value="recorder">{t('기록 담당자 (기록만)')}</option>
                </select>
                <button className="mp-x" disabled={busy === m.user_id} onClick={() => remove(m.user_id, nameOf(m))} title={t('권한 회수 + 방에서 내보내기')}>{t('내보내기')}</button>
              </>
            )}
          </div>
        ))}
        {granted.length <= 1 && <div className="muted" style={{ fontSize: 12 }}>{t('아직 권한을 준 사람이 없어요. 아래에서 방에 들어온 사람에게 권한을 줄 수 있어요.')}</div>}
      </div>

      {/* 권한 추가: 이 방에 들어온(로그인) 구경꾼 중에서 고른다 */}
      <div className="mp-add">
        <div className="mp-add-title">{t('권한 추가')}</div>
        {viewers.length === 0 ? (
          <div className="muted" style={{ fontSize: 12 }}>{t('권한 줄 사람이 없어요. 친구가 로그인해서 이 방 코드로 들어오면 여기 목록에 떠요.')}</div>
        ) : (
          <>
            <div className="mp-add-row">
              <select className="mp-addsel" value={pick} onChange={(e) => setPick(e.target.value)}>
                <option value="">{t('— 방에 들어온 사람 선택 —')}</option>
                {viewers.map((m) => (
                  <option key={m.user_id} value={m.user_id}>{nameOf(m)}{m.email ? ` (${m.email})` : ''}</option>
                ))}
              </select>
              <select className="mp-addsel narrow" value={pickRole} onChange={(e) => setPickRole(e.target.value)}>
                <option value="recorder">{t('기록 담당자')}</option>
                <option value="editor">{t('편집자')}</option>
              </select>
              <button className="btn" disabled={!pick || busy} onClick={grant}>{t('부여')}</button>
            </div>
            <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>{t('기록 담당자 = 리플·경기 기록만 · 편집자 = 멤버관리까지 전부')}</div>
          </>
        )}
      </div>

      <div className="mp-danger">
        <span className="muted" style={{ fontSize: 12 }}>{t('방을 삭제하면 이 방의 ')}<b>{t('모든 경기·통계·사람·멤버가 영구 삭제')}</b>{t('돼요. 되돌릴 수 없어요.')}</span>
        <button className="btn danger" onClick={deleteRoom}>{t('이 방 삭제')}</button>
      </div>
    </div>
  );
}
