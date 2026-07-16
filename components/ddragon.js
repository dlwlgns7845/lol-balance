'use client';
import { useEffect, useState } from 'react';

// Data Dragon 챔피언 아트. 저장된 챔프명(표시명/ID/오타) → DDragon ID 정규화 → 아이콘/스플래시/로딩 URL.
let _cache = null;
async function loadMap() {
  if (_cache) return _cache;
  const versions = await fetch('https://ddragon.leagueoflegends.com/api/versions.json').then((r) => r.json());
  const v = versions[0];
  // 영어 + 한글 이름 둘 다 로드 → 한글 클라이언트 스샷도 정확히 매핑. 스펠·룬 맵도 함께.
  const [en, ko, summ, runes] = await Promise.all([
    fetch(`https://ddragon.leagueoflegends.com/cdn/${v}/data/en_US/champion.json`).then((r) => r.json()),
    fetch(`https://ddragon.leagueoflegends.com/cdn/${v}/data/ko_KR/champion.json`).then((r) => r.json()).catch(() => null),
    fetch(`https://ddragon.leagueoflegends.com/cdn/${v}/data/en_US/summoner.json`).then((r) => r.json()).catch(() => null),
    fetch(`https://ddragon.leagueoflegends.com/cdn/${v}/data/en_US/runesReforged.json`).then((r) => r.json()).catch(() => null),
  ]);
  // 소환사 주문: 숫자 key → 이미지 파일명
  const spellByKey = {};
  if (summ) for (const s of Object.values(summ.data)) spellByKey[String(s.key)] = s.image.full;
  // 룬: 퍽 id → 아이콘 경로 (핵심룬·스타일 공통)
  const perkIcon = {};
  if (runes) for (const style of runes) {
    perkIcon[style.id] = style.icon;
    for (const slot of style.slots) for (const r of slot.runes) perkIcon[r.id] = r.icon;
  }
  // 한글(가-힣)·영숫자만 남김 → 공백/기호/따옴표 무시. 한글 이름 유지.
  const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9가-힣]/g, '');
  const byKey = {};
  for (const c of Object.values(en.data)) {
    byKey[norm(c.id)] = c.id;
    byKey[norm(c.name)] = c.id;
  }
  if (ko) for (const c of Object.values(ko.data)) {
    byKey[norm(c.name)] = c.id; // 한글 이름 → 영문 ID
    byKey[norm(c.id)] = c.id;
  }
  Object.assign(byKey, { wukong: 'MonkeyKing', mf: 'MissFortune', ww: 'Warwick', tf: 'TwistedFate', 원숭이왕: 'MonkeyKing' });
  const id = (champ) => byKey[norm(champ)] || null;
  // 표시명: 내부 ID/오타/한글 → 영문 표시명(예: MonkeyKing → Wukong)
  const labelByKey = {};
  for (const c of Object.values(en.data)) { labelByKey[norm(c.id)] = c.name; labelByKey[norm(c.name)] = c.name; }
  if (ko) for (const c of Object.values(ko.data)) labelByKey[norm(c.name)] = en.data[c.id]?.name || c.name;
  const label = (champ) => labelByKey[norm(champ)] || champ;
  _cache = {
    version: v, id, label,
    icon: (c) => (id(c) ? `https://ddragon.leagueoflegends.com/cdn/${v}/img/champion/${id(c)}.png` : null),
    splash: (c) => (id(c) ? `https://ddragon.leagueoflegends.com/cdn/img/champion/splash/${id(c)}_0.jpg` : null),
    loading: (c) => (id(c) ? `https://ddragon.leagueoflegends.com/cdn/img/champion/loading/${id(c)}_0.jpg` : null),
    spell: (key) => (key && spellByKey[String(key)] ? `https://ddragon.leagueoflegends.com/cdn/${v}/img/spell/${spellByKey[String(key)]}` : null),
    rune: (perkId) => (perkId && perkIcon[perkId] ? `https://ddragon.leagueoflegends.com/cdn/img/${perkIcon[perkId]}` : null),
  };
  return _cache;
}

const NOOP = () => null;
export function useDdragon() {
  const [dd, setDd] = useState({ icon: NOOP, splash: NOOP, loading: NOOP, spell: NOOP, rune: NOOP, label: (c) => c, ready: false });
  useEffect(() => { loadMap().then((m) => setDd({ ...m, ready: true })).catch(() => {}); }, []);
  return dd;
}
// 하위호환: 아이콘 함수만
export function useChampIcon() { return useDdragon().icon; }
