'use client';
// 방장 전용: 로그인 멤버 목록 + 편집 권한 부여/회수.
import { useEffect, useState } from 'react';
import { apiFetch } from './api.js';
import { useGroup } from './GroupProvider.jsx';

const ROLE_KR = { owner: '방장', editor: '편집자', viewer: '구경꾼' };

export default function MembersPanel({ gid }) {
  const { deleteRoom } = useGroup() || {};
  const [members, setMembers] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(null);

  async function load() {
    try {
      const r = await apiFetch('/api/members?gid=' + gid).then((x) => x.json());
      if (!r.ok) throw new Error(r.error);
      setMembers(r.members);
    } catch (e) { setErr(e.message); }
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
    } catch (e) { setErr(e.message); }
    setBusy(null);
  }

  if (!members) return null;

  return (
    <div className="panel members-panel">
      <h2>방 멤버 <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>· 로그인해서 방에 들어온 사람 · 방장만 권한 변경</span></h2>
      {err && <div className="err">{err}</div>}
      <div className="mp-list">
        {members.map((m) => (
          <div className="mp-row" key={m.user_id}>
            <span className="mp-av">{(m.name || m.email || '?').slice(0, 1).toUpperCase()}</span>
            <div className="mp-id">
              <b>{m.name || m.email}</b>
              <span className="muted">{m.email}</span>
            </div>
            <span className={`mp-role r-${m.role}`}>{ROLE_KR[m.role]}</span>
            {m.role === 'owner' ? (
              <span className="muted" style={{ fontSize: 11 }}>본인</span>
            ) : m.role === 'editor' ? (
              <button className="btn ghost mini" disabled={busy === m.user_id} onClick={() => setRole(m.user_id, 'viewer')}>편집 권한 회수</button>
            ) : (
              <button className="btn mini" disabled={busy === m.user_id} onClick={() => setRole(m.user_id, 'editor')}>편집 권한 주기</button>
            )}
          </div>
        ))}
        {members.length <= 1 && <div className="muted" style={{ fontSize: 12 }}>아직 다른 멤버가 없어요. 친구가 로그인해서 이 방 코드로 들어오면 여기 떠요.</div>}
      </div>

      <div className="mp-danger">
        <span className="muted" style={{ fontSize: 12 }}>방을 삭제하면 이 방의 <b>모든 경기·통계·사람·멤버가 영구 삭제</b>돼요. 되돌릴 수 없어요.</span>
        <button className="btn danger" onClick={deleteRoom}>🗑 이 방 삭제</button>
      </div>
    </div>
  );
}
