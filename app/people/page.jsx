'use client';
import { useEffect, useState } from 'react';
import { TIER_ORDER, TIER_LABEL, ADJUST_TAGS } from '../../src/table.js';
import PositionToggles, { rolesToArrays, arraysToRoles } from '../../components/PositionToggles.jsx';
import { useGroup } from '../../components/GroupProvider.jsx';
import { apiFetch } from '../../components/api.js';
import MembersPanel from '../../components/MembersPanel.jsx';
import Avatar from '../../components/Avatar.jsx';

const REGIONS = ['NA', 'KR', 'EUW', 'EUNE', 'BR', 'JP', 'OCE', 'LAN', 'LAS', 'TR', 'RU'];
const DEFAULT_TAG = { NA: 'NA1', KR: 'KR1', EUW: 'EUW', EUNE: 'EUNE', BR: 'BR1', JP: 'JP1' };

async function api(url, method, body) {
  const r = await apiFetch(url, {
    method: method || 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  }).then((x) => x.json());
  if (!r.ok) throw new Error(r.error || '요청 실패');
  return r;
}

export default function PeoplePage() {
  const { group, canEdit, role, isAdmin } = useGroup() || {};
  const gid = group?.id;
  const [persons, setPersons] = useState([]);
  const [region, setRegion] = useState('NA');
  const [acctInput, setAcctInput] = useState({});
  const [acctStatus, setAcctStatus] = useState({});
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(true);
  const [deduping, setDeduping] = useState(false);

  async function load() {
    if (!gid) return;
    setLoading(true); setErr(null);
    try { setPersons((await api('/api/persons?gid=' + gid)).persons); }
    catch (e) { setErr(e.message); }
    setLoading(false);
  }
  useEffect(() => { load(); }, [gid]);

  const addPerson = () => api('/api/persons', 'POST', { group_id: gid, display_name: '' }).then(load).catch((e) => setErr(e.message));
  const patchPerson = (id, patch) => api(`/api/persons/${id}?gid=${gid}`, 'PATCH', patch).then(load).catch((e) => setErr(e.message));
  async function delPerson(id) {
    if (!confirm('이 사람을 삭제할까요? 연결된 계정·경기기록도 함께 삭제됩니다.')) return;
    await api(`/api/persons/${id}?gid=${gid}`, 'DELETE').then(load).catch((e) => setErr(e.message));
  }
  function setRoles(p, roles) {
    const { primary, secondary } = rolesToArrays(roles);
    patchPerson(p.id, { primary_positions: primary, secondary_positions: secondary });
  }
  const mergeInto = (mergeId, keepId) => api('/api/persons/merge', 'POST', { gid, keepId, mergeId }).then(load).catch((e) => setErr(e.message));
  async function dedupe() {
    if (!confirm('같은 인게임 닉(#태그·공백 무시)인 중복 사람을 하나로 합칠까요?\n티어가 설정된 쪽으로 합쳐지고, 경기기록도 이전돼요.')) return;
    setDeduping(true); setErr(null);
    try {
      const r = await api('/api/persons/dedupe', 'POST', { group_id: gid });
      await load();
      alert(`중복 ${r.merged}명 병합 · 태그 ${r.cleaned}건 정리 완료.` + (r.merged + r.cleaned === 0 ? '\n(정리할 게 없었어요.)' : ''));
    } catch (e) { setErr(e.message); }
    setDeduping(false);
  }

  async function addAccount(p) {
    const raw = (acctInput[p.id] || '').trim();
    if (!raw) { setAcctStatus((s) => ({ ...s, [p.id]: { error: '이름#태그 입력' } })); return; }
    const [gn, tg] = raw.split('#');
    const gameName = gn.trim();
    const tag = (tg || '').trim() || DEFAULT_TAG[region] || region;
    setAcctStatus((s) => ({ ...s, [p.id]: { loading: true } }));
    try {
      const prof = await fetch(`/api/seed?name=${encodeURIComponent(gameName)}&tag=${encodeURIComponent(tag)}&region=${region}`).then((x) => x.json());
      if (!prof.found) { setAcctStatus((s) => ({ ...s, [p.id]: { error: prof.error || '못 찾음' } })); return; }
      await api('/api/accounts', 'POST', {
        gid, person_id: p.id, game_name: prof.gameName || gameName, tag_line: tag, region,
        opgg_tier: prof.suggestedTier, opgg_games: prof.games, opgg_confidence: prof.confidence,
      });
      const patch = {};
      if (p.accounts.length === 0) {
        if (prof.suggestedTier) patch.base_tier = prof.suggestedTier;
        if (!p.display_name) patch.display_name = prof.gameName || gameName;
      }
      if (Object.keys(patch).length) await api(`/api/persons/${p.id}?gid=${gid}`, 'PATCH', patch);
      setAcctInput((s) => ({ ...s, [p.id]: '' }));
      setAcctStatus((s) => ({ ...s, [p.id]: { msg: `✓ ${prof.gameName} 추가 · ${prof.suggestedTier || '?'}` } }));
      load();
    } catch (e) { setAcctStatus((s) => ({ ...s, [p.id]: { error: e.message } })); }
  }
  const delAccount = (id) => api(`/api/accounts/${id}?gid=${gid}`, 'DELETE').then(load).catch((e) => setErr(e.message));
  const setMain = (id, personId) => api(`/api/accounts/${id}?gid=${gid}`, 'PATCH', { setMain: true, personId }).then(load).catch((e) => setErr(e.message));

  return (
    <div>
      <div className="page-head">
        <div className="title"><h1>사람 관리</h1><p className="sub" style={{ margin: 0 }}>멤버 등록 · 본캐/부캐 연결 · op.gg 티어 자동. 통계는 사람 단위 합산.</p></div>
        {canEdit && (
          <div className="controls">
            <span className="region-pick">서버
              <select value={region} onChange={(e) => setRegion(e.target.value)}>{REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}</select>
            </span>
            <button className="btn ghost" onClick={dedupe} disabled={deduping} title="같은 인게임 닉(#태그·공백 무시) 중복 사람을 하나로 합쳐요">
              {deduping ? '정리 중…' : '🧹 중복 정리'}
            </button>
            <button className="btn" onClick={addPerson}>+ 사람 추가</button>
          </div>
        )}
        {!canEdit && <span className="tb-view">👀 구경 모드 · 보기 전용</span>}
      </div>
      {role === 'owner' && <MembersPanel gid={gid} />}
      {err && <div className="panel err" style={{ padding: '10px 16px' }}>{err}</div>}

      {loading && <div className="panel center muted">불러오는 중…</div>}
      {!loading && persons.length === 0 && (
        <div className="panel center muted">아직 등록된 사람이 없어요. <b>+ 사람 추가</b>로 시작하세요.</div>
      )}

      {persons.length > 0 && (
        <div className="panel members">
          {[...persons].sort((a, b) => (b.rating_games || 0) - (a.rating_games || 0) || (a.display_name || '').localeCompare(b.display_name || '')).map((p) => {
            const roles = arraysToRoles(p.primary_positions, p.secondary_positions);
            const st = acctStatus[p.id] || {};
            return (
              <div className="member" key={p.id}>
                <div className="m-main">
                  <div className="m-prof" title="아바타 (프로필 사진은 디코 /프로필 로 설정)">
                    <Avatar name={p.nickname || p.display_name} profile={p.profile} size={34} />
                  </div>
                  <input className="m-name" defaultValue={p.display_name} placeholder="인게임 닉 (스샷 매칭)" readOnly={!canEdit}
                    title="인게임 닉네임 — 스샷 매칭용. 표시이름은 연동 시 디코 서버별명, 아니면 이 인게임닉."
                    onBlur={(e) => canEdit && e.target.value !== p.display_name && patchPerson(p.id, { display_name: e.target.value })} />
                  <span className="m-nick-view" title={p.discord_id ? '디스코드 서버 별명(자동 동기화)' : '미연동 — 인게임 닉으로 표시'}>{p.discord_id ? `🔗 ${p.nickname || '…'}` : ''}</span>
                  <div className="m-tiercell">
                    <select className="m-tier" value={p.base_tier} disabled={!canEdit} title="주라인 티어 (메인 포지션 기준)" onChange={(e) => patchPerson(p.id, { base_tier: e.target.value })}>
                      {TIER_ORDER.map((k) => <option key={k} value={k}>{TIER_LABEL[k]}</option>)}
                    </select>
                    <select className="m-sectier" value={p.secondary_tier || ''} disabled={!canEdit} title="부라인 티어 — 주포지션 아닌 라인에 배치되면 이 티어로 계산 (보통 더 낮게). 비우면 주라인 티어 그대로." onChange={(e) => patchPerson(p.id, { secondary_tier: e.target.value || null })}>
                      <option value="">부라인 —</option>
                      {TIER_ORDER.map((k) => <option key={k} value={k}>부: {TIER_LABEL[k]}</option>)}
                    </select>
                    {isAdmin && (
                      <select className="m-adjust" value={p.adjust || 0} title="어드민 수동 보정 태그 (자동보정과 합산)"
                        onChange={(e) => patchPerson(p.id, { adjust: Number(e.target.value) })}>
                        {ADJUST_TAGS.map((t) => <option key={t.v} value={t.v}>{t.ic}{t.label}{t.v ? ` ${t.v > 0 ? '+' : ''}${t.v}` : ''}</option>)}
                      </select>
                    )}
                  </div>
                  <PositionToggles roles={roles} onChange={canEdit ? (r) => setRoles(p, r) : () => {}} />
                  <div className="m-accts">
                    {p.accounts.map((a) => (
                      <span className="acct" key={a.id}>
                        {a.is_main ? <b className="main-star" title="본캐">★</b> : (canEdit && <button className="mini" title="본캐로 지정" onClick={() => setMain(a.id, p.id)}>본캐</button>)}
                        {a.game_name}#{a.tag_line} <span className="muted">{a.opgg_tier || a.region}</span>
                        {canEdit && <button className="acct-x" title="계정 삭제" onClick={() => delAccount(a.id)}>✕</button>}
                      </span>
                    ))}
                    {canEdit && (
                      <span className="acct-add">
                        <input placeholder="부캐 이름#태그" value={acctInput[p.id] || ''}
                          onChange={(e) => setAcctInput((s) => ({ ...s, [p.id]: e.target.value }))}
                          onKeyDown={(e) => e.key === 'Enter' && addAccount(p)} />
                        <button className="seed-btn" disabled={st.loading} onClick={() => addAccount(p)}>{st.loading ? '…' : '🔎'}</button>
                      </span>
                    )}
                  </div>
                  {canEdit && (
                    <div className="m-actions">
                      {persons.length > 1 && (
                        <select className="merge-sel" value=""
                          onChange={(e) => {
                            const target = e.target.value;
                            if (target && confirm(`"${p.display_name}"을(를) 선택한 사람으로 합칠까요?\n계정·경기기록이 합쳐지고 "${p.display_name}"은 삭제됩니다.`))
                              mergeInto(p.id, target);
                          }}>
                          <option value="">합치기…</option>
                          {persons.filter((x) => x.id !== p.id).map((x) => <option key={x.id} value={x.id}>→ {x.display_name}</option>)}
                        </select>
                      )}
                      <button className="x-btn" title="삭제" onClick={() => delPerson(p.id)}>✕</button>
                    </div>
                  )}
                </div>
                {(st.msg || st.error) && <div className={`seed-status ${st.error ? 'err' : ''}`}>{st.error || st.msg}</div>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
