'use client';
// 선수 아바타 원형. 우선순위: 프로필 사진(업로드/디코) > 이름 해시 고정색+이니셜.
import { useState } from 'react';

export function hueFromName(name) {
  let h = 0;
  const s = name || '';
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}

export default function Avatar({ name = '', profile, size = 34 }) {
  const [imgErr, setImgErr] = useState(false);
  const p = profile || {};
  const base = {
    width: size, height: size, borderRadius: '50%', flexShrink: 0,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden', userSelect: 'none', lineHeight: 1,
  };
  if (p.avatar && !imgErr) {
    return <img src={p.avatar} alt={name} title={name} style={{ ...base, objectFit: 'cover' }} onError={() => setImgErr(true)} />;
  }
  const color = `hsl(${hueFromName(name)} 52% 45%)`;
  const label = (name.trim()[0] || '?').toUpperCase();
  return <span style={{ ...base, background: color, color: '#fff', fontWeight: 700, fontSize: Math.round(size * 0.44) }} title={name} aria-hidden>{label}</span>;
}
