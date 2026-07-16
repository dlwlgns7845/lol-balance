'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { TIER_LABEL } from '../src/table.js';
import Radar from './Radar.jsx';
import ChampImg from './ChampImg.jsx';
import PositionBar from './PositionBar.jsx';
import WinLossBar from './WinLossBar.jsx';
import Avatar from './Avatar.jsx';

function wrClass(w) { return w >= 0.6 ? 'green' : w >= 0.5 ? 'yellow' : 'red'; }
function kdaClass(r) { return r >= 5 ? 'kv-5' : r >= 4 ? 'kv-4' : r >= 3 ? 'kv-3' : ''; }
function fmtD(s) { if (!s) return ''; const d = new Date(s); return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }

export default function PlayerCard({ player: p, gid, max, dd, onClose, detail: detailProp, historyLabel = '내전 전적', showDetailLinks = true, onDetail }) {
  const [detailState, setDetail] = useState(null);
  const detail = detailProp || detailState; // detail을 직접 주면(멸망전 등) fetch 안 함
  useEffect(() => {
    if (detailProp || !gid || !p) return;
    setDetail(null);
    fetch(`/api/player/${p.id}?gid=${gid}`).then((x) => x.json()).then((r) => r.ok && setDetail(r));
  }, [gid, p, detailProp]);

  const hero = dd.splash(p.topChamps?.[0]?.champion);
  const radar = [
    { label: '승률', value: p.winrate },
    { label: 'KDA', value: (p.kda || 0) / max.kda },
    { label: '딜량', value: (p.avgDamage || 0) / max.dmg },
    { label: 'CS', value: (p.avgCs || 0) / max.cs },
    { label: '챔프폭', value: (p.champPool || 0) / max.pool },
  ];
  const kpi = (label, val, cls) => <div><span className="muted">{label}</span><b className={cls || ''}>{val}</b></div>;

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="pcard" onClick={(e) => e.stopPropagation()}>
        <button className="pcard-x" onClick={onClose}>✕</button>
        <div className="pcard-hero" style={hero ? { backgroundImage: `linear-gradient(90deg, var(--panel) 20%, rgba(16,16,25,.55) 50%, transparent 74%), radial-gradient(ellipse 78% 135% at 80% 42%, transparent 38%, var(--panel) 86%), url(${hero})` } : {}}>
          <div className="ph-id">
            <div className="pc-avatar" style={{ background: 'none', padding: 0 }}><Avatar name={p.nickname || p.name} profile={p.profile} size={50} /></div>
            <div>
              <div className="pc-name">{p.nickname || p.name}</div>
              <div className="muted" style={{ fontSize: 12 }}>{p.nickname ? p.name + ' · ' : ''}{TIER_LABEL[p.base_tier]} · {p.games}게임</div>
              <div className="ph-tags">
                <span className={`ph-tag ${kdaClass(p.kda || 0)}`}>KDA {p.kda != null ? p.kda.toFixed(2) : '-'}</span>
                <span className={`ph-tag ${wrClass(p.winrate)}`}>승률 {Math.round(p.winrate * 100)}%</span>
                <span className="ph-tag"><b className="green">{p.wins}</b>승 <b className="red">{p.losses}</b>패</span>
                {onDetail && <button className="ph-tag" onClick={onDetail} style={{ cursor: 'pointer', background: 'rgba(79,182,214,.18)', border: '1px solid rgba(79,182,214,.45)', color: '#8fd6ec', fontWeight: 700 }}>📄 상세보기 →</button>}
              </div>
            </div>
          </div>
        </div>

        <div className="pcard-body">
          <div className="pc-col">
            <h3>기본 스탯</h3>
            <div className="pc-kpis">
              {kpi('게임 수', p.games)}
              {kpi('KDA', p.kda != null ? p.kda.toFixed(2) : '-', kdaClass(p.kda || 0))}
              {kpi('🏅 MVP', p.mvp, 'gold')}
              {kpi('⭐ ACE', p.ace, 'accent')}
              {kpi('평균 딜량', p.statGames ? p.avgDamage.toLocaleString() : '-')}
              {kpi('평균 CS', p.statGames ? p.avgCs.toLocaleString() : '-')}
              {kpi('총 K/D/A', p.statGames ? `${(p.totalK || 0).toLocaleString()} / ${(p.totalD || 0).toLocaleString()} / ${(p.totalA || 0).toLocaleString()}` : '-')}
            </div>
            {p.positions && (
              <>
                <h3 style={{ marginTop: 16 }}>포지션</h3>
                <PositionBar positions={p.positions} stats={p.positionStats} />
              </>
            )}
            <h3 style={{ marginTop: 16 }}>능력치</h3>
            <Radar metrics={radar} size={220} />
          </div>

          <div className="pc-col">
            <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              모스트 챔피언
              {showDetailLinks && detail?.champions?.length > 5 && <Link href={`/champions?id=${p.id}`} onClick={onClose} className="accent" style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 600 }}>상세보기 →</Link>}
            </h3>
            <div className="pc-champs">
              {detail ? (detail.champions.length ? detail.champions.slice(0, 5).map((c) => (
                <div className="pc-champ" key={c.champion}>
                  <ChampImg name={c.champion} iconUrl={dd.icon} size={32} />
                  <div className="pcc-info">
                    <span className="pcc-name">{c.champion}</span>
                    <span className="muted" style={{ fontSize: 11 }}>{c.games}판 · KDA {c.kda} · {c.k}/<span className="red">{c.d}</span>/{c.a}</span>
                  </div>
                  <WinLossBar wins={c.wins} losses={c.games - c.wins} showText />
                  <span className={`pcc-wr ${wrClass(c.winrate)}`}>{Math.round(c.winrate * 100)}%</span>
                </div>
              )) : <span className="muted">기록 없음</span>) : <span className="muted">…</span>}
            </div>

            <div className="pc-duos">
              <div>
                <h3>베스트 듀오</h3>
                {detail?.best?.length ? detail.best.map((d) => (
                  <div className="duo-row" key={d.name}><span>{d.name}</span><span className="muted">{d.games}게임</span><b className={wrClass(d.winrate)}>{Math.round(d.winrate * 100)}%</b></div>
                )) : <span className="muted">-</span>}
              </div>
              <div>
                <h3>워스트 듀오</h3>
                {detail?.worst?.length ? detail.worst.map((d) => (
                  <div className="duo-row" key={d.name}><span>{d.name}</span><span className="muted">{d.games}게임</span><b className={wrClass(d.winrate)}>{Math.round(d.winrate * 100)}%</b></div>
                )) : <span className="muted">-</span>}
              </div>
            </div>

            <h3 style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
              {historyLabel} {detail?.history ? <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>{detail.history.length}게임</span> : null}
              {onDetail ? <button onClick={onDetail} className="accent" style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>상세보기 →</button> : (showDetailLinks && <Link href={`/player?id=${p.id}`} onClick={onClose} className="accent" style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 600 }}>상세보기 →</Link>)}
            </h3>
            <div className="pc-history no-scroll">
              {detail ? (detail.history.length ? detail.history.slice(0, 5).map((m, i) => {
                const ratio = (m.d ? (((m.k || 0) + (m.a || 0)) / m.d) : ((m.k || 0) + (m.a || 0))).toFixed(2);
                return (
                  <div key={i} className={`pch-row ${m.win ? 'win' : 'lose'}`}>
                    <span className={`pch-res ${m.win ? 'g' : 'r'}`}>{m.win ? '승' : '패'}</span>
                    <ChampImg name={m.champion} iconUrl={dd.icon} size={30} />
                    <div className="pch-mid">
                      <span className="pch-champ">{m.champion || '?'}</span>
                      <span className="pch-kda">{m.k}/<span className="red">{m.d}</span>/{m.a} <span className={`pch-ratio ${kdaClass(+ratio)}`}>{ratio}</span></span>
                    </div>
                    <span className="pch-date muted">{fmtD(m.played_at)}</span>
                  </div>
                );
              }) : <span className="muted">기록 없음</span>) : <span className="muted">…</span>}
            </div>
            {detail?.history?.length > 5 && (
              <div className="pc-more-note muted">최근 5게임만 표시 · 위 <b>상세보기</b>에서 전체 {detail.history.length}게임</div>
            )}

            {detail?.records && (detail.records.maxKill || detail.records.maxKda) && (
              <div className="pc-records">
                {detail.records.maxKill && <span>🗡 최다 킬 <b>{detail.records.maxKill.kills}</b> <span className="muted">{detail.records.maxKill.champion}</span></span>}
                {detail.records.maxKda && <span>📈 최고 KDA <b>{detail.records.maxKda.v}</b> <span className="muted">{detail.records.maxKda.champion}</span></span>}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
