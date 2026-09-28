'use client';
// 포지션별 승률 막대 — stats player의 positions(판수) + positionStats(승률)로 렌더.
// 막대 = 승/패 분할(초록/빨강), 우측에 승률% + 판수.
import { POS, POS_KR } from '../src/table.js';
import { useLang } from './i18n.jsx';

const wrCls = (w) => (w >= 0.6 ? 'green' : w >= 0.5 ? 'yellow' : 'red');

export default function PositionBar({ positions, stats, compact }) {
  const { t } = useLang();
  if (!positions) return null;
  const tot = POS.reduce((a, k) => a + (positions[k] || 0), 0);
  if (!tot) return <span className="muted" style={{ fontSize: 11 }}>{t('포지션 데이터 없음')}</span>;
  const items = POS.map((k) => ({ k, n: positions[k] || 0 })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n);
  return (
    <div className={`posbar ${compact ? 'compact' : ''}`}>
      {items.map((x) => {
        const st = stats?.[x.k];
        const wr = st ? Math.round(st.winrate * 100) : null;
        return (
          <div className="posbar-row" key={x.k}>
            <span className="posbar-lb">{t(POS_KR[x.k])}</span>
            <div className="wl-bar">
              {st ? (
                <>
                  <span className="win" style={{ width: wr + '%' }} />
                  <span className="lose" style={{ width: (100 - wr) + '%' }} />
                </>
              ) : <span className="win" style={{ width: 0 }} />}
            </div>
            <span className="posbar-pct">{st ? <b className={wrCls(st.winrate)}>{wr}%</b> : '-'}<span className="muted"> {t('{n}판', { n: x.n })}</span></span>
          </div>
        );
      })}
    </div>
  );
}
