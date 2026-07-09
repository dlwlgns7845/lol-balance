'use client';
// 오늘 내전 (디코 모집) — 디코 큐를 실시간 미러링(폴링). 디코에서 사람 차면 여기도 실시간 반영.
// 어드민: 강퇴/마감 → 디코 메시지도 갱신(양방향). 팀짜기: 이 명단을 밸런서로 넘김.
import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useGroup } from '../../components/GroupProvider.jsx';
import { apiFetch } from '../../components/api.js';
import { arraysToRoles } from '../../components/PositionToggles.jsx';
import { tierClass } from '../../src/table.js';
import Avatar from '../../components/Avatar.jsx';

const LANES = ['top', 'jungle', 'mid', 'adc', 'sup'];
const LANE_KR = { top: '탑', jungle: '정글', mid: '미드', adc: '원딜', sup: '서폿' };
const ROSTER_KEY = 'lol-balance-roster';
// 부라인 라벨: 큐에서 고른 부라인 우선, 없으면 사람관리 등록 부라인. 올라운더/부배치는 태그로 이미 표시.
const subText = (sub) => (sub === 'all' ? 'ALL' : String(sub).split(',').map((l) => LANE_KR[l] || l).join('/'));
const subLabel = (p) => {
  if (p.all) return null;
  if (p.sub) return `부:${subText(p.sub)}`; // 큐에서 고른 부라인(여러 개)
  return null;
};

export default function RecruitPage() {
  const { group, isAdmin } = useGroup();
  const gid = group?.id;
  const router = useRouter();
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [persons, setPersons] = useState([]);
  const [addP, setAddP] = useState(''); // 추가할 사람 id
  const [addMain, setAddMain] = useState('top');
  const [addSub, setAddSub] = useState([]); // 받을 라인 여러 개
  const timer = useRef(null);

  const load = useCallback(async () => {
    if (!gid) return;
    try {
      const r = await fetch(`/api/recruit?gid=${gid}`).then((x) => x.json());
      if (r.ok) { setData(r); setErr(null); } else setErr(r.error);
    } catch (e) { setErr(e.message); }
  }, [gid]);

  useEffect(() => {
    load();
    timer.current = setInterval(load, 2500); // 실시간 미러(2.5초 폴링)
    return () => clearInterval(timer.current);
  }, [load]);

  useEffect(() => { // 어드민용: 큐에 추가할 등록 선수 목록
    if (!gid || !isAdmin) return;
    fetch(`/api/persons?gid=${gid}`).then((x) => x.json()).then((r) => { if (r.ok) setPersons(r.persons || []); }).catch(() => {});
  }, [gid, isAdmin]);

  const act = async (body) => {
    setBusy(true);
    try {
      const r = await apiFetch('/api/recruit/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((x) => x.json());
      if (!r.ok) alert('실패: ' + r.error);
      await load();
    } finally { setBusy(false); }
  };

  const queue = data?.queue;
  const placed = queue ? LANES.reduce((a, l) => a + (data.lanes[l]?.length || 0), 0) : 0;
  const full = queue && placed === queue.size;

  const toBalancer = () => {
    if (!queue) return;
    const roster = [];
    LANES.forEach((l) => (data.lanes[l] || []).forEach((p) => {
      roster.push({ name: p.name, tier: p.tier || 'G2', roles: arraysToRoles([l], []) }); // 배정 라인=주라인
    }));
    if (!roster.length) return;
    try { localStorage.setItem(ROSTER_KEY, JSON.stringify(roster)); } catch { /* noop */ }
    router.push('/balancer'); // 밸런서가 mount 시 로컬스토리지 로스터를 읽음
  };

  return (
    <div className="content" style={{ maxWidth: 1000 }}>
      <div className="rc-head">
        <h1 style={{ margin: 0 }}>🎮 오늘 내전 <span className="muted" style={{ fontSize: 14, fontWeight: 400 }}>디코 모집 실시간</span></h1>
        {queue && <span className={`rc-count${full ? ' full' : ''}`}>{placed}/{queue.size}</span>}
      </div>

      {err && <p className="rc-err">불러오기 오류: {err}</p>}

      {!queue && (
        <div className="rc-empty">
          <p>열린 모집이 없어요.</p>
          <p className="muted">디스코드에서 <code>/모집</code> (또는 <code>/모집 인원:20</code>) 으로 시작하면 여기 실시간으로 떠요.</p>
        </div>
      )}

      {queue && (
        <>
          <div className="rc-lanes">
            {LANES.map((l) => {
              const list = data.lanes[l] || [];
              const N = data.slotsPerLane;
              return (
                <div key={l} className={`rc-lane${list.length >= N ? ' done' : ''}`}>
                  <div className="rc-lane-h"><b>{LANE_KR[l]}</b><span className="muted">{list.length}/{N}</span></div>
                  <div className="rc-slots">
                    {list.map((p) => (
                      <div key={p.id} className="rc-player">
                        <Avatar name={p.name} profile={p.profile} size={24} />
                        <div className="rc-p-info">
                          <span className="rc-nm">{p.name}{p.off && <span className="rc-off">부</span>}{p.all && <span className="rc-off">올</span>}</span>
                          <span className="rc-meta">
                            <span className={`rc-ti ${tierClass(p.tier)}`}>{p.tier || '?'}</span>
                            {subLabel(p) && <span className="rc-sub">{subLabel(p)}</span>}
                          </span>
                        </div>
                        {isAdmin && (
                          <div className="rc-ctrl">
                            <select className="rc-move" value={p.main} disabled={busy} title="라인 이동"
                              onChange={(e) => act({ queueId: queue.id, action: 'move', signupId: p.id, main: e.target.value })}>
                              {LANES.map((L) => <option key={L} value={L}>{LANE_KR[L]}</option>)}
                              <option value="all">ALL</option>
                            </select>
                            <button className="rc-kick" disabled={busy} onClick={() => act({ queueId: queue.id, action: 'kick', signupId: p.id })} title="강퇴">✕</button>
                          </div>
                        )}
                      </div>
                    ))}
                    {Array.from({ length: Math.max(0, N - list.length) }).map((_, k) => <div key={'e' + k} className="rc-player empty">—</div>)}
                  </div>
                </div>
              );
            })}
          </div>

          {data.waitlist?.length > 0 && (
            <div className="rc-wait">
              <b>⏳ 대기 ({data.waitlist.length})</b>
              <div className="rc-slots">
                {data.waitlist.map((p) => (
                  <div key={p.id} className="rc-player">
                    <Avatar name={p.name} profile={p.profile} size={20} />
                    <span className="rc-nm">{p.name}</span>
                    <span className="muted" style={{ fontSize: 11 }}>받는 라인: {p.main === 'all' ? 'ALL' : [LANE_KR[p.main], ...(p.sub ? subText(p.sub).split('/') : [])].join('/')}</span>
                    {isAdmin && <button className="rc-kick" disabled={busy} onClick={() => act({ queueId: queue.id, action: 'kick', signupId: p.id })} title="강퇴">✕</button>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {isAdmin && (
            <div className="rc-add">
              <b>➕ 사람 추가</b>
              <select value={addP} onChange={(e) => setAddP(e.target.value)}>
                <option value="">— 선수 선택 —</option>
                {persons.map((p) => <option key={p.id} value={p.id}>{p.nickname || p.display_name}{p.discord_id ? '' : ' (미연동)'}</option>)}
              </select>
              <select value={addMain} onChange={(e) => setAddMain(e.target.value)}>
                {LANES.map((l) => <option key={l} value={l}>주:{LANE_KR[l]}</option>)}
                <option value="all">주:ALL (아무 라인)</option>
              </select>
              <span className="rc-sub-pick">
                <span className="muted" style={{ fontSize: 11 }}>받는 라인(여러 개):</span>
                {LANES.map((l) => (
                  <button key={l} type="button" disabled={addMain !== 'all' && l === addMain}
                    className={`rc-sub-chip${addSub.includes(l) ? ' on' : ''}`}
                    onClick={() => setAddSub((s) => (s.includes(l) ? s.filter((x) => x !== l) : [...s, l]))}>
                    {LANE_KR[l]}
                  </button>
                ))}
              </span>
              <button className="btn ghost" disabled={busy || !addP} onClick={() => { const subs = addSub.filter((l) => l !== addMain); act({ queueId: queue.id, action: 'add', personId: addP, main: addMain, sub: subs.length ? subs.join(',') : null }).then(() => { setAddP(''); setAddSub([]); }); }}>추가</button>
            </div>
          )}

          <div className="rc-actions">
            <button className="btn primary" disabled={!full} onClick={toBalancer} title={full ? '이 명단으로 팀 짜기' : '아직 인원이 다 안 찼어요'}>
              ⚔️ 이 명단으로 팀 짜기 {!full && `(${placed}/${queue.size})`}
            </button>
            {isAdmin && <button className="btn ghost" disabled={busy} onClick={() => { if (confirm('모집을 마감할까요? (디코 버튼도 사라짐)')) act({ queueId: queue.id, action: 'close' }); }}>🔒 마감</button>}
            <span className="muted" style={{ fontSize: 12 }}>2.5초마다 자동 갱신 · 디코와 실시간 동기화</span>
          </div>
        </>
      )}

      <style>{`
        .rc-head{display:flex;align-items:center;gap:12px;margin-bottom:16px}
        .rc-count{margin-left:auto;font-weight:700;font-size:18px;padding:4px 12px;border-radius:999px;background:#2a2a33;color:#bbb}
        .rc-count.full{background:#1f7a3f;color:#fff}
        .rc-err{color:#e88}
        .rc-empty{padding:40px;text-align:center;background:#1c1c22;border-radius:12px}
        .rc-empty code{background:#2a2a33;padding:2px 6px;border-radius:5px}
        .rc-lanes{display:grid;grid-template-columns:repeat(5,1fr);gap:10px}
        .rc-lane{background:#1c1c22;border-radius:10px;padding:10px;border:1px solid #2a2a33}
        .rc-lane.done{border-color:#1f7a3f}
        .rc-lane-h{display:flex;justify-content:space-between;margin-bottom:8px;font-size:14px}
        .rc-slots{display:flex;flex-direction:column;gap:6px}
        .rc-player{display:flex;align-items:center;gap:7px;background:#26262e;border-radius:7px;padding:6px 8px}
        .rc-player.empty{color:#555;justify-content:center;background:transparent;border:1px dashed #33333c;min-height:34px}
        .rc-p-info{display:flex;flex-direction:column;min-width:0;flex:1;gap:1px}
        .rc-nm{font-weight:600;font-size:12.5px;display:flex;align-items:center;gap:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        .rc-meta{display:flex;align-items:center;gap:5px;font-size:10.5px;white-space:nowrap;overflow:hidden}
        .rc-ti{font-weight:700}
        .rc-sub{color:#9fc0cf;background:#2c333b;border-radius:4px;padding:0 4px}
        .rc-off{font-size:9px;background:#7a5a1f;color:#fff;border-radius:4px;padding:1px 4px}
        .rc-ctrl{display:flex;align-items:center;gap:3px;flex-shrink:0}
        .rc-move{background:#2a2a33;color:#bbb;border:1px solid #33333c;border-radius:5px;font-size:11px;padding:2px 3px;max-width:52px}
        .rc-kick{background:none;border:none;color:#c66;cursor:pointer;font-size:12px;padding:0 2px}
        .rc-wait{margin-top:14px;background:#1c1c22;border-radius:10px;padding:12px}
        .rc-wait .rc-slots{flex-direction:row;flex-wrap:wrap;margin-top:8px}
        .rc-add{display:flex;align-items:center;gap:8px;margin-top:16px;flex-wrap:wrap;background:#1c1c22;border-radius:10px;padding:10px 12px}
        .rc-add select{background:#26262e;color:#ddd;border:1px solid #33333c;border-radius:6px;padding:5px 8px;font-size:13px}
        .rc-sub-pick{display:flex;align-items:center;gap:5px;flex-wrap:wrap}
        .rc-sub-chip{background:#26262e;color:#bbb;border:1px solid #33333c;border-radius:6px;padding:4px 9px;font-size:12px;cursor:pointer}
        .rc-sub-chip.on{background:#2f6b8a;color:#fff;border-color:#4fb6d6}
        .rc-sub-chip:disabled{opacity:.3;cursor:default}
        .rc-player .champ-ph,.rc-player>span:first-child{flex-shrink:0}
        .rc-actions{display:flex;align-items:center;gap:10px;margin-top:20px;flex-wrap:wrap}
      `}</style>
    </div>
  );
}
