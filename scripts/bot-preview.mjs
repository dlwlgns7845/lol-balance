// 봇 메시지 미리보기 — 10명 없이도 디코 큐/팀확정 임베드를 텍스트로 렌더.
//   실행: node scripts/bot-preview.mjs
//   목적: 디코 봇 인터페이스(src/discord-queue.js)를 실제 데이터 없이 눈으로 확인.
//   ⚠️ 색·아바타·버튼 스타일은 텍스트로 근사만 함. 픽셀 정확한 확인은 디코에서.
import { queueMessage, buildTeamsRanked, buildMetaMap } from '../src/discord-queue.js';

// ── mock 10명 (라인당 2명) ──
const mk = (id, name, tier, prim, sec = []) => ({
  id: 'p' + id, discord_id: String(100 + id), display_name: name, base_tier: tier,
  primary_positions: prim, secondary_positions: sec,
  accounts: [{ game_name: name, tag_line: 'NA1', is_main: true }],
});
const persons = [
  mk(1, '아리스', 'D2', ['top'], ['mid']),
  mk(2, '텐덕', 'D4', ['top']),
  mk(3, 'KOREAN', 'D1', ['jungle'], ['top']),
  mk(4, '니모', 'E4', ['jungle']),
  mk(5, '비밀', 'D2', ['mid']),
  mk(6, '볍진', 'D3', ['mid']),
  mk(7, 'Noobiny', 'E4', ['adc'], ['top']),
  mk(8, '병진', 'D3', ['adc']),
  mk(9, '알바', 'E1', ['sup']),
  mk(10, 'Buller', 'P3', ['sup']),
];
const signups = persons.map((p) => ({
  discord_id: p.discord_id, name: p.display_name,
  main: p.primary_positions[0], sub: p.secondary_positions[0] || null,
}));
const queue = { id: 'q1', size: 10 };

// ── 임베드 → 읽기 쉬운 텍스트 ──
const line = '─'.repeat(56);
function render(msg, label) {
  const e = msg.embeds[0];
  console.log('\n' + line + '\n▓▓ ' + label + '\n' + line);
  console.log('제목: ' + e.title);
  if (e.description) console.log('\n' + e.description);
  (e.fields || []).forEach((f) => console.log('\n【 ' + f.name + ' 】\n' + f.value));
  if (e.footer) console.log('\n· ' + e.footer.text);
  (msg.components || []).forEach((row) => {
    const cells = row.components.map((c) => {
      if (c.type === 3) return `▼ [${c.placeholder}]`;
      const style = { 1: '🔵', 2: '⬜', 3: '🟢', 4: '🔴' }[c.style] || '';
      return `${style}[ ${c.label}${c.disabled ? ' ·비활성' : ''} ]`;
    }).join('  ');
    console.log('\n버튼줄: ' + cells);
  });
}

const metaMap = buildMetaMap(persons);
render(queueMessage(queue, signups, false, null, 0, null, metaMap), '모집중 (OPEN)');
const ranked = buildTeamsRanked({ ...queue, status: 'closed' }, signups, metaMap);
render(
  queueMessage({ ...queue, status: 'closed' }, signups, true, ranked[0], 0, null, metaMap, ranked.length),
  `마감·팀확정 (CLOSED) — 총 ${ranked.length}개 조합`,
);
console.log('\n' + line + '\n(◀/▶ 눌러 조합 넘길 때: 위 "1 / ' + ranked.length + '" 카운터와 desc가 갱신됩니다)\n');
