'use client';
// 사람 이름 옆 칭호 뱃지 (이모지 아이콘 + 툴팁). titles = [{ic, title}]
import { useGroup } from './GroupProvider.jsx';
import { useLang } from './i18n.jsx';

// 연승/연패 뱃지는 서버가 이미 숫자를 박아 보낸다 ("3연승 중") — 패턴 추출 후 자리표시자로 재번역.
function titleText(t, raw) {
  const streakW = /^(\d+)연승 중$/.exec(raw);
  if (streakW) return t('{n}연승 중', { n: streakW[1] });
  const streakL = /^(\d+)연패 중$/.exec(raw);
  if (streakL) return t('{n}연패 중', { n: streakL[1] });
  return t(raw);
}

export default function TitleBadges({ titles, max = 4 }) {
  const { showAwards } = useGroup() || {};
  const { t } = useLang();
  if (showAwards === false) return null; // 방 설정에서 칭호 숨김
  if (!titles || !titles.length) return null;
  return (
    <span className="title-badges">
      {titles.slice(0, max).map((bd, i) => (
        <span key={i} className="tbadge" title={titleText(t, bd.title)}>{bd.ic}{bd.label != null && <b className="tb-num">{bd.label}</b>}</span>
      ))}
    </span>
  );
}
