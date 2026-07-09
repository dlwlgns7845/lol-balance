'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useGroup } from '../../components/GroupProvider.jsx';
import { apiFetch } from '../../components/api.js';
import { useDdragon } from '../../components/ddragon.js';

// 가능한 고해상도 유지 (아주 클 때만 다운스케일)
function resizeToDataUrl(file, maxW = 1920) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxW / img.width);
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/jpeg', 0.92));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

export default function RecordPage() {
  const { group, canEdit } = useGroup();
  const gid = group?.id;
  const dd = useDdragon();
  // 화면에 보인 챔프명(한글/영문/오타) → Data Dragon 정식 ID. 못 찾으면 원문 유지(수동 수정).
  const resolveChamp = (c) => (dd.id && dd.id(c)) || c;
  const [persons, setPersons] = useState([]);
  const [dataUrl, setDataUrl] = useState(null);
  const [rows, setRows] = useState([]);
  const [winner, setWinner] = useState('A');
  const [durationMin, setDurationMin] = useState(0);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);
  const [msg, setMsg] = useState(null);
  const [champList, setChampList] = useState([]);
  const [editing, setEditing] = useState(false); // 기존 경기 수정 모드
  const fileRef = useRef();
  const searchParams = useSearchParams();
  const editId = searchParams.get('edit');

  useEffect(() => {
    if (gid) fetch('/api/persons?gid=' + gid).then((x) => x.json()).then((r) => r.ok && setPersons(r.persons));
  }, [gid]);

  // ?edit=<matchId> → 기존 경기 불러와 프리필
  useEffect(() => {
    if (!gid || !editId) return;
    apiFetch(`/api/matches/${editId}?gid=${gid}`).then((x) => x.json()).then((r) => {
      if (!r.ok) { setErr('불러오기 실패: ' + r.error); return; }
      const mm = r.match;
      setRows(mm.participants.map((p) => ({
        team: p.team === 'B' ? 2 : 1, name: p.name, champion: p.champion,
        k: p.k, d: p.d, a: p.a, damage: p.damage, cs: p.cs, personId: p.person_id || '__new__',
      })));
      setWinner(mm.winner); setDurationMin(mm.durationMin || 0); setEditing(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gid, editId]);

  // 수동 입력: 빈 10칸(1팀 5 + 2팀 5)
  function manualEntry() {
    setErr(null); setMsg(null); setEditing(false); setDataUrl(null);
    const empty = (team) => ({ team, name: '', champion: '', k: 0, d: 0, a: 0, damage: 0, cs: 0, personId: '__new__' });
    setRows([...[1, 1, 1, 1, 1].map(() => empty(1)), ...[2, 2, 2, 2, 2].map(() => empty(2))]);
    setWinner('A'); setDurationMin(0);
  }

  useEffect(() => {
    fetch('https://ddragon.leagueoflegends.com/api/versions.json').then((r) => r.json())
      .then((v) => fetch(`https://ddragon.leagueoflegends.com/cdn/${v[0]}/data/en_US/champion.json`).then((r) => r.json()))
      .then((d) => setChampList(Object.values(d.data).map((c) => c.name).sort()))
      .catch(() => {});
  }, []);

  // 인게임 닉 정규화: 투명 방향문자·#태그 제거 + 공백·대소문자 무시 (Riot ID의 U+2066 등 대응)
  const gamePart = (s) => (s || '').replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, '').split('#')[0].toLowerCase().replace(/\s+/g, '');
  // 편집거리 (한글 닉 OCR 오차 보정)
  function lev(a, b) {
    const m = a.length, n = b.length;
    if (!m) return n; if (!n) return m;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++) {
        const c = a[i - 1] === b[j - 1] ? 0 : 1;
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + c);
      }
      prev = cur;
    }
    return prev[n];
  }
  const candStrings = (p) =>
    [p.display_name, p.nickname, ...(p.accounts || []).map((a) => a.game_name)].filter(Boolean).map(gamePart);
  function matchPersonId(name, list) {
    const n = gamePart(name);
    if (!n) return '__new__';
    // 1) 정확 매칭
    const exact = list.find((p) => candStrings(p).some((c) => c === n));
    if (exact) return exact.id;
    // 2) 퍼지 매칭: 편집거리 최소 & 임계 이내 & 유일하게 가까울 때만 (오독 보정, 오매칭 방지)
    const maxDist = n.length <= 4 ? 1 : 2;
    let best = null, bestD = 99, second = 99;
    for (const p of list) {
      const d = Math.min(99, ...candStrings(p).map((c) => lev(n, c)));
      if (d < bestD) { second = bestD; bestD = d; best = p; }
      else if (d < second) second = d;
    }
    if (best && bestD <= maxDist && bestD < second) return best.id;
    return '__new__';
  }
  function matchPerson(name) { return matchPersonId(name, persons); }

  // 사람 목록이 (스샷 분석 후) 늦게 로드돼도 아직 신규(__new__)인 행을 재매칭
  useEffect(() => {
    if (!rows.length || !persons.length) return;
    setRows((rs) => rs.map((r) => (r.personId === '__new__' ? { ...r, personId: matchPersonId(r.name, persons) } : r)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persons]);

  async function onFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setErr(null); setMsg(null); setRows([]);
    setDataUrl(await resizeToDataUrl(f));
  }

  async function analyze() {
    if (!dataUrl) return;
    setErr(null); setMsg(null); setLoading(true);
    try {
      const r = await apiFetch('/api/extract', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gid, image: dataUrl }),
      }).then((x) => x.json());
      if (!r.ok) throw new Error(r.error);
      const flat = []; let winTeam = 1;
      for (const t of r.data.teams || []) {
        if (t.win) winTeam = t.team;
        for (const p of t.players || []) {
          flat.push({ team: t.team, name: p.name || '', champion: resolveChamp(p.champion || ''),
            k: p.k ?? 0, d: p.d ?? 0, a: p.a ?? 0, damage: p.damage ?? 0, cs: p.cs ?? 0,
            personId: matchPerson(p.name) });
        }
      }
      if (flat.length !== 10) throw new Error(`10명이 아니라 ${flat.length}명 추출됨 — 스샷 다시 확인`);
      setRows(flat);
      setWinner(winTeam === 2 ? 'B' : 'A');
      setDurationMin(r.data.durationMin || 0);
    } catch (e) { setErr('분석 실패: ' + e.message); }
    setLoading(false);
  }

  function editRow(i, patch) { setRows((r) => r.map((x, idx) => (idx === i ? { ...x, ...patch } : x))); }

  async function save(force = false) {
    // 수동/수정: 빈 이름 신규가 있으면 안내
    if (rows.some((r) => (!r.personId || r.personId === '__new__') && !(r.name || '').trim())) {
      setErr('모든 자리에 사람을 선택하거나 이름을 입력하세요.'); return;
    }
    setSaving(true); setErr(null); setMsg(null);
    try {
      const participants = rows.map((r) => {
        const base = { team: r.team === 2 ? 'B' : 'A', champion: resolveChamp(r.champion),
          k: Number(r.k), d: Number(r.d), a: Number(r.a), damage: Number(r.damage), cs: Number(r.cs) };
        return r.personId && r.personId !== '__new__'
          ? { ...base, person_id: r.personId }
          : { ...base, name: r.name, tier: 'G2' };
      });
      if (editing) {
        const res = await apiFetch(`/api/matches/${editId}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ group_id: gid, winner, participants, durationMin }),
        }).then((x) => x.json());
        if (!res.ok) throw new Error(res.error);
        setMsg('수정 완료 — 통계·전적 반영됨.');
        setRows([]); setEditing(false);
        setSaving(false);
        return;
      }
      const res = await apiFetch('/api/matches', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ group_id: gid, winner, participants, force, durationMin }),
      }).then((x) => x.json());
      if (!res.ok) throw new Error(res.error);
      if (res.duplicate) {
        setSaving(false);
        if (window.confirm('이미 저장된 경기와 거의 같아요 (중복으로 보임). 그래도 저장할까요?')) {
          return save(true);
        }
        setErr('중복으로 판단되어 저장하지 않았어요. 같은 경기라면 다시 올릴 필요 없어요.');
        return;
      }
      setMsg('저장 완료 — 통계·전적 반영됨.');
      setRows([]); setDataUrl(null); if (fileRef.current) fileRef.current.value = '';
    } catch (e) { setErr(editing ? '수정 실패: ' + e.message : '저장 실패: ' + e.message); }
    setSaving(false);
  }

  if (group && !canEdit) return (
    <div>
      <h1>경기 기록 (스크린샷)</h1>
      <div className="panel center muted" style={{ padding: '26px 0' }}>
        👀 구경 모드예요. 경기 기록은 <b>편집 권한</b>이 있어야 올릴 수 있어요. 방장에게 권한을 요청하세요.
      </div>
    </div>
  );

  return (
    <div>
      <h1>{editing ? '경기 수정' : '경기 기록'}</h1>
      <p className="sub">
        {editing ? '저장된 경기의 값을 고치고 수정 저장하세요.'
          : '스샷 올려서 AI 자동추출하거나, 수동 입력으로 직접 기록할 수 있어요.'}
      </p>

      {editing ? (
        <div className="panel" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span>✏️ <b>경기 수정 중</b> — 아래 표에서 값을 고치고 저장하세요.</span>
          <Link href="/" className="btn ghost" style={{ marginLeft: 'auto' }}>취소</Link>
        </div>
      ) : (
        <div className="panel">
          <div className="controls">
            <input ref={fileRef} type="file" accept="image/*" onChange={onFile} style={{ width: 'auto' }} />
            <button className="btn" onClick={analyze} disabled={!dataUrl || loading}>{loading ? 'AI 분석 중…' : 'AI 분석'}</button>
            {dataUrl && <span className="muted">이미지 준비됨</span>}
            <button className="btn ghost" style={{ marginLeft: 'auto' }} onClick={manualEntry} title="스샷 없이 직접 10명 입력">✏️ 수동 입력</button>
          </div>
          {err && <div className="err">{err}</div>}
          {msg && <div className="seed-status" style={{ fontSize: 13 }}>✓ {msg} — <Link href="/" className="accent">통계 보기</Link></div>}
        </div>
      )}
      {editing && err && <div className="panel err" style={{ padding: '10px 16px' }}>{err}</div>}
      {editing && msg && <div className="panel" style={{ padding: '10px 16px' }}>✓ {msg} — <Link href="/" className="accent">통계 보기</Link></div>}

      {rows.length === 10 && (
        <div className="panel">
          <div className="controls" style={{ marginBottom: 12 }}>
            <span>승리 팀 <span className="muted" style={{ fontSize: 11 }}>(눌러서 선택)</span>:</span>
            <button className={`mini ${winner === 'A' ? 'on' : ''}`} onClick={() => setWinner('A')}>1팀(A) 승</button>
            <button className={`mini ${winner === 'B' ? 'on' : ''}`} onClick={() => setWinner('B')}>2팀(B) 승</button>
            <span className="muted" style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
              게임 시간
              <input type="number" value={durationMin} onChange={(e) => setDurationMin(Number(e.target.value))}
                style={{ width: 56 }} title="분당 CS 계산용 — 틀리면 수정" />분
            </span>
            <button className="btn" onClick={() => save()} disabled={saving}>{saving ? (editing ? '수정 중…' : '저장 중…') : (editing ? '수정 저장' : '저장')}</button>
          </div>
          <table className="rec-table">
            <thead>
              <tr><th>팀</th><th className="l">닉/이름</th><th className="l">→ 사람</th><th>챔피언</th><th>K</th><th>D</th><th>A</th><th>딜량</th><th>CS</th></tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className={r.team === (winner === 'A' ? 1 : 2) ? 'win' : ''}>
                  <td>{r.team}</td>
                  <td className="l">{r.name}</td>
                  <td className="l">
                    <select value={r.personId} onChange={(e) => editRow(i, { personId: e.target.value })}>
                      <option value="__new__">+ 신규 등록 ({r.name})</option>
                      {persons.map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}
                    </select>
                  </td>
                  <td><input list="champ-list" value={r.champion} onChange={(e) => editRow(i, { champion: e.target.value })} style={{ width: 110 }} /></td>
                  {['k', 'd', 'a', 'damage', 'cs'].map((f) => (
                    <td key={f}><input type="number" value={r[f]} onChange={(e) => editRow(i, { [f]: e.target.value })} style={{ width: f === 'k' || f === 'd' || f === 'a' ? 44 : 84 }} /></td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <datalist id="champ-list">{champList.map((c) => <option key={c} value={c} />)}</datalist>
          <p className="hint">
            챔피언은 스샷에 이름이 적혀 있어 AI가 바로 읽어요. 틀린 값만 고치고 저장하세요. 사람은 닉 같으면 자동 선택, 신규는 자동 등록(<Link href="/people" className="accent">멤버 관리</Link>에서 합치기).
          </p>
        </div>
      )}
    </div>
  );
}
