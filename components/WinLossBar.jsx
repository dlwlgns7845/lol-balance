'use client';
// 승/패 분할 막대 (초록 승 / 빨강 패). showText면 막대 안에 "N승"·"M패" 표기.
export default function WinLossBar({ wins = 0, losses = 0, width, showText }) {
  const g = wins + losses;
  const wp = g ? Math.round((wins / g) * 100) : 0;
  return (
    <div className={`wl-bar ${showText ? 'labeled' : ''}`} style={width ? { width } : undefined}>
      <span className="win" style={{ width: wp + '%' }}>{showText && wins > 0 ? `${wins}승` : ''}</span>
      <span className="lose" style={{ width: (100 - wp) + '%' }}>{showText && losses > 0 ? `${losses}패` : ''}</span>
    </div>
  );
}
