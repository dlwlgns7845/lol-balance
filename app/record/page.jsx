'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useGroup } from '../../components/GroupProvider.jsx';
import { apiFetch } from '../../components/api.js';
import { useDdragon } from '../../components/ddragon.js';
import { parseRofl } from '../../components/rofl.js';

const REGIONS = ['NA', 'KR', 'EUW', 'EUNE', 'BR', 'JP', 'OCE', 'LAN', 'LAS', 'TR', 'RU'];
const POS = ['top', 'jungle', 'mid', 'adc', 'sup'];       // 팀 내 순서 = 탑/정글/미드/원딜/서폿
const POS_KR = { top: '탑', jungle: '정글', mid: '미드', adc: '원딜', sup: '서폿' };
const posByIdx = (i) => POS[i % 5]; // rows = [1팀5 + 2팀5] → 팀 내 인덱스로 기본 포지션

export default function RecordPage() {
  const { group, canRecord } = useGroup();
  const gid = group?.id;
  const dd = useDdragon();
  // 화면에 보인 챔프명(한글/영문/오타) → Data Dragon 정식 ID. 못 찾으면 원문 유지(수동 수정).
  const resolveChamp = (c) => (dd.id && dd.id(c)) || c;
  const [persons, setPersons] = useState([]);
  const [objectives, setObjectives] = useState(null); // 리플 팀 오브젝트 (리플일 때만)
  const [source, setSource] = useState(null);         // 'replay' | 'manual' (스샷 제거됨)
  const roflRef = useRef();
  const [rows, setRows] = useState([]);
  const [playedAt, setPlayedAt] = useState(null); // 리플 저장시각 = 게임 날짜
  const [region, setRegion] = useState('NA'); // 새 사람 티어 자동조회 지역
  const [batch, setBatch] = useState([]);      // 일괄: 파싱된 경기들
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkResult, setBulkResult] = useState(null);
  const bulkRef = useRef();
  const [winner, setWinner] = useState('A');
  const [durationSec, setDurationSec] = useState(0); // 게임 시간(초) — 단일 소스, 표시·저장
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);
  const [msg, setMsg] = useState(null);
  const [champList, setChampList] = useState([]);
  const [editing, setEditing] = useState(false); // 기존 경기 수정 모드
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
      setRows(mm.participants.map((p, i) => ({
        team: p.team === 'B' ? 2 : 1, name: p.name, champion: p.champion,
        position: p.position || posByIdx(i), // 저장된 포지션 우선, 없으면 순서 기본값
        k: p.k, d: p.d, a: p.a, damage: p.damage, cs: p.cs, personId: p.person_id || '__new__',
      })));
      setWinner(mm.winner); setDurationSec(mm.durationSec ?? (mm.durationMin || 0) * 60); setEditing(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gid, editId]);

  // 수동 입력: 빈 10칸(1팀 5 + 2팀 5)
  function manualEntry() {
    setErr(null); setMsg(null); setEditing(false);
    const empty = (team, position) => ({ team, position, name: '', champion: '', k: 0, d: 0, a: 0, damage: 0, cs: 0, personId: '__new__' });
    setRows([...POS.map((p) => empty(1, p)), ...POS.map((p) => empty(2, p))]);
    setWinner('A'); setDurationSec(0); setSource('manual'); setObjectives(null);
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
  // 라이엇ID(게임명#태그) → 사람. 계정(game_name+tag_line) 정확매칭 우선, 없으면 이름 매칭 폴백.
  function matchByRiot(gameName, tag) {
    const norm = (s) => (s || '').toLowerCase().replace(/\s+/g, '');
    const g = norm(gameName), t = norm(tag);
    const p = persons.find((pp) => (pp.accounts || []).some((a) => norm(a.game_name) === g && (!t || norm(a.tag_line) === t)));
    return p ? p.id : matchPersonId(gameName, persons);
  }

  // 🎬 리플(.rofl) 업로드 → 브라우저에서 파싱 → 표 자동채움 + 사람 자동매핑 + 오브젝트 캡처
  async function onRofl(e) {
    const file = e.target.files?.[0]; if (!file) return;
    setErr(null); setMsg(null); setEditing(false); setLoading(true);
    try {
      const { players, winner: w, objectives: obj, durationSec: dsec } = await parseRofl(file);
      const ord = { top: 0, jungle: 1, mid: 2, adc: 3, sup: 4 };
      const sorted = [...players].sort((a, b) => (a.team === b.team ? (ord[a.position] ?? 9) - (ord[b.position] ?? 9) : (a.team === 'A' ? -1 : 1)));
      setRows(sorted.map((p) => ({
        team: p.team === 'B' ? 2 : 1, name: p.riotId, champion: p.champion, position: p.position || 'top',
        k: p.k, d: p.d, a: p.a, damage: p.damage, cs: p.cs, gold: p.gold,
        personId: matchByRiot(p.gameName, p.tag), detail: p.detail,
      })));
      setObjectives(obj); setSource('replay'); setWinner(w); setDurationSec(dsec);
      setPlayedAt(file.lastModified ? new Date(file.lastModified).toISOString() : null); // 리플 저장시각 = 게임일
      setMsg('리플 분석 완료 — 사람·포지션 확인하고 저장하세요.');
    } catch (er) { setErr('리플 분석 실패: ' + er.message); }
    setLoading(false);
    if (roflRef.current) roflRef.current.value = '';
  }

  // 사람 목록이 (스샷 분석 후) 늦게 로드돼도 아직 신규(__new__)인 행을 재매칭
  useEffect(() => {
    if (!rows.length || !persons.length) return;
    setRows((rs) => rs.map((r) => (r.personId === '__new__' ? { ...r, personId: matchPersonId(r.name, persons) } : r)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persons]);

  function editRow(i, patch) { setRows((r) => r.map((x, idx) => (idx === i ? { ...x, ...patch } : x))); }

  async function save(force = false) {
    // 수동/수정: 빈 이름 신규가 있으면 안내
    if (rows.some((r) => (!r.personId || r.personId === '__new__') && !(r.name || '').trim())) {
      setErr('모든 자리에 사람을 선택하거나 이름을 입력하세요.'); return;
    }
    setSaving(true); setErr(null); setMsg(null);
    try {
      // 새로 등록될 사람들: 롤닉(#태그)으로 티어 자동조회 → 골드2 고정 대신 실티어 배정 (best-effort)
      const newRows = rows.filter((r) => (!r.personId || r.personId === '__new__') && (r.name || '').includes('#'));
      const tierByName = {};
      if (newRows.length) {
        setMsg('새 선수 티어 조회 중…');
        await Promise.all(newRows.map(async (r) => {
          const [gn, tg] = (r.name || '').split('#');
          if (!gn || !tg) return;
          try {
            const prof = await fetch(`/api/seed?name=${encodeURIComponent(gn.trim())}&tag=${encodeURIComponent(tg.trim())}&region=${region}`).then((x) => x.json());
            if (prof && prof.found) tierByName[r.name] = prof.suggestedTier || prof.curHighTier || prof.peakTier || null;
          } catch { /* 조회 실패 → 골드2 폴백 */ }
        }));
        setMsg(null);
      }
      // 팀별 포지션 순(탑→정글→미드→원딜→서폿)으로 정렬 → 저장 slot·표시 순서가 포지션과 일치
      const ordered = [...rows].sort((a, b) => (a.team - b.team) || (POS.indexOf(a.position) - POS.indexOf(b.position)));
      const participants = ordered.map((r) => {
        const base = { team: r.team === 2 ? 'B' : 'A', champion: resolveChamp(r.champion), position: r.position || null,
          k: Number(r.k), d: Number(r.d), a: Number(r.a), damage: Number(r.damage), cs: Number(r.cs),
          gold: r.gold != null ? Number(r.gold) : null, detail: r.detail ?? null };
        return r.personId && r.personId !== '__new__'
          ? { ...base, person_id: r.personId }
          : { ...base, name: r.name, tier: tierByName[r.name] || 'G2' };
      });
      if (editing) {
        const res = await apiFetch(`/api/matches/${editId}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ group_id: gid, winner, participants, durationSec }),
        }).then((x) => x.json());
        if (!res.ok) throw new Error(res.error);
        setMsg('수정 완료 — 통계·전적 반영됨.');
        setRows([]); setEditing(false);
        setSaving(false);
        return;
      }
      const res = await apiFetch('/api/matches', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ group_id: gid, winner, participants, force, durationSec, objectives, source, played_at: playedAt }),
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
      setRows([]); if (roflRef.current) roflRef.current.value = '';
    } catch (e) { setErr(editing ? '수정 실패: ' + e.message : '저장 실패: ' + e.message); }
    setSaving(false);
  }

  // 📦 일괄: 여러 .rofl 파싱 → 검토 목록(날짜순) → 아래 "전체 저장"
  async function onBulk(e) {
    const files = [...(e.target.files || [])];
    if (!files.length) return;
    setErr(null); setBulkResult(null); setLoading(true);
    const ord = { top: 0, jungle: 1, mid: 2, adc: 3, sup: 4 };
    const parsed = [];
    for (const f of files) {
      try {
        const { players, winner: w, objectives: obj, durationSec: dsec } = await parseRofl(f);
        const sorted = [...players].sort((a, b) => (a.team === b.team ? (ord[a.position] ?? 9) - (ord[b.position] ?? 9) : (a.team === 'A' ? -1 : 1)));
        parsed.push({
          id: f.name + f.lastModified, fileName: f.name,
          played_at: f.lastModified ? new Date(f.lastModified).toISOString() : null,
          winner: w, durationSec: dsec, objectives: obj, source: 'replay',
          rows: sorted.map((p) => ({ team: p.team === 'B' ? 2 : 1, name: p.riotId, champion: p.champion, position: p.position || 'top', k: p.k, d: p.d, a: p.a, damage: p.damage, cs: p.cs, gold: p.gold, personId: matchByRiot(p.gameName, p.tag), detail: p.detail })),
        });
      } catch (er) { parsed.push({ id: f.name + f.lastModified, fileName: f.name, error: er.message }); }
    }
    parsed.sort((a, b) => new Date(a.played_at || 0) - new Date(b.played_at || 0)); // 오래된 것 → 최신
    setBatch(parsed); setLoading(false);
    if (bulkRef.current) bulkRef.current.value = '';
  }

  async function saveBatch() {
    setBulkBusy(true); setErr(null);
    const results = [];
    for (const m of batch) {
      if (m.error) { results.push({ file: m.fileName, status: 'parse_error' }); continue; }
      // 새 선수 티어 자동조회
      const newRows = m.rows.filter((r) => (!r.personId || r.personId === '__new__') && (r.name || '').includes('#'));
      const tierByName = {};
      await Promise.all(newRows.map(async (r) => {
        const [gn, tg] = (r.name || '').split('#'); if (!gn || !tg) return;
        try { const prof = await fetch(`/api/seed?name=${encodeURIComponent(gn.trim())}&tag=${encodeURIComponent(tg.trim())}&region=${region}`).then((x) => x.json()); if (prof && prof.found) tierByName[r.name] = prof.suggestedTier || prof.curHighTier || prof.peakTier || null; } catch { /* 폴백 G2 */ }
      }));
      const ordered = [...m.rows].sort((a, b) => (a.team - b.team) || (POS.indexOf(a.position) - POS.indexOf(b.position)));
      const participants = ordered.map((r) => {
        const base = { team: r.team === 2 ? 'B' : 'A', champion: resolveChamp(r.champion), position: r.position || null, k: Number(r.k), d: Number(r.d), a: Number(r.a), damage: Number(r.damage), cs: Number(r.cs), gold: r.gold != null ? Number(r.gold) : null, detail: r.detail ?? null };
        return r.personId && r.personId !== '__new__' ? { ...base, person_id: r.personId } : { ...base, name: r.name, tier: tierByName[r.name] || 'G2' };
      });
      try {
        const res = await apiFetch('/api/matches', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ group_id: gid, winner: m.winner, participants, durationSec: m.durationSec, objectives: m.objectives, source: m.source, played_at: m.played_at, force: false }) }).then((x) => x.json());
        results.push({ file: m.fileName, status: !res.ok ? 'error' : res.duplicate ? 'dup' : 'saved', msg: res.error });
      } catch (er) { results.push({ file: m.fileName, status: 'error', msg: er.message }); }
    }
    setBulkResult(results); setBatch([]); setBulkBusy(false);
  }

  if (group && !canRecord) return (
    <div>
      <h1>경기 기록</h1>
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
          : '게임 후 저장된 .rofl 리플 파일을 올리면 자동 추출돼요. 수동 입력도 가능해요.'}
      </p>

      {editing ? (
        <div className="panel" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span>✏️ <b>경기 수정 중</b> — 아래 표에서 값을 고치고 저장하세요.</span>
          <Link href="/" className="btn ghost" style={{ marginLeft: 'auto' }}>취소</Link>
        </div>
      ) : (
        <div className="panel">
          <div className="controls">
            <span className="muted" style={{ fontSize: 12 }}>🎬 리플:</span>
            <input ref={roflRef} type="file" accept=".rofl" onChange={onRofl} disabled={loading} style={{ width: 'auto' }} />
            <span className="muted" style={{ fontSize: 12 }}>│ 📦 일괄:</span>
            <input ref={bulkRef} type="file" accept=".rofl" multiple onChange={onBulk} disabled={loading} style={{ width: 'auto' }} title="여러 리플 한 번에 — 검토 후 아래 '전체 저장'" />
            {loading && <span className="muted">분석 중…</span>}
            <span className="muted" style={{ fontSize: 11 }}>게임 후 저장된 <code>.rofl</code> 넣으면 자동 추출. 일괄은 날짜(파일 저장시각)순 정렬</span>
            <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span className="muted" style={{ fontSize: 11 }}>새 선수 티어 조회 지역</span>
              <select value={region} onChange={(e) => setRegion(e.target.value)} title="새로 등록될 선수의 티어를 이 지역 기준으로 자동 조회" style={{ fontSize: 12 }}>{REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}</select>
            </span>
            <button className="btn ghost" onClick={manualEntry} title="리플 없이 직접 10명 입력">✏️ 수동 입력</button>
          </div>
          {err && <div className="err">{err}</div>}
          {msg && <div className="seed-status" style={{ fontSize: 13 }}>✓ {msg} — <Link href="/" className="accent">통계 보기</Link></div>}
        </div>
      )}
      {editing && err && <div className="panel err" style={{ padding: '10px 16px' }}>{err}</div>}
      {editing && msg && <div className="panel" style={{ padding: '10px 16px' }}>✓ {msg} — <Link href="/" className="accent">통계 보기</Link></div>}

      {bulkResult && (
        <div className="panel" style={{ padding: '12px 16px' }}>
          <b>일괄 저장 완료</b> — 저장 {bulkResult.filter((r) => r.status === 'saved').length} · 중복 {bulkResult.filter((r) => r.status === 'dup').length} · 실패 {bulkResult.filter((r) => r.status === 'error' || r.status === 'parse_error').length}
          <div style={{ marginTop: 6, fontSize: 12 }}>{bulkResult.map((r, i) => (
            <div key={i} className="muted">{r.status === 'saved' ? '✅' : r.status === 'dup' ? '♻️ 중복' : '⚠️'} {r.file}{r.msg ? ` — ${r.msg}` : ''}</div>
          ))}</div>
          <Link href="/" className="accent" style={{ fontSize: 13 }}>→ 통계 보기</Link>
        </div>
      )}

      {batch.length > 0 && (
        <div className="panel">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
            <b>📦 일괄 검토 · {batch.length}경기</b>
            <span className="muted" style={{ fontSize: 12 }}>날짜순(오래된 → 최신). 승리팀·챔피언·사람 매핑 확인하고 저장</span>
            <button className="btn ghost" onClick={() => setBatch([])} disabled={bulkBusy} style={{ marginLeft: 'auto' }}>취소</button>
            <button className="btn" onClick={saveBatch} disabled={bulkBusy}>{bulkBusy ? '저장 중…' : `⬇ 전체 저장 (${batch.filter((m) => !m.error).length}경기)`}</button>
          </div>
          {batch.map((m) => (
            <div key={m.id} className="panel" style={{ padding: '10px 12px', marginBottom: 8, background: 'rgba(255,255,255,.02)' }}>
              {m.error ? (
                <div className="muted">⚠️ {m.fileName} — 파싱 실패: {m.error}</div>
              ) : (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, marginBottom: 6, flexWrap: 'wrap' }}>
                    <span className="muted">{m.fileName}</span>
                    <span className="muted">· {m.played_at ? new Date(m.played_at).toLocaleString() : '날짜?'}</span>
                    <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 4 }}>
                      승리:
                      <button className={`mini ${m.winner === 'A' ? 'on' : ''}`} onClick={() => setBatch((bs) => bs.map((x) => (x.id === m.id ? { ...x, winner: 'A' } : x)))}>1팀</button>
                      <button className={`mini ${m.winner === 'B' ? 'on' : ''}`} onClick={() => setBatch((bs) => bs.map((x) => (x.id === m.id ? { ...x, winner: 'B' } : x)))}>2팀</button>
                    </span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, fontSize: 12 }}>
                    {[1, 2].map((tm) => (
                      <div key={tm} style={{ borderLeft: `3px solid ${tm === 1 ? '#4d7cfe' : '#e0576b'}`, paddingLeft: 8 }}>
                        <div className="muted" style={{ marginBottom: 2 }}>{tm === 1 ? '1팀' : '2팀'}{m.winner === (tm === 1 ? 'A' : 'B') ? ' 승' : ''}</div>
                        {m.rows.filter((r) => r.team === tm).map((r, i) => (
                          <div key={i} style={{ display: 'flex', gap: 6, padding: '1px 0' }}>
                            <span style={{ minWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{(r.name || '').split('#')[0]}{(!r.personId || r.personId === '__new__') && <span className="accent" title="새 선수로 등록됨"> ✚</span>}</span>
                            <span className="muted" style={{ minWidth: 80 }}>{r.champion}</span>
                            <span className="muted">{r.k}/{r.d}/{r.a}</span>
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {rows.length === 10 && (
        <div className="panel">
          <div className="controls" style={{ marginBottom: 12 }}>
            <span>승리 팀 <span className="muted" style={{ fontSize: 11 }}>(눌러서 선택)</span>:</span>
            <button className={`mini ${winner === 'A' ? 'on' : ''}`} onClick={() => setWinner('A')}>1팀(A) 승</button>
            <button className={`mini ${winner === 'B' ? 'on' : ''}`} onClick={() => setWinner('B')}>2팀(B) 승</button>
            <span className="muted" style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
              게임 시간
              <input type="number" min={0} value={Math.floor(durationSec / 60)}
                onChange={(e) => setDurationSec(Math.max(0, Number(e.target.value)) * 60 + (durationSec % 60))}
                style={{ width: 60 }} title="분" />분
              <input type="number" min={0} max={59} value={durationSec % 60}
                onChange={(e) => setDurationSec(Math.floor(durationSec / 60) * 60 + Math.min(59, Math.max(0, Number(e.target.value))))}
                style={{ width: 56 }} title="초" />초
            </span>
            <button className="btn" onClick={() => save()} disabled={saving}>{saving ? (editing ? '수정 중…' : '저장 중…') : (editing ? '수정 저장' : '저장')}</button>
          </div>
          {source === 'replay' && objectives && (
            <div style={{ margin: '0 0 12px', fontSize: 12.5, padding: '10px 12px', background: '#181820', borderRadius: 8, border: '1px solid #2a2a33' }}>
              <div className="muted" style={{ fontSize: 11, marginBottom: 7 }}>리플 추출 · 팀 오브젝트</div>
              {[['A', '블루', '#4fb6d6'], ['B', '레드', '#e06a78']].map(([tm, label, color]) => {
                const o = objectives[tm];
                const g = o.gold >= 1000 ? (o.gold / 1000).toFixed(1) + 'k' : (o.gold || 0);
                const stats = [['킬', o.kills], ['골드', g], ['용', `${o.dragons || 0}${o.elder ? ` +엘더${o.elder}` : ''}`], ['전령', o.heralds || 0], ['유충', o.grubs || 0], ['바론', o.barons || 0], ['타워', o.towers || 0], ['억제기', o.inhibs || 0], ['아타칸', o.atakhan || 0], ['처형', o.objStolen || 0]];
                return (
                  <div key={tm} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', padding: '3px 0' }}>
                    <span style={{ color, fontWeight: 700, minWidth: 34 }}>{label}</span>
                    {stats.map(([kk, vv]) => <span key={kk} style={{ fontSize: 12 }}><span className="muted">{kk}</span> <b>{vv}</b></span>)}
                  </div>
                );
              })}
              <div className="muted" style={{ fontSize: 10.5, marginTop: 6 }}>※ 아이템·비전·딜분포 등 상세는 저장돼요. 첫 용 타이밍은 리플 스탯에 없어 카운트만.</div>
            </div>
          )}
          <table className="rec-table">
            <thead>
              <tr><th>팀</th><th>포지션</th><th className="l">닉/이름</th><th className="l">→ 사람</th><th>챔피언</th><th>K</th><th>D</th><th>A</th><th>딜량</th><th>CS</th></tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className={r.team === (winner === 'A' ? 1 : 2) ? 'win' : ''}>
                  <td>{r.team}</td>
                  <td>
                    <select value={r.position || ''} onChange={(e) => editRow(i, { position: e.target.value })} style={{ width: 62 }}>
                      {POS.map((p) => <option key={p} value={p}>{POS_KR[p]}</option>)}
                    </select>
                  </td>
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
