// .rofl(리플레이) 파서 — 순수 로직, 브라우저·Node 공용. 입력: Uint8Array.
// 버전 무관: 바이너리 헤더 대신 메타데이터 JSON 블록 직접 스캔 (2023~2026 검증).
// 이름 필드: RIOT_ID_GAME_NAME(신) / NAME(구) 폴백.

const POS_MAP = { TOP: 'top', JUNGLE: 'jungle', MIDDLE: 'mid', BOTTOM: 'adc', UTILITY: 'sup' };

function indexOfAscii(buf, str) {
  const t = new TextEncoder().encode(str);
  outer: for (let i = 0; i <= buf.length - t.length; i += 1) {
    for (let j = 0; j < t.length; j += 1) if (buf[i + j] !== t[j]) continue outer;
    return i;
  }
  return -1;
}

// start에서 balanced JSON 객체 끝 인덱스(문자열 이스케이프 고려)
function jsonEnd(buf, start) {
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < buf.length; i += 1) {
    const c = buf[i];
    if (inStr) { if (esc) esc = false; else if (c === 0x5c) esc = true; else if (c === 0x22) inStr = false; }
    else if (c === 0x22) inStr = true;
    else if (c === 0x7b) depth += 1;
    else if (c === 0x7d) { depth -= 1; if (depth === 0) return i + 1; }
  }
  return -1;
}

export function parseRoflBuffer(buf) {
  const start = indexOfAscii(buf, '{"gameLength"');
  if (start < 0) throw new Error('리플 메타데이터를 못 찾았어요 (손상됐거나 지원 안 되는 파일).');
  const end = jsonEnd(buf, start);
  const meta = JSON.parse(new TextDecoder().decode(buf.slice(start, end)));
  const stats = JSON.parse(meta.statsJson || '[]');
  if (stats.length !== 10) throw new Error(`경기 기록이 10명이 아니에요 (${stats.length}명 — 리메이크/커스텀?).`);

  const n = (o, k) => Number(o[k] || 0);
  const players = stats.map((p) => {
    const gn = p.RIOT_ID_GAME_NAME || p.NAME || '';
    const tag = p.RIOT_ID_TAG_LINE || '';
    return {
      team: String(p.TEAM) === '200' ? 'B' : 'A',
      gameName: gn, tag,
      riotId: tag ? `${gn}#${tag}` : gn,
      champion: p.SKIN || '',
      position: POS_MAP[p.TEAM_POSITION] || null,
      k: n(p, 'CHAMPIONS_KILLED'), d: n(p, 'NUM_DEATHS'), a: n(p, 'ASSISTS'),
      cs: n(p, 'MINIONS_KILLED') + n(p, 'NEUTRAL_MINIONS_KILLED'),
      damage: n(p, 'TOTAL_DAMAGE_DEALT_TO_CHAMPIONS'),
      gold: n(p, 'GOLD_EARNED'),
      win: p.WIN === 'Win',
      detail: {
        level: n(p, 'LEVEL'),
        items: [0, 1, 2, 3, 4, 5, 6].map((i) => n(p, 'ITEM' + i)),
        spells: [n(p, 'SUMMONER_SPELL_1'), n(p, 'SUMMONER_SPELL_2')],
        keystone: n(p, 'KEYSTONE_ID'), primaryStyle: n(p, 'PERK_PRIMARY_STYLE'), subStyle: n(p, 'PERK_SUB_STYLE'),
        visionScore: n(p, 'VISION_SCORE'), wardsPlaced: n(p, 'WARD_PLACED'), wardsKilled: n(p, 'WARD_KILLED'), controlWards: n(p, 'VISION_WARDS_BOUGHT_IN_GAME'),
        dmgTaken: n(p, 'TOTAL_DAMAGE_TAKEN'), dmgToTurrets: n(p, 'TOTAL_DAMAGE_DEALT_TO_TURRETS'), dmgToObjectives: n(p, 'TOTAL_DAMAGE_DEALT_TO_OBJECTIVES'),
        physDmg: n(p, 'PHYSICAL_DAMAGE_DEALT_TO_CHAMPIONS'), magicDmg: n(p, 'MAGIC_DAMAGE_DEALT_TO_CHAMPIONS'), trueDmg: n(p, 'TRUE_DAMAGE_DEALT_TO_CHAMPIONS'),
        selfMitigated: n(p, 'TOTAL_DAMAGE_SELF_MITIGATED'), healTeam: n(p, 'TOTAL_HEAL_ON_TEAMMATES'), shieldTeam: n(p, 'TOTAL_DAMAGE_SHIELDED_ON_TEAMMATES'),
        ccTime: n(p, 'TIME_CCING_OTHERS'),
        double: n(p, 'DOUBLE_KILLS'), triple: n(p, 'TRIPLE_KILLS'), quadra: n(p, 'QUADRA_KILLS'), penta: n(p, 'PENTA_KILLS'),
        turrets: n(p, 'TURRETS_KILLED'),
      },
    };
  });

  const teamObj = (team) => {
    const ps = stats.filter((p) => (String(p.TEAM) === '200' ? 'B' : 'A') === team);
    const s = (k) => ps.reduce((acc, p) => acc + n(p, k), 0);
    return {
      kills: s('CHAMPIONS_KILLED'), gold: s('GOLD_EARNED'),
      dragons: s('DRAGON_KILLS'), elder: s('ELDER_DRAGON_KILLS'),
      barons: s('BARON_KILLS'), heralds: s('RIFT_HERALD_KILLS'),
      grubs: s('HORDE_KILLS'), atakhan: s('ATAKHAN_KILLS'),
      towers: s('TURRETS_KILLED'), inhibs: s('BARRACKS_KILLED'), objStolen: s('OBJECTIVES_STOLEN'),
    };
  };

  const winner = players.find((p) => p.win)?.team || 'A';
  return {
    players, winner,
    objectives: { A: teamObj('A'), B: teamObj('B') },
    durationSec: Math.round((meta.gameLength || 0) / 1000),
    durationMin: Math.round((meta.gameLength || 0) / 60000),
  };
}
