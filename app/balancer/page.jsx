'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { balance, balance20, balance20Split, scoreTeams, winrateAdj } from '../../src/engine.js';
import { TIER_LABEL, POS, POS_KR } from '../../src/table.js';
import RosterEditor from '../../components/RosterEditor.jsx';
import { arraysToRoles, rolesToArrays } from '../../components/PositionToggles.jsx';
import Results from '../../components/Results.jsx';
import { useGroup } from '../../components/GroupProvider.jsx';
import { apiFetch } from '../../components/api.js';

const KEY = 'lol-balance-roster';
const EMPTY = (n = 10) => Array.from({ length: n }, () => ({ name: '', tier: 'G2', roles: {} }));
const REGIONS = ['NA', 'KR', 'EUW', 'EUNE', 'BR', 'JP', 'OCE', 'LAN', 'LAS', 'TR', 'RU'];
const DEFAULT_TAG = { NA: 'NA1', KR: 'KR1', EUW: 'EUW', EUNE: 'EUNE', BR: 'BR1', JP: 'JP1' };

const stripInv = (s) => (s || '').replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, '');
const normNm = (s) => stripInv(s).split('#')[0].toLowerCase().replace(/\s+/g, '');
const rolesEqual = (roles, prim, sec) => {
  const { primary, secondary } = rolesToArrays(roles);
  const eq = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
  return eq(primary, prim || []) && eq(secondary, sec || []);
};

function toPlayer(p) {
  const { primary } = rolesToArrays(p.roles);
  return { name: p.name.trim(), tier: p.tier, positions: Object.keys(p.roles), primary };
}

export default function BalancerPage() {
  const { group, canEdit, isAdmin, winAdjEnabled } = useGroup();
  const gid = group?.id;
  const [adjustOn, setAdjustOn] = useState(false); // 에메랄드↓ 자동보정 on/off (관리자 토글, 브라우저 로컬)
  const [mode, setMode] = useState(10); // 10명(1게임) / 20명(2게임)
  const [roster, setRoster] = useState(EMPTY());
  const [people, setPeople] = useState([]);
  const [totalWeight, setTotalWeight] = useState(0.3);
  const [result, setResult] = useState(null);
  const [result20, setResult20] = useState(null); // 평균균등 { arrangements }
  const [mode20, setMode20] = useState('even');    // 'even'(평균균등) | 'split'(고저분리)
  const [split20, setSplit20] = useState(null);    // 고저분리 { games, lobbies }
  const [candIdx20, setCandIdx20] = useState([0, 0]); // 고저분리 게임별 후보 인덱스
  const [arr20, setArr20] = useState(0);
  const [views20, setViews20] = useState([null, null]);
  const [outliers20, setOutliers20] = useState([[], []]);
  const [sel20, setSel20] = useState(null);   // { g, team, pos }
  const [note20, setNote20] = useState(null);
  const [pmap20, setPmap20] = useState(new Map());
  const [candIdx, setCandIdx] = useState(0);
  const [view, setView] = useState(null); // 현재 보여주는 배치(후보 or 수동조정)
  const [sel, setSel] = useState(null);    // 스왑 위해 선택된 선수 {team,pos}
  const [rerollNote, setRerollNote] = useState(null);
  const [err, setErr] = useState(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try { const s = localStorage.getItem(KEY); if (s) { const r = JSON.parse(s); setRoster(r); if (r.length > 10) setMode(20); } } catch {}
    setLoaded(true);
  }, []);

  // 10명 ↔ 20명 전환: 로스터 크기 조정 (채워진 인원 보존)
  function switchMode(m) {
    if (m === mode) return;
    setMode(m); setResult(null); setResult20(null); setSplit20(null); setView(null); setViews20([null, null]); setSel(null); setSel20(null); setErr(null); setRerollNote(null); setNote20(null);
    setRoster((r) => {
      if (m === 20) return [...r, ...EMPTY(20 - r.length > 0 ? 20 - r.length : 0)].slice(0, 20);
      const filled = r.filter((p) => p.name.trim());
      const out = [...filled, ...EMPTY(10)].slice(0, 10);
      return out;
    });
  }
  useEffect(() => { if (loaded) localStorage.setItem(KEY, JSON.stringify(roster)); }, [roster, loaded]);

  const [customTable, setCustomTable] = useState(null);
  const [awards, setAwards] = useState(null);
  const [statPlayers, setStatPlayers] = useState([]);
  const [recruit, setRecruit] = useState(null); // 열린 오늘 내전(큐) — 있으면 불러오기 배너
  function loadPeople() {
    if (gid) fetch('/api/persons?gid=' + gid).then((x) => x.json()).then((r) => r.ok && setPeople(r.persons));
  }
  useEffect(loadPeople, [gid]);
  useEffect(() => {
    if (!gid) return;
    fetch('/api/awards?gid=' + gid).then((x) => x.json()).then((r) => r.ok && setAwards(r.awards));
    fetch('/api/stats?gid=' + gid).then((x) => x.json()).then((r) => r.ok && setStatPlayers(r.players || []));
    fetch('/api/adjust-setting?gid=' + gid).then((x) => x.json()).then((r) => r.ok && setAdjustOn(!!r.enabled)); // 방 전체 설정
    fetch('/api/recruit?gid=' + gid).then((x) => x.json()).then((r) => setRecruit(r.ok && r.queue ? r : null)).catch(() => {});
  }, [gid]);

  // 오늘 내전(디코 큐)의 배정 인원을 로스터에 자동 채우기 → 밸런서에서 자유 조정
  async function loadRecruit() {
    if (!gid) return;
    const r = await fetch('/api/recruit?gid=' + gid).then((x) => x.json()).catch(() => null);
    if (!r?.ok || !r.queue) { setRecruit(null); setErr('열린 오늘 내전이 없어요. 디코에서 /모집으로 시작하세요.'); return; }
    setRecruit(r);
    const LN = ['top', 'jungle', 'mid', 'adc', 'sup'];
    const filled = [];
    LN.forEach((l) => (r.lanes[l] || []).forEach((p) => { filled.push({ name: p.name, tier: p.tier || 'G2', roles: arraysToRoles([l], []) }); }));
    if (!filled.length) { setErr('오늘 내전에 아직 배정된 인원이 없어요.'); return; }
    const m = r.queue.size === 20 ? 20 : 10;
    setMode(m); setResult(null); setResult20(null); setSplit20(null); setView(null); setViews20([null, null]);
    setSel(null); setSel20(null); setErr(null); setRerollNote(null); setNote20(null);
    setRoster([...filled, ...EMPTY(Math.max(0, m - filled.length))].slice(0, m));
  }
  async function toggleAdjust() {
    const v = !adjustOn; setAdjustOn(v);
    setResult(null); setResult20(null); setView(null); setViews20([null, null]); // 재계산 유도
    try {
      const r = await apiFetch('/api/adjust-setting?gid=' + gid, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: v }),
      }).then((x) => x.json());
      if (!r.ok) { setAdjustOn(!v); setErr('보정 설정 저장 실패: ' + r.error); }
    } catch (e) { setAdjustOn(!v); setErr('보정 설정 저장 실패: ' + e.message); }
  }
  // 이름(정규화) → 자동보정값 (에메랄드↓만 ≠0)
  const autoByName = useMemo(() => {
    const m = {};
    statPlayers.forEach((p) => {
      if (!p.autoAdj) return;
      [p.name, p.nickname].filter(Boolean).forEach((s) => { m[normNm(s)] = p.autoAdj; });
    });
    return m;
  }, [statPlayers]);
  // 이름(정규화) → 수동 태그 보정값 (persons.adjust, 전 티어)
  const manualByName = useMemo(() => {
    const m = {};
    people.forEach((p) => {
      if (!p.adjust) return;
      [p.display_name, p.nickname].filter(Boolean).forEach((s) => { m[normNm(s)] = p.adjust; });
    });
    return m;
  }, [people]);
  const autoOf = (name) => autoByName[normNm(name)] || 0;
  const manualOf = (name) => manualByName[normNm(name)] || 0;
  // 유효보정 = 자동 + 수동, 합계 ±10 캡 (토글 ON일 때만)
  const adjOf = (name) => (adjustOn ? Math.max(-10, Math.min(10, autoOf(name) + manualOf(name))) : 0);
  // 이름 → 부라인 티어 (부라인 배치 시 이 티어로 계산)
  const secTierByName = useMemo(() => {
    const m = {};
    people.forEach((p) => { if (p.secondary_tier) [p.display_name, p.nickname].filter(Boolean).forEach((s) => { m[normNm(s)] = p.secondary_tier; }); });
    return m;
  }, [people]);
  // 선수 객체에 보정·부라인티어·승률보정 주입 (밸런서 계산 전 공통). 디코 마감과 동일 로직.
  const withMeta = (pl) => {
    const w = wrByName[normNm(pl.name)];
    const winAdj = (winAdjEnabled !== false && w) ? winrateAdj(w.wins, w.games) : 0;
    return { ...pl, adj: adjOf(pl.name), secondaryTier: secTierByName[normNm(pl.name)] || null, winAdj };
  };
  const titlesOf = (id) => (id && awards?.byPerson?.[id]) || [];

  // 이름(정규화) → 승률/판수 (팀짜기 결과 표시용)
  const wrByName = useMemo(() => {
    const m = {};
    statPlayers.forEach((p) => {
      if (!p.games) return;
      [p.name, p.nickname].filter(Boolean).forEach((s) => { m[normNm(s)] = { winrate: p.winrate, games: p.games, wins: p.wins, losses: p.losses, topChamp: p.topChamps?.[0]?.champion }; });
    });
    return m;
  }, [statPlayers]);
  useEffect(() => {
    if (!gid) return;
    fetch('/api/score-table?gid=' + gid).then((x) => x.json())
      .then((r) => { if (r.ok && r.table) setCustomTable(r.table); })
      .catch(() => {}); // 마이그레이션 전이면 무시 → 기본 표 사용
  }, [gid]);

  const [region, setRegion] = useState('NA');
  const [seedStatus, setSeedStatus] = useState({});

  // 닉#태그 입력 → op.gg/Riot 시즌평균 티어 자동 측정 → 그 행 티어에 적용
  async function onSeed(i) {
    const raw = (roster[i].name || '').trim();
    if (!raw) { setSeedStatus((s) => ({ ...s, [i]: { error: '닉(또는 이름#태그) 먼저 입력' } })); return; }
    const [gn, tg] = raw.split('#');
    const gameName = gn.trim();
    const tag = (tg || '').trim() || DEFAULT_TAG[region] || region;
    setSeedStatus((s) => ({ ...s, [i]: { loading: true } }));
    try {
      const prof = await fetch(`/api/seed?name=${encodeURIComponent(gameName)}&tag=${encodeURIComponent(tag)}&region=${region}`).then((x) => x.json());
      if (!prof.found) { setSeedStatus((s) => ({ ...s, [i]: { error: prof.error || '못 찾음' } })); return; }
      if (prof.suggestedTier) {
        // name=순수 닉, tag/region은 행에 보존 → 등록 시 계정으로 저장(op.gg 재측정용)
        setRoster((r) => r.map((p, idx) => (idx === i ? { ...p, name: `${prof.gameName || gameName}#${tag}`, tier: prof.suggestedTier, tag, region } : p)));
      } else {
        setSeedStatus((s) => ({ ...s, [i]: { error: prof.basis || '랭크 기록 없음 — 직접 선택' } })); return;
      }
      const tierTxt = TIER_LABEL[prof.suggestedTier] || prof.suggestedTier || '?';
      const apex = prof.apexNoLp ? ' ⚠과거 마스터+ LP없음, 챌/GM이면 수동 상향' : '';
      const warn = prof.confidence === 'low' || prof.apexNoLp || prof.suspect;
      const mark = prof.suspect ? '⚠️' : '✓';
      setSeedStatus((s) => ({ ...s, [i]: { msg: `${mark} ${tierTxt}${prof.basis ? ` (${prof.basis})` : ''}${apex}`, warn } }));
    } catch (e) { setSeedStatus((s) => ({ ...s, [i]: { error: e.message } })); }
  }

  const usedNames = useMemo(() => new Set(roster.map((p) => p.name.trim()).filter(Boolean)), [roster]);

  // 등록된 사람 → 정규화 닉으로 인덱싱 (태그·공백·대소문자 무시하고 매칭)
  const personByNorm = useMemo(() => {
    const m = new Map();
    people.forEach((p) => {
      [p.display_name, p.nickname, ...(p.accounts || []).map((a) => a.game_name)]
        .filter(Boolean).forEach((nm) => { const k = normNm(nm); if (k && !m.has(k)) m.set(k, p); });
    });
    return m;
  }, [people]);

  // 내전 참여 많은 순으로 칩 정렬 (rating_games desc, 동률이면 이름)
  const chipsPeople = useMemo(
    () => [...people].sort((a, b) => (b.rating_games || 0) - (a.rating_games || 0)
      || (a.display_name || '').localeCompare(b.display_name || '')),
    [people],
  );

  // 이름(정규화) → 통계(라인별 판수·많이 간 라인) — "주포지션 여러개면 많이 간 포지션" 판정용
  const statByNorm = useMemo(() => {
    const m = new Map();
    statPlayers.forEach((sp) => {
      [sp.name, sp.nickname].filter(Boolean).forEach((s) => { const k = normNm(s); if (k && !m.has(k)) m.set(k, sp); });
    });
    return m;
  }, [statPlayers]);

  // 사람 → 소속 포지션 그룹 판정 (멤버관리 등록값이 기준 = 형이 직접 통제)
  //   5포지션 다 등록(주+부 합쳐 5) → ALL(올라운더) / 주포지션 1개 → 그 라인
  //   주포지션 2~3개 → 그중 많이 간 라인(통계 타이브레이크) / 미등록이면 부·통계로 추정
  const bucketOf = (p) => {
    const prim = (p.primary_positions || []).filter((x) => POS.includes(x));
    const sec = (p.secondary_positions || []).filter((x) => POS.includes(x));
    if (new Set([...prim, ...sec]).size >= 5) return 'all';
    const sp = statByNorm.get(normNm(p.display_name)) || statByNorm.get(normNm(p.nickname));
    const mostOf = (lanes) => { // 주어진 라인들 중 통계상 가장 많이 간 라인
      if (!sp?.positions) return lanes[0];
      let best = lanes[0], bn = -1;
      lanes.forEach((l) => { const n = sp.positions[l] || 0; if (n > bn) { bn = n; best = l; } });
      return best;
    };
    if (prim.length === 1) return prim[0];
    if (prim.length >= 2) return mostOf(prim);
    if (sec.length === 1) return sec[0];
    if (sec.length >= 2) return mostOf(sec);
    return sp?.mainPos || 'etc'; // 포지션 미등록 → 통계 주라인, 그마저 없으면 미지정
  };

  // 그룹별 사람 목록 (탑·정글·미드·원딜·서폿·ALL·미지정)
  const chipsByPos = useMemo(() => {
    const g = { top: [], jungle: [], mid: [], adc: [], sup: [], all: [], etc: [] };
    chipsPeople.forEach((p) => { (g[bucketOf(p)] || g.etc).push(p); });
    return g;
  }, [chipsPeople, statByNorm]);

  // 밸런서 팀구성 기반 관계형 뱃지: 최고듀오=같은팀, 견우직녀·인간상성=상대팀일 때만. view 바뀌면 재계산.
  const relCtx = useMemo(() => {
    const ctx = {};
    if (!view?.lanes || !awards) return ctx;
    const teamOf = {}; // personId → 'A'|'B'
    view.lanes.forEach((l) => {
      const ap = personByNorm.get(normNm(l.a.name)); if (ap) teamOf[ap.id] = 'A';
      const bp = personByNorm.get(normNm(l.b.name)); if (bp) teamOf[bp.id] = 'B';
    });
    const push = (id, badge) => {
      const p = people.find((x) => x.id === id); if (!p) return;
      [p.display_name, p.nickname].filter(Boolean).forEach((s) => { const k = normNm(s); if (k) (ctx[k] = ctx[k] || []).push(badge); });
    };
    const { bestDuo, starCrossed, nemesis } = awards;
    if (bestDuo && teamOf[bestDuo.aId] && teamOf[bestDuo.aId] === teamOf[bestDuo.bId]) {
      push(bestDuo.aId, { ic: '💞', title: '최고의 듀오 (같은 팀!)' });
      push(bestDuo.bId, { ic: '💞', title: '최고의 듀오 (같은 팀!)' });
    }
    if (starCrossed && teamOf[starCrossed.aId] && teamOf[starCrossed.bId] && teamOf[starCrossed.aId] !== teamOf[starCrossed.bId]) {
      push(starCrossed.aId, { ic: '💔', title: '견우와 직녀 (상대 팀 — 드디어 갈라짐)' });
      push(starCrossed.bId, { ic: '💔', title: '견우와 직녀 (상대 팀)' });
    }
    if (nemesis && teamOf[nemesis.winnerId] && teamOf[nemesis.loserId] && teamOf[nemesis.winnerId] !== teamOf[nemesis.loserId]) {
      push(nemesis.winnerId, { ic: '😈', title: '인간상성 (이 상대에 강함)' });
      push(nemesis.loserId, { ic: '🥶', title: '약체 (인간상성 상대에 약함)' });
    }
    return ctx;
  }, [view, awards, people, personByNorm]);

  const nameMeta = (name) => {
    const k = normNm(name);
    return { titles: [...(awards?.byName?.[k] || []), ...(relCtx[k] || [])], ...(wrByName[k] || {}),
      adj: adjOf(name), autoAdj: adjustOn ? autoOf(name) : 0, manualAdj: adjustOn ? manualOf(name) : 0,
      profile: personByNorm.get(k)?.profile || null };
  };

  // 각 로스터 행: 미등록('add') / 등록됨('save', 변경 시 dirty) / 빈칸('none')
  const rowMeta = useMemo(() => roster.map((row) => {
    const nm = (row.name || '').trim();
    if (!nm) return { kind: 'none' };
    const person = (row.pid && people.find((p) => p.id === row.pid)) || personByNorm.get(normNm(nm));
    if (!person) return { kind: 'add' };
    const dirty = person.base_tier !== row.tier
      || !rolesEqual(row.roles, person.primary_positions, person.secondary_positions);
    return { kind: 'save', person, dirty, titles: titlesOf(person.id) };
  }), [roster, people, personByNorm, awards]);

  const [rowSave, setRowSave] = useState({});
  async function saveRow(i) {
    const meta = rowMeta[i];
    if (!meta || meta.kind === 'none' || !gid) return;
    setRowSave((s) => ({ ...s, [i]: 'saving' })); setErr(null);
    try {
      const { primary, secondary } = rolesToArrays(roster[i].roles);
      if (meta.kind === 'add') {
        const [nick, inlineTag] = stripInv(roster[i].name).trim().split('#');
        const dn = nick.trim();
        const tag = (roster[i].tag || inlineTag || '').trim();
        const res = await apiFetch('/api/persons', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ group_id: gid, display_name: dn, base_tier: roster[i].tier,
            primary_positions: primary, secondary_positions: secondary }),
        }).then((x) => x.json());
        if (!res.ok) throw new Error(res.error || '등록 실패');
        if (tag) await apiFetch('/api/accounts', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ gid, person_id: res.person.id, game_name: dn, tag_line: tag,
            region: roster[i].region || region, opgg_tier: roster[i].tier }),
        }).catch(() => {});
        setRoster((r) => r.map((p, idx) => (idx === i ? { ...p, name: dn, pid: res.person.id } : p)));
      } else {
        // 포지션은 항상 저장. 티어는 바뀌었을 때만 '확인' 받고 저장 (조용히 덮어써서 티어 오염되는 버그 방지)
        const body = { primary_positions: primary, secondary_positions: secondary };
        if (meta.person.base_tier !== roster[i].tier) {
          const from = TIER_LABEL[meta.person.base_tier] || meta.person.base_tier;
          const to = TIER_LABEL[roster[i].tier] || roster[i].tier;
          if (window.confirm(`"${roster[i].name}" 티어를 ${from} → ${to}(으)로 바꿀까요?\n(포지션만 저장하려면 취소 — 티어는 그대로 둡니다)`)) {
            body.base_tier = roster[i].tier;
          } else {
            // 취소 시 로스터 행 티어를 DB 값으로 되돌려 드리프트 제거
            setRoster((r) => r.map((p, idx) => (idx === i ? { ...p, tier: meta.person.base_tier } : p)));
          }
        }
        const res = await apiFetch(`/api/persons/${meta.person.id}?gid=${gid}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }).then((x) => x.json());
        if (!res.ok) throw new Error(res.error || '저장 실패');
      }
      loadPeople();
      setRowSave((s) => ({ ...s, [i]: 'saved' }));
      setTimeout(() => setRowSave((s) => { const c = { ...s }; delete c[i]; return c; }), 1600);
    } catch (e) {
      setErr('저장 실패: ' + e.message);
      setRowSave((s) => { const c = { ...s }; delete c[i]; return c; });
    }
  }

  // 로스터에 있지만 아직 미등록인 이름 (사람으로 저장 가능)
  const newNames = useMemo(() => {
    const known = new Set(people.flatMap((p) => [p.display_name, p.nickname, ...(p.accounts || []).map((a) => a.game_name)].filter(Boolean).map((s) => s.trim().toLowerCase())));
    return roster.filter((p) => p.name.trim() && !known.has(p.name.trim().toLowerCase()));
  }, [roster, people]);
  const [registering, setRegistering] = useState(false);

  async function registerNew() {
    if (!gid || !newNames.length) return;
    setRegistering(true); setErr(null);
    try {
      for (const p of newNames) {
        const { primary, secondary } = rolesToArrays(p.roles);
        // #태그 제거 → display_name = 순수 인게임 닉 (스샷 닉과 매칭되게)
        const stripInv = (s) => (s || '').replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, '');
        const [nick, inlineTag] = stripInv(p.name).trim().split('#');
        const dn = nick.trim();
        const tag = (p.tag || inlineTag || '').trim();
        const res = await apiFetch('/api/persons', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ group_id: gid, display_name: dn, base_tier: p.tier,
            primary_positions: primary, secondary_positions: secondary }),
        }).then((x) => x.json());
        if (!res.ok) throw new Error(res.error || '등록 실패');
        // 태그 있으면 계정으로 저장 (op.gg 재측정용). display엔 안 보이고 매칭·조회에 쓰임
        if (res.ok && tag) {
          await apiFetch('/api/accounts', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ gid, person_id: res.person.id, game_name: dn, tag_line: tag, region: p.region || region, opgg_tier: p.tier }),
          }).catch(() => {});
        }
      }
      loadPeople();
    } catch (e) { setErr('등록 실패: ' + e.message); }
    setRegistering(false);
  }

  function fillFromPerson(p) {
    setResult(null); setView(null); setSel(null);
    setRoster((r) => {
      if (r.some((x) => x.name.trim() === p.display_name)) return r;
      const i = r.findIndex((x) => !x.name.trim());
      if (i < 0) return r;
      const copy = [...r];
      copy[i] = { name: p.display_name, tier: p.base_tier, pid: p.id, roles: arraysToRoles(p.primary_positions, p.secondary_positions) };
      return copy;
    });
  }

  // 20명: arrangement 적용 (평균균등 리롤/최초 공용)
  function applyArrangement(res, idx) {
    const a = res.arrangements[idx];
    setArr20(idx); setViews20([a.views[0], a.views[1]]); setOutliers20([a.outliers[0], a.outliers[1]]);
    setSel20(null); setNote20(null);
  }

  // 20명 계산 (m: 'even' 평균균등 | 'split' 고저분리)
  function compute20(m) {
    const opts = { totalWeight, topK: 12, table: customTable || undefined };
    const players = roster.map(toPlayer).map(withMeta);
    setPmap20(new Map(players.map((p) => [p.name, p])));
    if (m === 'split') {
      const res = balance20Split(players, opts);
      setSplit20(res); setResult20(null); setCandIdx20([0, 0]); setSel20(null); setNote20(null);
      setViews20([res.games[0].candidates[0] || null, res.games[1].candidates[0] || null]);
      setOutliers20([res.games[0].outliers || [], res.games[1].outliers || []]);
    } else {
      const res = balance20(players, opts);
      setResult20(res); setSplit20(null);
      applyArrangement(res, 0);
    }
  }

  function run() {
    setErr(null); setResult(null); setResult20(null); setSplit20(null); setView(null); setSel(null); setSel20(null); setRerollNote(null); setNote20(null);
    const filled = roster.filter((p) => p.name.trim());
    if (filled.length !== mode) { setErr(`${mode}명을 채우세요 (현재 ${filled.length}명).`); return; }
    if (new Set(filled.map((p) => p.name.trim())).size !== mode) { setErr('이름이 중복됩니다.'); return; }
    if (roster.some((p) => p.name.trim() && Object.keys(p.roles).length === 0)) { setErr('모든 인원의 포지션(주/부)을 지정하세요.'); return; }
    try {
      if (mode === 20) {
        compute20(mode20);
      } else {
        const opts = { totalWeight, topK: 12, table: customTable || undefined };
        const r = balance(roster.map(toPlayer).map(withMeta), opts);
        setResult(r); setCandIdx(0); setView(r.candidates[0] || null);
      }
    } catch (e) { setErr('계산 오류: ' + e.message); }
  }

  // 평균균등 서브모드 전환 — 이미 짜여있으면 즉시 재계산
  function switch20(m) {
    if (m === mode20) return;
    setMode20(m);
    if (usedNames.size === 20 && (result20 || split20)) { try { compute20(m); } catch (e) { setErr('계산 오류: ' + e.message); } }
  }

  // 평균균등: 전체 조합 앞/뒤로 넘기기 (arrangements 순환)
  function goArr20(dir) {
    if (!result20?.arrangements?.length) return;
    if (result20.arrangements.length <= 1) { setNote20('다른 균형 조합이 없어요 — 선수를 클릭해 수동으로 바꿔보세요.'); return; }
    const n = result20.arrangements.length;
    applyArrangement(result20, (arr20 + dir + n) % n);
  }
  const reroll20 = () => goArr20(1);
  const reroll20Prev = () => goArr20(-1);

  // 고저분리: 게임별 조합 앞/뒤로 넘기기 (그 게임 내부만)
  function goGame(g, dir) {
    const game = split20?.games?.[g];
    if (!game?.candidates?.length) return;
    if (game.candidates.length <= 1) { setNote20('이 게임은 다른 균형 조합이 없어요 — 선수 이동으로 조정하세요.'); return; }
    const n = game.candidates.length;
    const ni = (candIdx20[g] + dir + n) % n;
    setCandIdx20((c) => c.map((x, i) => (i === g ? ni : x)));
    setViews20((v) => v.map((x, i) => (i === g ? game.candidates[ni] : x)));
    setSel20(null); setNote20(null);
  }
  const rerollGame = (g) => goGame(g, 1);
  const rerollGamePrev = (g) => goGame(g, -1);

  // 선수 클릭 스왑: 같은 게임=자리 교환, 다른 게임=게임 간 인원 교환. 둘 다 재채점(scoreTeams).
  function swap20(g, team, pos) {
    if (!sel20) { setSel20({ g, team, pos }); return; }
    if (sel20.g === g && sel20.team === team && sel20.pos === pos) { setSel20(null); return; }
    const opts = { totalWeight, table: customTable || undefined };
    const rebuild = (v) => ({ A: v.lanes.map((l) => pmap20.get(l.a.name)), B: v.lanes.map((l) => pmap20.get(l.b.name)) });
    const idxOf = (v, p) => v.lanes.findIndex((l) => l.pos === p);
    if (sel20.g === g) {
      const { A, B } = rebuild(views20[g]);
      const i1 = idxOf(views20[g], sel20.pos), i2 = idxOf(views20[g], pos);
      const a1 = sel20.team === 'A' ? A : B, a2 = team === 'A' ? A : B;
      const t = a1[i1]; a1[i1] = a2[i2]; a2[i2] = t;
      const snap = { ...scoreTeams(A, B, opts), manual: true };
      setViews20((vs) => vs.map((x, i) => (i === g ? snap : x)));
    } else {
      const r1 = rebuild(views20[sel20.g]), r2 = rebuild(views20[g]);
      const i1 = idxOf(views20[sel20.g], sel20.pos), i2 = idxOf(views20[g], pos);
      const arr1 = sel20.team === 'A' ? r1.A : r1.B, arr2 = team === 'A' ? r2.A : r2.B;
      const t = arr1[i1]; arr1[i1] = arr2[i2]; arr2[i2] = t;
      const s1 = { ...scoreTeams(r1.A, r1.B, opts), manual: true };
      const s2 = { ...scoreTeams(r2.A, r2.B, opts), manual: true };
      setViews20((vs) => vs.map((x, i) => (i === sel20.g ? s1 : i === g ? s2 : x)));
    }
    setSel20(null);
  }

  // 조합 넘기기: 미리 계산된 candidates 배열을 앞/뒤로 순환 (랜덤 아님). 하나뿐이면 안내.
  function goCand(dir) {
    if (!result?.candidates?.length) return;
    if (result.candidates.length <= 1) {
      setRerollNote('이게 유일한 최적 배치예요 — 포지션 맞고 균형 잡히는 다른 조합이 없어요.');
      return;
    }
    const n = result.candidates.length;
    const ni = (candIdx + dir + n) % n;
    setCandIdx(ni); setView(result.candidates[ni]); setSel(null); setRerollNote(null);
  }
  const reroll = () => goCand(1);      // 다음 조합 ▶
  const rerollPrev = () => goCand(-1); // 이전 조합 ◀

  // 수동 스왑: 선수 두 명 클릭 → 자리 교환 후 재계산
  function doSwap(team, pos) {
    if (!view) return;
    if (!sel) { setSel({ team, pos }); return; }
    if (sel.team === team && sel.pos === pos) { setSel(null); return; } // 같은 거 재클릭=취소
    const nameMap = new Map(roster.filter((p) => p.name.trim()).map((p) => [p.name.trim(), withMeta(toPlayer(p))]));
    const A = view.lanes.map((l) => nameMap.get(l.a.name));
    const B = view.lanes.map((l) => nameMap.get(l.b.name));
    const i1 = view.lanes.findIndex((l) => l.pos === sel.pos);
    const i2 = view.lanes.findIndex((l) => l.pos === pos);
    const a1 = sel.team === 'A' ? A : B, a2 = team === 'A' ? A : B;
    const t = a1[i1]; a1[i1] = a2[i2]; a2[i2] = t;
    try {
      const snap = scoreTeams(A, B, { totalWeight, table: customTable || undefined });
      setView({ ...snap, manual: true });
    } catch (e) { setErr('스왑 계산 오류: ' + e.message); }
    setSel(null);
  }

  return (
    <div>
      <div className="page-head">
        <div className="title"><h1>밸런서</h1><p className="sub" style={{ margin: 0 }}>등록된 사람을 불러오거나 직접 입력 → {mode}명 채우면 팀을 짜줘요.{mode === 20 ? ' (20명 = 평균점수 균등한 2게임)' : ''}</p></div>
        <div className="bal-mode">
          <div className="mode-toggle">
            <button className={mode === 10 ? 'on' : ''} onClick={() => switchMode(10)} type="button">10명</button>
            <button className={mode === 20 ? 'on' : ''} onClick={() => switchMode(20)} type="button">20명 · 2게임</button>
          </div>
          <span className="attend-count">채움 <b>{usedNames.size}</b>/{mode}</span>
        </div>
      </div>

      {recruit?.queue && (
        <div className="panel" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', borderColor: 'rgba(79,182,214,.4)' }}>
          <span>🎮 <b>오늘 내전</b> 진행 중 · <b>{['top', 'jungle', 'mid', 'adc', 'sup'].reduce((a, l) => a + (recruit.lanes?.[l]?.length || 0), 0)}</b>/{recruit.queue.size}명</span>
          <button className="btn" onClick={loadRecruit}>📥 오늘 내전 인원 불러오기</button>
          <span className="muted" style={{ fontSize: 12 }}>디코 큐 인원을 로스터에 자동으로 채워서 여기서 자유롭게 조정</span>
        </div>
      )}

      {people.length > 0 && (
        <div className="panel">
          <h2>등록된 사람 불러오기 <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>(주 포지션별 · 클릭하면 빈 칸에 들어가요)</span></h2>
          <div className="reg-groups">
            {[['top', '탑'], ['jungle', '정글'], ['mid', '미드'], ['adc', '원딜'], ['sup', '서폿'], ['all', 'ALL'], ['etc', '미지정']]
              .filter(([k]) => chipsByPos[k].length > 0).map(([k, label]) => (
                <div className="reg-group" key={k}>
                  <span className={`reg-group-label pos-${k}`}>{label} <span className="rg-n">{chipsByPos[k].length}</span></span>
                  <div className="reg-chips">
                    {chipsByPos[k].map((p) => {
                      const used = usedNames.has(p.display_name);
                      return (
                        <button key={p.id} className={`reg-chip ${used ? 'used' : ''}`} disabled={used}
                          onClick={() => fillFromPerson(p)} type="button">
                          {p.display_name} <span className="muted">{TIER_LABEL[p.base_tier]}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      <div className="panel">
        <div className="controls" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>로스터 ({mode}명) <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>· 닉#태그 입력 후 🔎 누르면 티어 자동</span></h2>
          <span className="region-pick muted" style={{ fontSize: 12 }}>서버
            <select value={region} onChange={(e) => setRegion(e.target.value)}>{REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}</select>
          </span>
        </div>
        <RosterEditor roster={roster} onChange={setRoster} onSeed={onSeed} seedStatus={seedStatus}
          rowMeta={rowMeta} rowSave={rowSave} onRowSave={canEdit ? saveRow : undefined} />
      </div>

      <div className="panel">
        <div className="controls">
          <button className="btn" onClick={run} disabled={usedNames.size !== mode}>팀 짜기{mode === 20 ? ' (2게임)' : ''}</button>
          <button className="btn ghost" onClick={() => { setRoster(EMPTY(mode)); setResult(null); setResult20(null); setSplit20(null); setView(null); setViews20([null, null]); setSel(null); setSel20(null); setErr(null); }}>비우기</button>
          <button className="btn ghost" title="이름·티어는 두고 모든 포지션(주/부)만 초기화"
            onClick={() => { setRoster((r) => r.map((p) => ({ ...p, roles: {} }))); setResult(null); setView(null); setSel(null); setErr(null); }}>포지션 비우기</button>
          {gid && newNames.length > 0 && canEdit && (
            <button className="btn ghost" onClick={registerNew} disabled={registering} title="로스터의 새 이름을 사람으로 저장 → 다음부턴 칩으로 불러오기">
              {registering ? '등록 중…' : `+ 새 인원 ${newNames.length}명 등록`}
            </button>
          )}
          <div className="slider-box">
            <label><span>라인 우선</span><span>총점 우선</span></label>
            <input type="range" min="0" max="1" step="0.05" value={totalWeight} onChange={(e) => setTotalWeight(parseFloat(e.target.value))} />
            <span className="muted" style={{ fontSize: 11 }}>가중치 {totalWeight.toFixed(2)} (낮을수록 라인 공정 우선)</span>
          </div>
          {isAdmin && (
            <button className={`btn adj-btn ${adjustOn ? 'on' : 'ghost'}`} onClick={toggleAdjust}
              title="에메랄드↓ 선수를 내전 실적(승률+개인기여)으로 점수 보정. 관리자 전용 · 방 전체 적용">
              🧪 저티어 자동보정 {adjustOn ? 'ON' : 'OFF'}
            </button>
          )}
        </div>
        {err && <div className="err">{err}</div>}
      </div>

      {mode === 10 && (
        <Results feasible={result?.feasible} outliers={result?.outliers || []} view={view}
          onReroll={reroll} onPrev={rerollPrev} onSwap={doSwap} sel={sel} meta={nameMeta} note={rerollNote}
          idx={candIdx} total={result?.candidates?.length || 0} />
      )}

      {mode === 20 && (result20 || split20) && views20[0] && (() => {
        const split = mode20 === 'split';
        const sums4 = [views20[0].sumA, views20[0].sumB, views20[1].sumA, views20[1].sumB];
        const spread = Math.max(...sums4) - Math.min(...sums4);
        const spCls = spread <= 8 ? 'green' : spread <= 18 ? 'yellow' : 'red';
        const gTotal = (i) => (split ? (split20.games[i].candidates.length) : (result20?.arrangements.length || 0));
        const gIdx = (i) => (split ? candIdx20[i] : arr20);
        return (
          <>
            <div className="panel lobby-note" style={{ gap: 12, flexWrap: 'wrap' }}>
              <div className="mode20-toggle">
                <button className={!split ? 'on' : ''} onClick={() => switch20('even')} type="button">⚖️ 평균 균등</button>
                <button className={split ? 'on' : ''} onClick={() => switch20('split')} type="button">📊 고저 분리</button>
              </div>
              <span>
                {split
                  ? <>🎮 <b>고저 분리</b> · 상위10=고티어 게임, 하위10=저티어 게임 · 게임별 리롤</>
                  : <>🎮 <b>4팀 균등</b> · 팀 점수 {sums4.map((s) => s.toFixed(1)).join(' / ')} <b className={spCls}>(편차 {spread.toFixed(1)})</b></>}
                <span className="muted"> · 선수 클릭 후 다른 게임 선수 클릭 = 게임 간 이동</span>
              </span>
              {!split && (
                <span className="cand-nav">
                  <button className="mini nav-arrow" onClick={reroll20Prev} disabled={(result20?.arrangements.length || 0) <= 1} aria-label="이전 조합">◀</button>
                  <span className="cand-count"><b>{result20?.arrangements.length || 0}</b>개 조합 <span className="muted">· {arr20 + 1}/{result20?.arrangements.length || 0}</span></span>
                  <button className="mini nav-arrow" onClick={reroll20} disabled={(result20?.arrangements.length || 0) <= 1} aria-label="다음 조합">▶</button>
                </span>
              )}
            </div>
            {note20 && <div className="panel reroll-note" style={{ marginTop: 0 }}>ℹ️ {note20}</div>}
            <h2 style={{ margin: '16px 2px 6px' }}>🎮 게임 1{split ? ' · 고티어' : ''}</h2>
            <Results feasible outliers={outliers20[0]} view={views20[0]}
              onSwap={(team, pos) => swap20(0, team, pos)} sel={sel20 && sel20.g === 0 ? { team: sel20.team, pos: sel20.pos } : null}
              onReroll={split ? () => rerollGame(0) : undefined} onPrev={split ? () => rerollGamePrev(0) : undefined}
              meta={nameMeta} idx={gIdx(0)} total={gTotal(0)} />
            <h2 style={{ margin: '20px 2px 6px' }}>🎮 게임 2{split ? ' · 저티어' : ''}</h2>
            <Results feasible outliers={outliers20[1]} view={views20[1]}
              onSwap={(team, pos) => swap20(1, team, pos)} sel={sel20 && sel20.g === 1 ? { team: sel20.team, pos: sel20.pos } : null}
              onReroll={split ? () => rerollGame(1) : undefined} onPrev={split ? () => rerollGamePrev(1) : undefined}
              meta={nameMeta} idx={gIdx(1)} total={gTotal(1)} />
          </>
        );
      })()}

      {mode === 10 && result?.feasible && (
        <div className="panel">
          <div className="controls" style={{ gap: 12 }}>
            <a className="btn" href="https://draftlol.dawe.gg/" target="_blank" rel="noopener noreferrer">🎫 픽/밴 드래프트 열기 (draftlol)</a>
            <span className="muted" style={{ fontSize: 12 }}>팀 짰으면 여기서 픽/밴 진행 → 게임 후 <Link href="/record" className="accent">📸 경기 기록</Link>에 스샷 올리면 자동 저장.</span>
          </div>
        </div>
      )}
    </div>
  );
}
