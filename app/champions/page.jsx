'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useGroup } from '../../components/GroupProvider.jsx';
import { useDdragon } from '../../components/ddragon.js';
import ChampImg from '../../components/ChampImg.jsx';
import WinLossBar from '../../components/WinLossBar.jsx';
import { TIER_LABEL, tierClass } from '../../src/table.js';

const wrCls = (w) => (w >= 0.6 ? 'green' : w >= 0.5 ? 'yellow' : 'red');
const kdaCls = (r) => (r >= 5 ? 'kv-5' : r >= 4 ? 'kv-4' : r >= 3 ? 'kv-3' : '');

export default function ChampionsPage() {
  const { group } = useGroup();
  const gid = group?.id;
  const dd = useDdragon();
  const sp = useSearchParams();
  const id = sp.get('id');
  const [players, setPlayers] = useState([]);
  const [detail, setDetail] = useState(null);

  useEffect(() => {
    if (!gid) return;
    fetch('/api/stats?gid=' + gid).then((x) => x.json()).then((r) => r.ok && setPlayers(r.players));
  }, [gid]);

  useEffect(() => {
    if (!gid || !id) { setDetail(null); return; }
    setDetail(null);
    fetch(`/api/player/${id}?gid=${gid}`).then((x) => x.json()).then((r) => r.ok && setDetail(r));
  }, [gid, id]);

  const p = players.find((x) => x.id === id);
  const champs = detail?.champions || [];

  return (
    <div>
      <div className="page-head">
        <div className="title">
          <h1>모스트 챔피언{p ? ` · ${p.nickname || p.name}` : ''}</h1>
          <p className="sub" style={{ margin: 0 }}>이 선수가 플레이한 모든 챔피언 상세 (판수순).</p>
        </div>
        {p && <Link href={`/player?id=${p.id}`} className="btn ghost">← 전적으로</Link>}
      </div>

      {!p ? (
        <div className="panel center muted" style={{ padding: '28px 0' }}>선수를 찾을 수 없어요. <Link href="/player" className="accent">전적</Link>에서 선택하세요.</div>
      ) : !detail ? (
        <div className="panel center muted" style={{ padding: '28px 0' }}>불러오는 중…</div>
      ) : (
        <>
          <div className="panel prof-top">
            <div className="prof-name">
              <span className="prof-av">{(p.nickname || p.name || '?')[0]}</span>
              <div>
                <div className="prof-nm">{p.nickname || p.name}</div>
                <div className="prof-sub"><span className={tierClass(p.base_tier)}>{TIER_LABEL[p.base_tier]}</span> · {champs.length}챔피언 · {p.games}게임</div>
              </div>
            </div>
          </div>

          <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
            <table className="rec-history champ-table">
              <thead><tr><th className="l">챔피언</th><th>판수</th><th>승률</th><th>KDA</th><th className="l">K / D / A</th></tr></thead>
              <tbody>
                {champs.map((c) => (
                  <tr key={c.champion}>
                    <td className="l">
                      <span className="rh-champ"><ChampImg name={c.champion} iconUrl={dd.icon} size={30} /><b>{c.champion}</b></span>
                    </td>
                    <td className="ct-games">{c.games}판</td>
                    <td>
                      <div className="wr-cell">
                        <b className={wrCls(c.winrate)}>{Math.round(c.winrate * 100)}%</b>
                        <WinLossBar wins={c.wins} losses={c.games - c.wins} width={140} showText />
                      </div>
                    </td>
                    <td className={kdaCls(c.kda)}><b>{c.kda}</b></td>
                    <td className="l">{c.k} / <span className="red">{c.d}</span> / {c.a}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
