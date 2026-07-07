'use client';
import { useEffect, useState } from 'react';
import { TABLE, TIER_ORDER, TIER_LABEL, POS, POS_KR } from '../../src/table.js';
import { useGroup } from '../../components/GroupProvider.jsx';
import { apiFetch } from '../../components/api.js';

const deepCopy = (t) => JSON.parse(JSON.stringify(t));

export default function SettingsPage() {
  const { group, canEdit } = useGroup();
  const gid = group?.id;
  const [table, setTable] = useState(null);
  const [custom, setCustom] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    if (!gid) return;
    setLoading(true);
    fetch('/api/score-table?gid=' + gid).then((x) => x.json())
      .then((r) => {
        if (r.ok) { setCustom(!!r.table); setTable(r.table ? r.table : deepCopy(TABLE)); }
        else setMsg(r.error);
      })
      .finally(() => setLoading(false));
  }, [gid]);

  function edit(tier, i, val) {
    setTable((t) => {
      const next = { ...t, [tier]: [...t[tier]] };
      next[tier][i] = val === '' ? 0 : Number(val);
      return next;
    });
  }

  async function save() {
    setSaving(true); setMsg(null);
    try {
      const r = await apiFetch('/api/score-table', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ group_id: gid, table }),
      }).then((x) => x.json());
      if (!r.ok) throw new Error(r.error);
      setCustom(true); setMsg('저장됨 — 이 방 밸런서가 이 표를 사용합니다.');
    } catch (e) { setMsg('저장 실패: ' + e.message); }
    setSaving(false);
  }

  async function reset() {
    if (!confirm('기본 점수표로 되돌릴까요? 이 방의 커스텀 표가 삭제됩니다.')) return;
    setSaving(true); setMsg(null);
    try {
      await apiFetch('/api/score-table', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ group_id: gid, table: null }),
      });
      setTable(deepCopy(TABLE)); setCustom(false); setMsg('기본값으로 되돌렸습니다.');
    } catch (e) { setMsg('실패: ' + e.message); }
    setSaving(false);
  }

  return (
    <div>
      <div className="page-head">
        <div className="title">
          <h1>점수표 설정</h1>
          <p className="sub" style={{ margin: 0 }}>티어×포지션 점수를 방에 맞게 수정. {custom ? '현재 커스텀 표 사용 중.' : '현재 기본(멸망전) 표 사용 중.'}</p>
        </div>
        {canEdit ? (
          <div className="controls">
            <button className="btn ghost" onClick={reset} disabled={saving || !custom}>기본값 리셋</button>
            <button className="btn" onClick={save} disabled={saving || !table}>저장</button>
          </div>
        ) : <span className="tb-view">👀 구경 모드 · 보기 전용</span>}
      </div>
      {msg && <div className="panel" style={{ padding: '10px 16px' }}>{msg}</div>}

      {loading && <div className="panel center muted">불러오는 중…</div>}
      {table && (
        <div className="panel">
          <table className="score-editor">
            <thead>
              <tr><th className="l">티어</th>{POS.map((p) => <th key={p}>{POS_KR[p]}</th>)}</tr>
            </thead>
            <tbody>
              {TIER_ORDER.map((tier) => (
                <tr key={tier}>
                  <td className="l">{TIER_LABEL[tier]}</td>
                  {POS.map((p, i) => (
                    <td key={p}>
                      <input type="number" step="0.1" value={table[tier]?.[i] ?? ''} readOnly={!canEdit}
                        onChange={(e) => canEdit && edit(tier, i, e.target.value)} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
