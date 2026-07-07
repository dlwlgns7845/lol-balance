'use client';
import { POS, POS_KR } from '../src/table.js';

function nextRole(cur) {
  if (!cur) return 'primary';
  if (cur === 'primary') return 'secondary';
  return undefined;
}

// roles: { top:'primary', mid:'secondary' } 형태. onChange(newRoles)
export default function PositionToggles({ roles, onChange }) {
  function cycle(pos) {
    const r = { ...roles };
    const nv = nextRole(r[pos]);
    if (nv) r[pos] = nv;
    else delete r[pos];
    onChange(r);
  }
  return (
    <div className="pos-toggles">
      {POS.map((pos) => {
        const r = roles[pos];
        const cls = r === 'primary' ? 'on' : r === 'secondary' ? 'sec' : '';
        return (
          <button key={pos} className={cls} type="button" onClick={() => cycle(pos)}>
            {POS_KR[pos]}{r === 'secondary' && <sup>부</sup>}
          </button>
        );
      })}
    </div>
  );
}

// roles 맵 ↔ DB 배열 변환 헬퍼
export function rolesToArrays(roles) {
  const primary = [], secondary = [];
  for (const [pos, lv] of Object.entries(roles || {})) {
    if (lv === 'primary') primary.push(pos);
    else if (lv === 'secondary') secondary.push(pos);
  }
  return { primary, secondary };
}

export function arraysToRoles(primary = [], secondary = []) {
  const r = {};
  for (const p of primary) r[p] = 'primary';
  for (const s of secondary) r[s] = 'secondary';
  return r;
}
