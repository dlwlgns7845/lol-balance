'use client';
import { useState } from 'react';

// 챔피언 아이콘 (DDragon). 못 찾으면 첫 글자 원형 폴백.
export default function ChampImg({ name, iconUrl, size = 28, title }) {
  const [err, setErr] = useState(false);
  const url = iconUrl ? iconUrl(name) : null;
  const st = { width: size, height: size, borderRadius: '50%', flexShrink: 0 };
  if (!name) return <span className="champ-ph" style={st} />;
  if (!url || err) {
    return <span className="champ-ph" style={{ ...st, fontSize: size * 0.42 }} title={title || name}>{name[0]}</span>;
  }
  return <img className="champ-img" src={url} alt={name} title={title || name} style={st} onError={() => setErr(true)} />;
}
