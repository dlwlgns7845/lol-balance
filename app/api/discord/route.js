// Discord 인터랙션 엔드포인트 (슬래시 커맨드). Discord가 여기로 POST → 서명검증 후 응답.
// 상시봇(gateway) 아님 = 서버리스라 항상 켜져 있음(컴퓨터 꺼짐 무관).
import crypto from 'crypto';
import { NextResponse } from 'next/server';
import { getStats } from '../../../src/repo.js';

export const runtime = 'nodejs';

const PUBLIC_KEY = process.env.DISCORD_PUBLIC_KEY;
const DEFAULT_GID = process.env.DISCORD_DEFAULT_GID; // 이 봇이 서빙할 내전 방 gid

// Ed25519 서명 검증 (Discord 요구). 내장 crypto로 raw 공개키 → SPKI DER 래핑.
function verifySignature(sig, ts, body) {
  if (!sig || !ts || !PUBLIC_KEY) return false;
  try {
    const der = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(PUBLIC_KEY, 'hex')]);
    const key = crypto.createPublicKey({ key: der, format: 'der', type: 'spki' });
    return crypto.verify(null, Buffer.from(ts + body), key, Buffer.from(sig, 'hex'));
  } catch { return false; }
}

const reply = (content, embeds) => NextResponse.json({ type: 4, data: embeds ? { embeds } : { content } });

async function leaderboard() {
  if (!DEFAULT_GID) return reply('⚠️ 방 설정(DISCORD_DEFAULT_GID)이 없어요.');
  const { players } = await getStats(DEFAULT_GID);
  const top = players.filter((p) => p.games >= 3).sort((a, b) => b.score - a.score).slice(0, 10);
  if (!top.length) return reply('아직 3판 이상 뛴 선수가 없어요.');
  const medal = (i) => ['🥇', '🥈', '🥉'][i] || `${i + 1}.`;
  const lines = top.map((p, i) => `${medal(i)} **${p.nickname || p.name}** — ${p.score}점 · ${Math.round(p.winrate * 100)}% (${p.wins}승${p.losses}패)`);
  return reply(null, [{ title: '🏆 내전 리더보드 · 3판+', description: lines.join('\n'), color: 0xe8c07d }]);
}

export async function POST(request) {
  const body = await request.text();
  const sig = request.headers.get('x-signature-ed25519');
  const ts = request.headers.get('x-signature-timestamp');
  if (!verifySignature(sig, ts, body)) return new NextResponse('invalid request signature', { status: 401 });

  const interaction = JSON.parse(body);
  if (interaction.type === 1) return NextResponse.json({ type: 1 }); // PING → PONG (엔드포인트 검증)

  if (interaction.type === 2) { // 슬래시 커맨드
    const name = interaction.data?.name;
    try {
      if (name === '리더보드') return await leaderboard();
    } catch (e) { return reply('오류: ' + e.message); }
    return reply('알 수 없는 명령어예요.');
  }
  return NextResponse.json({ type: 4, data: { content: '지원하지 않는 인터랙션' } });
}
