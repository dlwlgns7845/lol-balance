'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { translate } from '../src/i18n/index.js';

// 언어 선택: 저장값(localStorage) > 브라우저 언어(한국어면 KO, 그 외 EN). 뷰어별 설정 — 서버 저장 안 함.
const KEY = 'lol-balance-lang';
let currentLang = 'ko'; // 훅 밖(이벤트 핸들러·유틸)에서 쓰는 tt()용

function detectLang() {
  try { const s = localStorage.getItem(KEY); if (s === 'ko' || s === 'en') return s; } catch { /* 무시 */ }
  const nl = ((typeof navigator !== 'undefined' && (navigator.languages?.[0] || navigator.language)) || 'ko').toLowerCase();
  return nl.startsWith('ko') ? 'ko' : 'en';
}

const LangCtx = createContext({ lang: 'ko', setLang: () => {}, t: (s, v) => translate('ko', s, v) });

export function LangProvider({ children }) {
  const [lang, setLangState] = useState('ko');
  // 감지값을 전역에도 먼저 반영 — 다음 렌더에서 tt()가 바로 새 언어를 쓰도록 (effect 순서상 늦으면 첫 화면 일부가 한국어로 남음)
  useEffect(() => { const l = detectLang(); currentLang = l; setLangState(l); }, []);
  useEffect(() => {
    currentLang = lang;
    try { document.documentElement.lang = lang; } catch { /* 무시 */ }
  }, [lang]);
  const setLang = useCallback((l) => {
    if (l !== 'ko' && l !== 'en') return;
    try { localStorage.setItem(KEY, l); } catch { /* 무시 */ }
    currentLang = l;
    setLangState(l);
  }, []);
  const t = useCallback((s, vars) => translate(lang, s, vars), [lang]);
  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <LangCtx.Provider value={value}>{children}</LangCtx.Provider>;
}

export const useLang = () => useContext(LangCtx);
export const useT = () => useContext(LangCtx).t;
// 훅을 못 쓰는 곳(모듈 함수·alert/confirm 등)용. 렌더 중 결과엔 쓰지 말 것(언어 바뀌어도 재렌더 안 됨).
export const tt = (s, vars) => translate(currentLang, s, vars);

// KO | EN 세그먼트 스위치 — 첫 화면(바깥 노출)과 설정 모달(안쪽)에서 같은 모양으로 사용.
export function LangSwitch({ className = '' }) {
  const { lang, setLang } = useLang();
  return (
    <div className={`lang-switch ${className}`} role="group" aria-label="Language">
      <button type="button" className={lang === 'ko' ? 'on' : ''} aria-pressed={lang === 'ko'} onClick={() => setLang('ko')}>한국어</button>
      <button type="button" className={lang === 'en' ? 'on' : ''} aria-pressed={lang === 'en'} onClick={() => setLang('en')}>English</button>
    </div>
  );
}
