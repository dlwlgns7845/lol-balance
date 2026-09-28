'use client';
// 한 게임(5v5) 결과 래퍼 — 리롤/스왑 상태를 게임별로 격리. 20명 모드에서 2개 렌더.
import { useEffect, useState } from 'react';
import Results from './Results.jsx';
import { scoreTeams } from '../src/engine.js';
import { useLang } from './i18n.jsx';

export default function GameResult({ result, playerMap, opts = {}, meta, label }) {
  const { t } = useLang();
  const [candIdx, setCandIdx] = useState(0);
  const [view, setView] = useState(null);
  const [sel, setSel] = useState(null);
  const [note, setNote] = useState(null);

  useEffect(() => {
    setCandIdx(0); setView(result?.candidates?.[0] || null); setSel(null); setNote(null);
  }, [result]);

  function reroll() {
    if (!result?.candidates?.length) return;
    if (result.candidates.length <= 1) { setNote(t('이게 유일한 최적 배치예요.')); return; }
    const ni = (candIdx + 1) % result.candidates.length;
    setCandIdx(ni); setView(result.candidates[ni]); setSel(null); setNote(null);
  }

  function doSwap(team, pos) {
    if (!view) return;
    if (!sel) { setSel({ team, pos }); return; }
    if (sel.team === team && sel.pos === pos) { setSel(null); return; }
    const A = view.lanes.map((l) => playerMap.get(l.a.name));
    const B = view.lanes.map((l) => playerMap.get(l.b.name));
    const i1 = view.lanes.findIndex((l) => l.pos === sel.pos);
    const i2 = view.lanes.findIndex((l) => l.pos === pos);
    const a1 = sel.team === 'A' ? A : B, a2 = team === 'A' ? A : B;
    const t = a1[i1]; a1[i1] = a2[i2]; a2[i2] = t;
    try { const snap = scoreTeams(A, B, opts); setView({ ...snap, manual: true }); } catch { /* noop */ }
    setSel(null);
  }

  return (
    <>
      {label && (
        <h2 style={{ margin: '20px 2px 8px' }}>{t(label)}
          {result && !result.feasible && <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}> · {t('포지션이 안 맞아 편성 실패 — 포지션 조정 또는 스왑 필요')}</span>}
        </h2>
      )}
      <Results feasible={result?.feasible} outliers={result?.outliers || []} view={view}
        onReroll={reroll} onSwap={doSwap} sel={sel} meta={meta} note={note}
        idx={candIdx} total={result?.candidates?.length || 0} />
    </>
  );
}
