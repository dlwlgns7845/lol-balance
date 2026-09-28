'use client';
import { TIER_ORDER, TIER_LABEL, POS, POS_KR } from '../src/table.js';
import TitleBadges from './TitleBadges.jsx';
import { useLang } from './i18n.jsx';

// 클릭마다 상태 순환: 끔(undefined) → 주(primary) → 부(secondary) → 끔
function nextRole(cur) {
  if (!cur) return 'primary';
  if (cur === 'primary') return 'secondary';
  return undefined;
}

export default function RosterEditor({ roster, onChange, onSeed, seedStatus = {}, rowMeta = [], rowSave = {}, onRowSave }) {
  const { t } = useLang();
  function update(i, patch) {
    onChange(roster.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  }
  function cyclePos(i, pos) {
    const roles = { ...roster[i].roles };
    const nv = nextRole(roles[pos]);
    if (nv) roles[pos] = nv;
    else delete roles[pos];
    update(i, { roles });
  }

  return (
    <div>
      {roster.map((p, i) => {
        const st = seedStatus[i] || {};
        return (
          <div className="roster-row" key={i}>
            <span className="idx">{i + 1}</span>
            <div className="name-cell">
              <input
                value={p.name}
                placeholder={t('플레이어 {n} (또는 이름#태그)', { n: i + 1 })}
                onChange={(e) => update(i, { name: e.target.value })}
              />
              {onSeed && (
                <button className="seed-btn" type="button" title={t('op.gg 티어 불러오기')}
                  disabled={st.loading} onClick={() => onSeed(i)}>
                  {st.loading ? '…' : '🔎'}
                </button>
              )}
              <TitleBadges titles={(rowMeta[i] || {}).titles} />
            </div>
            <select value={p.tier} onChange={(e) => update(i, { tier: e.target.value })}>
              {TIER_ORDER.map((k) => (
                <option key={k} value={k}>{t(TIER_LABEL[k])}</option>
              ))}
            </select>
            <div className="pos-toggles">
              {POS.map((pos) => {
                const r = p.roles[pos];
                const cls = r === 'primary' ? 'on' : r === 'secondary' ? 'sec' : '';
                return (
                  <button key={pos} className={cls} onClick={() => cyclePos(i, pos)} type="button">
                    {t(POS_KR[pos])}
                    {r === 'secondary' && <sup>{t('부')}</sup>}
                  </button>
                );
              })}
            </div>
            {onRowSave && (() => {
              const m = rowMeta[i] || { kind: 'none' };
              const ss = rowSave[i];
              if (m.kind === 'none') return <span />;
              const label = ss === 'saving' ? '…' : ss === 'saved' ? '✓ ' + t('저장') : m.kind === 'add' ? '+ ' + t('추가') : m.dirty ? t('저장') : t('저장됨');
              const cls = ss === 'saved' ? 'saved' : m.kind === 'add' ? 'add' : m.dirty ? 'dirty' : '';
              const disabled = ss === 'saving' || (m.kind === 'save' && !m.dirty && ss !== 'saved');
              const title = m.kind === 'add' ? t('이 인원을 사람으로 등록') : m.dirty ? t('변경된 티어·포지션 저장') : t('변경 없음');
              return <button className={`row-save ${cls}`} type="button" disabled={disabled} title={title} onClick={() => onRowSave(i)}>{label}</button>;
            })()}
            {(st.msg || st.error) && (
              <div className={`seed-status ${st.error ? 'err' : st.warn ? 'warn' : ''}`}>{st.error || st.msg}</div>
            )}
          </div>
        );
      })}
      <p className="hint">{t('포지션 클릭:')} <b>{t('끔 → 주')}</b>{t('(주포지션)')} <b>{t('→ 부')}</b>{t('(부포지션). 주포지션 우선 배치, 부포지션은 밸런스상 필요할 때만 사용돼요.')}</p>
    </div>
  );
}
