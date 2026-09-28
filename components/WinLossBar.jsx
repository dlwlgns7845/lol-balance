'use client';
// 승/패 분할 막대 (초록 승 / 빨강 패). showText면 막대 안에 "N승"·"M패" 표기.
import { useLang } from './i18n.jsx';
export default function WinLossBar({ wins = 0, losses = 0, width, showText }) {
  const { t } = useLang();
  const g = wins + losses;
  const wp = g ? Math.round((wins / g) * 100) : 0;
  return (
    <div className={`wl-bar ${showText ? 'labeled' : ''}`} style={width ? { width } : undefined}>
      <span className="win" style={{ width: wp + '%' }}>{showText && wins > 0 ? t('{n}승', { n: wins }) : ''}</span>
      <span className="lose" style={{ width: (100 - wp) + '%' }}>{showText && losses > 0 ? t('{n}패', { n: losses }) : ''}</span>
    </div>
  );
}
