'use client';
import { useEffect, useState } from 'react';
import { useGroup } from '../../components/GroupProvider.jsx';
import { apiFetch } from '../../components/api.js';

function fmtDate(s) {
  if (!s) return '';
  const d = new Date(s);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function AdminPage() {
  const { isAdmin, group, enterRoomByCode } = useGroup();
  const [rooms, setRooms] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(null);

  async function load() {
    setErr(null);
    try {
      const r = await apiFetch('/api/admin/rooms').then((x) => x.json());
      if (!r.ok) throw new Error(r.error);
      setRooms(r.rooms);
    } catch (e) { setErr(e.message); }
  }
  useEffect(() => { if (isAdmin) load(); /* eslint-disable-next-line */ }, [isAdmin]);

  async function del(room) {
    if (!window.confirm(`"${room.name}" 방을 삭제할까요?\n경기·통계·사람·멤버 전부 영구 삭제됩니다.`)) return;
    setBusy(room.id);
    try {
      const r = await apiFetch('/api/rooms/delete', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gid: room.id }),
      }).then((x) => x.json());
      if (!r.ok) throw new Error(r.error);
      setRooms((rs) => rs.filter((x) => x.id !== room.id));
    } catch (e) { window.alert('삭제 실패: ' + e.message); }
    setBusy(null);
  }

  if (!isAdmin) return <div className="panel center muted" style={{ padding: '28px 0' }}>🛡 관리자 전용 페이지예요.</div>;

  return (
    <div>
      <div className="page-head">
        <div className="title"><h1>🛡 관리자</h1><p className="sub" style={{ margin: 0 }}>생성된 모든 방 목록. 아무 방이나 입장하거나 삭제할 수 있어요.</p></div>
        <button className="btn ghost" onClick={load}>새로고침</button>
      </div>
      {err && <div className="panel err" style={{ padding: '10px 16px' }}>{err}</div>}
      {!rooms ? <div className="panel center muted">불러오는 중…</div> : (
        <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
          <table className="admin-table">
            <thead>
              <tr><th className="l">방</th><th>코드</th><th>방장</th><th>사람</th><th>경기</th><th>멤버</th><th>생성일</th><th></th></tr>
            </thead>
            <tbody>
              {rooms.map((r) => (
                <tr key={r.id} className={group?.id === r.id ? 'cur' : ''}>
                  <td className="l"><b>{r.name}</b>{group?.id === r.id && <span className="muted" style={{ fontSize: 11 }}> · 현재</span>}</td>
                  <td>#{r.code}</td>
                  <td className="l">{r.ownerEmail || <span className="muted">주인 없음</span>}</td>
                  <td>{r.persons}</td>
                  <td>{r.matches}</td>
                  <td>{r.members}</td>
                  <td className="muted">{fmtDate(r.created_at)}</td>
                  <td className="acts">
                    <button className="btn mini" onClick={() => enterRoomByCode(r.code)} disabled={group?.id === r.id}>입장</button>
                    <button className="btn mini danger" onClick={() => del(r)} disabled={busy === r.id}>삭제</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
