// 스샷 → GPT-4o (GitHub Models, 무료) → 구조화 JSON. 서버 전용.
// 대상 포맷: 롤 클라이언트 종료 후 로비 스코어보드 (챔피언명이 텍스트로 표기 → 직접 읽음).
const ENDPOINT = 'https://models.inference.ai.azure.com/chat/completions';

const PROMPT = `이건 리그 오브 레전드 게임 종료 후 클라이언트 스코어보드 스크린샷이야. JSON으로만 응답해.
형식:
{"durationMin":27,"teams":[{"team":1,"win":true,"players":[{"name":"소환사명","champion":"영문챔피언명","k":0,"d":0,"a":0,"damage":0,"gold":0,"cs":0}]}]}

★가장 중요 — 행(row) 정렬:
- 스코어보드는 한 선수당 가로로 한 줄이야. 왼쪽부터: 챔피언 초상화 → 레벨 → 굵은 소환사명(그 아래 작은 챔피언명) → 룬 → 아이템 → K/D/A(그 아래 KDA 평점) → 딜량 막대 → CS 또는 골드.
- 한 선수의 모든 값(소환사명·챔피언·K/D/A·딜량·CS/골드)은 **반드시 같은 가로줄**에서 읽어. 절대로 위/아래 다른 줄의 숫자를 가져오지 마.
- TEAM 1은 위 5줄, TEAM 2는 아래 5줄. **화면에 보이는 위→아래 순서 그대로** 출력해. 재정렬 금지.
- 어떤 값이 툴팁·커서·오버레이(예: "Kill Score" 말풍선)에 가려졌거나 안 보이면, **그 항목만 0**으로 둬. 옆줄/윗줄/아랫줄 값을 복사하거나 추측하지 마.

세부 규칙:
- durationMin: 상단(또는 DEFEAT/VICTORY 헤더 옆)의 게임 시간 "분:초"를 **분(소수)**으로. 초는 60으로 나눠 반영(예 "39:32" → 39.5, "27:05" → 27.1). 안 보이면 0.
- 팀 2개(TEAM 1=team 1, TEAM 2=team 2), 각 5명. VICTORY(승리)로 표시된 팀이 win:true, DEFEAT(패배)는 win:false.
- name: 각 줄의 굵은 소환사명 그대로(한글 포함).
- champion: 그 소환사명 **바로 아래** 작은 글씨 챔피언명을 **화면에 보이는 문자 그대로** 적어. 한글 클라이언트면 한글 그대로(예: "드레이븐", "누누와 윌럼프", "아우렐리온 솔", "레넥톤"). **절대 영어로 번역·추측하지 마** — 모르는 신규 챔프라도 보이는 한글을 그대로 옮겨. 영문 클라면 영문 그대로. 안 보이면 빈칸.
- k/d/a: "12 / 4 / 25" 형식의 킬/데스/어시. 그 **아래 줄의 "9.3 KDA"(평점)는 절대 K/D/A로 쓰지 마** — 무시.
- damage: 칼 아이콘 칼럼의 챔피언에게 가한 피해량(예: 78,698 → 78698). 별★·왕관은 무시. 콤마 제거.
- 마지막 스탯 칼럼은 토글식이라 **골드 또는 CS** 중 하나만 보여:
  · 코인 아이콘 + 큰 숫자(보통 6,000~20,000) = 골드 → gold 채우고 cs=0.
  · 미니언/CS 아이콘 + 작은 숫자(보통 50~400) = CS → cs 채우고 gold=0. "/min" 하위숫자는 무시.
  값 크기로 판단해. 콤마 제거.
- 우측 친구목록·랭크 엠블럼·MVP 배지는 무시. 추측 말고 보이는 값만.`;

export async function extractScoreboard(dataUrl) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN 환경변수가 없습니다 (.env.local / Vercel)');
  const body = {
    model: 'gpt-4o',
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: PROMPT },
        { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } },
      ],
    }],
  };
  const r = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`GPT 호출 실패 (${r.status}) ${t.slice(0, 200)}`);
  }
  const j = await r.json();
  let txt = j.choices?.[0]?.message?.content || '';
  txt = txt.replace(/```json|```/g, '').trim();
  return JSON.parse(txt);
}
