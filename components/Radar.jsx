'use client';
// 의존성 없는 SVG 레이더 차트. metrics: [{label, value(0~1)}].
export default function Radar({ metrics, size = 220, color = '#a78bfa' }) {
  const n = metrics.length;
  const cx = size / 2, cy = size / 2, R = size / 2 - 34;
  const ang = (i) => (Math.PI * 2 * i) / n - Math.PI / 2;
  const pt = (i, r) => [cx + Math.cos(ang(i)) * R * r, cy + Math.sin(ang(i)) * R * r];
  const ringPath = (r) => metrics.map((_, i) => pt(i, r).join(',')).join(' ');
  const dataPts = metrics.map((m, i) => pt(i, Math.max(0.04, Math.min(1, m.value))).join(',')).join(' ');
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="radar">
      {[0.25, 0.5, 0.75, 1].map((r) => (
        <polygon key={r} points={ringPath(r)} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
      ))}
      {metrics.map((_, i) => {
        const [x, y] = pt(i, 1);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="rgba(255,255,255,0.06)" strokeWidth="1" />;
      })}
      <polygon points={dataPts} fill={color + '33'} stroke={color} strokeWidth="2" />
      {metrics.map((m, i) => {
        const [x, y] = pt(i, Math.max(0.04, Math.min(1, m.value)));
        return <circle key={i} cx={x} cy={y} r="3" fill={color} />;
      })}
      {metrics.map((m, i) => {
        const [x, y] = pt(i, 1.22);
        return (
          <text key={i} x={x} y={y} textAnchor="middle" dominantBaseline="middle"
            fontSize="10" fill="rgba(255,255,255,0.6)">{m.label}</text>
        );
      })}
    </svg>
  );
}
