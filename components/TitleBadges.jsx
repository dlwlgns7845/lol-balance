'use client';
// 사람 이름 옆 칭호 뱃지 (이모지 아이콘 + 툴팁). titles = [{ic, title}]
import { useGroup } from './GroupProvider.jsx';
export default function TitleBadges({ titles, max = 4 }) {
  const { showAwards } = useGroup() || {};
  if (showAwards === false) return null; // 방 설정에서 칭호 숨김
  if (!titles || !titles.length) return null;
  return (
    <span className="title-badges">
      {titles.slice(0, max).map((t, i) => (
        <span key={i} className="tbadge" title={t.title}>{t.ic}{t.label != null && <b className="tb-num">{t.label}</b>}</span>
      ))}
    </span>
  );
}
