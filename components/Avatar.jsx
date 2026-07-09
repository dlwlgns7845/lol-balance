'use client';
// 선수 아바타 원형. 기본=이름 해시로 고정 색+이니셜(빈 동그라미 자동 채움).
// profile={ color, emoji } 있으면 커스텀 override.

export function hueFromName(name) {
  let h = 0;
  const s = name || '';
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}

export default function Avatar({ name = '', profile, size = 34 }) {
  const color = profile?.color || `hsl(${hueFromName(name)} 52% 45%)`;
  const label = profile?.emoji || (name.trim()[0] || '?').toUpperCase();
  const st = {
    width: size, height: size, borderRadius: '50%', flexShrink: 0,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    background: color, color: '#fff', fontWeight: 700, fontSize: Math.round(size * 0.44),
    lineHeight: 1, userSelect: 'none', overflow: 'hidden',
  };
  return <span style={st} title={name} aria-hidden>{label}</span>;
}
