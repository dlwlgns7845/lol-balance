'use client';
import { POS_KR, TIER_LABEL, tierClass } from '../src/table.js';
import TitleBadges from './TitleBadges.jsx';
import Avatar from './Avatar.jsx';
import { useLang } from './i18n.jsx';

const LIGHT_ICON = { green: '🟢', yellow: '🟡', red: '🔴' };
const LIGHT_KR = { green: '균형', yellow: '약간 기움', red: '불균형' };
const wrCls = (w) => (w >= 0.6 ? 'green' : w >= 0.5 ? 'yellow' : 'red');

export default function Results({ feasible, outliers = [], view, onReroll, onPrev, onSwap, sel, idx, total, meta, note }) {
  const { t } = useLang();
  if (feasible === false) {
    return (
      <div className="panel center muted">
        {t('이 구성으론 팀을 못 짭니다 — 각 포지션을 최소 2명 이상이 맡을 수 있어야 해요. (가능 포지션을 더 켜주세요.)')}
      </div>
    );
  }
  if (!view) return null;
  const c = view;
  const isSel = (team, pos) => sel && sel.team === team && sel.pos === pos;

  const player = (team, l) => {
    const p = team === 'A' ? l.a : l.b;
    const m = (meta ? meta(p.name) : {}) || {};
    const on = isSel(team, l.pos);
    const pct = Math.round((m.winrate || 0) * 100);
    return (
      <div className={`tr-p t-${team.toLowerCase()} ${on ? 'sel' : ''}`} onClick={() => onSwap(team, l.pos)} title={t('클릭 후 다른 선수 클릭 = 자리 교환')}>
        <span className="tr-av"><Avatar name={p.name} profile={m.profile} size={36} /></span>
        <div className="tr-id">
          <div className="tr-name"><span className="tr-nm">{p.name}</span>{p.off && <sup className="offtag">{t('부')}</sup>}<TitleBadges titles={m.titles} max={6} /></div>
          <div className={`tr-tier ${tierClass(p.tier)}`} title={p.secApplied ? t('부라인 배치 — 부라인 티어 적용 (원래 {tier})', { tier: t(TIER_LABEL[p.baseTier] || p.baseTier) }) : undefined}>{t(TIER_LABEL[p.tier] || p.tier)}{p.secApplied ? <span className="tr-sec">{t('부라인')}</span> : null}</div>
        </div>
        <div className="tr-wr">
          {m.games ? (
            <>
              <div className="tr-wl">{t('{w}승 {l}패', { w: m.wins, l: m.losses })}</div>
              <div className="tr-wrline">
                <span className={`tr-pct ${wrCls(m.winrate)}`}>{pct}%</span>
                <span className="tr-bar"><i className={wrCls(m.winrate)} style={{ width: pct + '%' }} /></span>
              </div>
            </>
          ) : (
            <>
              <div className="tr-wl muted">–</div>
              <div className="tr-wrline"><span className="tr-none muted">{t('전적 없음')}</span><span className="tr-bar"><i style={{ width: 0 }} /></span></div>
            </>
          )}
        </div>
        <div className="tr-score">{Math.round(p.pts * 10) / 10}</div>
      </div>
    );
  };

  return (
    <div>
      {outliers.length > 0 && (
        <div className="warn-banner">
          ⚠️ {t('스머프/실력 격차 감지:')} {outliers.map((o) => `${o.name}(+${o.z.toFixed(1)}σ)`).join(', ')}
          {' '}— {t('이 선수는 로비에 라인 상대가 부족해 어느 라인을 가든 갭이 큽니다.')}
        </div>
      )}
      <div className="cand top">
        <div className="cand-head">
          <span className="title">{c.manual ? <>✏️ {t('수동 조정')}</> : <>⭐ {t('추천 조합')}</>}</span>
          <span className={`badge ${c.light}`}>{LIGHT_ICON[c.light]} {t(LIGHT_KR[c.light])}</span>
          <span className="badge dim">{t('총점차 {v}', { v: c.totalDiff.toFixed(1) })}</span>
          <span className="badge dim">{t('최대 라인갭 {v}', { v: c.maxGap.toFixed(1) })}</span>
          <span className="badge dim">{t('실력분포 차 {v}', { v: c.shapeDiff.toFixed(1) })}</span>
          {c.offRole > 0 && <span className="badge dim">{t('부포지션 {n}명', { n: c.offRole })}</span>}
          {onReroll && total > 0 && (
            <span className="cand-nav" title={t('미리 계산된 균형 조합들을 화살표로 넘겨보기')}>
              <button className="mini nav-arrow" onClick={onPrev} disabled={total <= 1} aria-label={t('이전 조합')}>◀</button>
              <span className="cand-count"><b>{total}</b> {t('개 조합')} <span className="muted">· {idx + 1}/{total}</span></span>
              <button className="mini nav-arrow" onClick={onReroll} disabled={total <= 1} aria-label={t('다음 조합')}>▶</button>
            </span>
          )}
        </div>
        <p className="hint" style={{ margin: '2px 0 12px' }}>
          {sel ? <b className="accent">{t('선수를 하나 더 클릭하면 자리를 바꿔요 (같은 선수 재클릭=취소)')}</b>
            : t('가능한 균형 조합 {n}개를 이미 다 계산해뒀어요 — ◀▶로 넘겨보거나, 선수 두 명을 클릭해 자리를 바꿀 수 있어요.', { n: total })}
        </p>
        {note && <div className="reroll-note">ℹ️ {t(note)}</div>}

        <div className="teamresult">
          <div className="tr-head">
            <div className="tr-hd tr-hd-a">{t('A팀')} <span className="tr-total">{t('팀 합계')} <b>{c.sumA.toFixed(1)}</b></span></div>
            <div className="tr-hd-pos">{t('포지션')}</div>
            <div className="tr-hd tr-hd-b">{t('B팀')} <span className="tr-total">{t('팀 합계')} <b>{c.sumB.toFixed(1)}</b></span></div>
          </div>
          {c.lanes.map((l) => {
            const warn = l.gap >= 10; // 갭 10점 이상만 ⚠️
            return (
              <div className="tr-row" key={l.pos}>
                {player('A', l)}
                <div className="tr-pos">
                  <span className="tr-pos-name">{t(POS_KR[l.pos])}</span>
                  <span className={`tr-gap ${warn ? 'warn' : ''}`}>{l.gap.toFixed(1)}{warn ? ' ⚠️' : ''}</span>
                </div>
                {player('B', l)}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
