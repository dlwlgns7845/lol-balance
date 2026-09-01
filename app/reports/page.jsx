'use client';
// 신고 관리 (운영자 전용) — 대상별 누적 + 최근 목록 + 상태 처리. 비공개.
import { useEffect, useState } from 'react';
import { useGroup } from '../../components/GroupProvider.jsx';
import { apiFetch } from '../../components/api.js';

const CAT = { noshow: '노쇼/잠수', troll: '트롤/대리', toxic: '비매너/욕설', other: '기타' };
const ST = { open: '접수', reviewed: '확인', dismissed: '기각', actioned: '제재' };
const fmt = (s) => { try { return new Date(s).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch { return s; } };

export default function ReportsPage() {
  const { group, role, isAdmin } = useGroup() || {};
  const gid = group?.id;
  const canView = isAdmin || role === 'owner' || role === 'editor';
  const [reports, setReports] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(null);

  async function load() {
    try {
      const r = await apiFetch('/api/reports?gid=' + gid).then((x) => x.json());
      if (!r.ok) throw new Error(r.error);
      setReports(r.reports);
    } catch (e) { setErr(e.message); }
  }
  useEffect(() => { if (gid && canView) load(); /* eslint-disable-next-line */ }, [gid, canView]);

  async function setStatus(id, status) {
    setBusy(id); setErr(null);
    try {
      const r = await apiFetch('/api/reports', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ gid, id, status }) }).then((x) => x.json());
      if (!r.ok) throw new Error(r.error);
      await load();
    } catch (e) { setErr(e.message); }
    setBusy(null);
  }

  if (!gid) return <div className="panel center muted">방에 먼저 입장하세요.</div>;
  if (!canView) return <div className="panel center muted">🔒 신고 내역은 운영자(방장·편집자)만 볼 수 있어요.</div>;
  if (!reports) return <div className="panel center muted">불러오는 중…</div>;

  // 대상별 누적(기각 제외 카운트도 함께)
  const byTarget = {};
  reports.forEach((r) => {
    const k = r.target_discord_id || r.target_name || '?';
    const t = (byTarget[k] = byTarget[k] || { name: r.target_name, id: r.target_discord_id, total: 0, open: 0 });
    t.total += 1; if (r.status !== 'dismissed') t.open += 1;
  });
  const ranked = Object.values(byTarget).sort((a, b) => b.open - a.open || b.total - a.total).slice(0, 15);
  const nameOf = (t) => t.name || (t.id ? t.id : '?');

  return (
    <div>
      <div className="page-head">
        <div className="title">
          <h1>🚨 신고 관리</h1>
          <p className="sub" style={{ margin: 0 }}>비공개 · 운영자 전용. 판단 근거로 누적돼요. 자동 제재는 없어요 — 직접 확인 후 처리하세요.</p>
        </div>
      </div>
      {err && <div className="panel err" style={{ padding: '10px 16px' }}>{err}</div>}
      {reports.length === 0 && <div className="panel center muted">접수된 신고가 없어요.</div>}

      {reports.length > 0 && (
        <>
          <div className="panel">
            <h2>누적 많은 대상 <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>· 유효(기각 제외) 기준</span></h2>
            <div className="rp-rank">
              {ranked.map((t, i) => (
                <div className="rp-rankrow" key={i}>
                  <span className="rp-rk">{i + 1}</span>
                  <b>{nameOf(t)}</b>
                  <span className="rp-count">{t.open}건{t.total !== t.open ? ` (총 ${t.total})` : ''}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="panel">
            <h2>전체 신고 <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>· 최신순</span></h2>
            <div className="rp-list">
              {reports.map((r) => (
                <div className={`rp-item st-${r.status}`} key={r.id}>
                  <div className="rp-top">
                    <span className={`rp-cat c-${r.category}`}>{CAT[r.category] || r.category}</span>
                    <b>{r.target_name || (r.target_discord_id || '?')}</b>
                    <span className={`rp-status s-${r.status}`}>{ST[r.status] || r.status}</span>
                    <span className="muted rp-time">{fmt(r.created_at)}</span>
                  </div>
                  {r.detail && <div className="rp-detail">{r.detail}</div>}
                  <div className="rp-foot">
                    <span className="muted">신고: {r.reporter_name || r.reporter_discord_id || '?'}</span>
                    <span className="rp-actions">
                      {r.status !== 'reviewed' && <button className="mini" disabled={busy === r.id} onClick={() => setStatus(r.id, 'reviewed')}>확인</button>}
                      {r.status !== 'actioned' && <button className="mini" disabled={busy === r.id} onClick={() => setStatus(r.id, 'actioned')}>제재</button>}
                      {r.status !== 'dismissed' && <button className="mini" disabled={busy === r.id} onClick={() => setStatus(r.id, 'dismissed')}>기각</button>}
                      {r.status !== 'open' && <button className="mini" disabled={busy === r.id} onClick={() => setStatus(r.id, 'open')}>되돌리기</button>}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
