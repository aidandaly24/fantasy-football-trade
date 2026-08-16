import { Activity, ExternalLink, Info, RefreshCw, ShieldCheck } from 'lucide-react'
import { useMemo, useState } from 'react'
import { refreshSportsbookEvidence } from '../api'
import {
  SPORTSBOOK_SOURCE_URL,
  eligibleSportsbookPlayers,
  type SportsbookBundle,
  type SportsbookMarketConsensus,
} from '../sportsbook'
import type { Asset } from '../types'
import { AssetBadge } from './domain-ui'

function signed(value: number): string {
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}`
}

function propValue(market: SportsbookMarketConsensus): string {
  if (market.line !== null) return market.line.toFixed(market.line % 1 === 0 ? 0 : 1)
  if (market.yesProbability !== null) return `${Math.round(market.yesProbability * 100)}%`
  return 'Unavailable'
}

function propContext(market: SportsbookMarketConsensus): string {
  const details: string[] = [`${market.bookmakerCount} book${market.bookmakerCount === 1 ? '' : 's'}`]
  if (market.lineLow !== null && market.lineHigh !== null && market.lineLow !== market.lineHigh) {
    details.push(`${market.lineLow.toFixed(1)}–${market.lineHigh.toFixed(1)} range`)
  }
  if (market.overProbability !== null) details.push(`${Math.round(market.overProbability * 100)}% no-vig over`)
  if (market.yesProbability !== null) details.push(`${Math.round(market.yesProbability * 100)}%${market.probabilityIncludesVig ? ' implied incl. vig' : ' no-vig yes'}`)
  return details.join(' · ')
}

export function SportsbookEvidencePanel({ assets, context = 'player' }: { assets: Asset[]; context?: 'player' | 'trade' }) {
  const players = useMemo(() => eligibleSportsbookPlayers(assets).slice(0, 12), [assets])
  const [bundle, setBundle] = useState<SportsbookBundle | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = async () => {
    if (!players.length || loading) return
    setLoading(true)
    setError(null)
    try {
      setBundle(await refreshSportsbookEvidence(players))
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Sportsbook evidence unavailable')
    } finally {
      setLoading(false)
    }
  }

  if (!players.length) return null

  return (
    <section className="panel sportsbook-panel">
      <div className="panel-heading">
        <div><span className="eyebrow">Sportsbook expectations · shadow</span><h2>{context === 'trade' ? 'Near-term market context for this package' : 'What the weekly market currently expects'}</h2></div>
        <button className="sportsbook-refresh" type="button" disabled={loading} onClick={() => void refresh()}>
          <RefreshCw size={15} className={loading ? 'spin' : ''} /> {bundle ? 'Refresh lines' : 'Load current lines'}
        </button>
      </div>

      {!bundle && !error && (
        <div className="sportsbook-empty">
          <Activity size={20} />
          <div><strong>Nothing is fetched automatically.</strong><span>Load current game totals and player props for {players.length === 1 ? players[0].name : `${players.length} selected players`}. The result stays separate from dynasty price and the trade verdict.</span></div>
        </div>
      )}
      {error && <div className="sportsbook-empty error"><Info size={20} /><div><strong>Lines could not be loaded.</strong><span>{error}</span></div></div>}
      {bundle?.status === 'needs-key' && (
        <div className="sportsbook-empty"><ShieldCheck size={20} /><div><strong>The private provider key is not configured.</strong><span>RosterLab is ready for an <code>ODDS_API_KEY</code> Site secret. The key stays on the server and never reaches the browser.</span></div></div>
      )}
      {bundle && bundle.status !== 'needs-key' && (
        <>
          <div className="sportsbook-player-grid">
            {bundle.players.map((snapshot) => {
              const asset = assets.find((player) => player.id === snapshot.playerId)
              return (
                <article className={`sportsbook-player-card ${snapshot.status}`} key={snapshot.playerId}>
                  <header><AssetBadge position={snapshot.position} /><span><strong>{snapshot.playerName}</strong><small>{snapshot.team ?? 'Team unavailable'} · {snapshot.status === 'covered' ? `${snapshot.markets.length} markets covered` : snapshot.status.replaceAll('-', ' ')}</small></span>{asset?.projectedPpg !== undefined && <b>{asset.projectedPpg.toFixed(1)} internal PPG</b>}</header>
                  {snapshot.game && <div className="sportsbook-game-context"><span><small>Matchup</small><b>{snapshot.game.awayTeam} at {snapshot.game.homeTeam}</b></span><span><small>Game total</small><b>{snapshot.game.total?.toFixed(1) ?? '—'}</b></span><span><small>Team total</small><b>{snapshot.game.impliedTeamTotal?.toFixed(1) ?? '—'}</b></span><span><small>Team spread</small><b>{snapshot.game.teamSpread === null ? '—' : signed(snapshot.game.teamSpread)}</b></span></div>}
                  {snapshot.markets.length > 0 ? <div className="sportsbook-market-list">{snapshot.markets.map((market) => <div key={market.market}><span><small>{market.label}</small><strong>{propValue(market)}</strong></span><em>{propContext(market)}</em></div>)}</div> : <p>{snapshot.note}</p>}
                </article>
              )
            })}
          </div>
          <div className="sportsbook-source-row"><span>Observed {new Date(bundle.generatedAt).toLocaleString()} · {bundle.usage.eventRequests} event request{bundle.usage.eventRequests === 1 ? '' : 's'}{bundle.usage.requestsRemaining === null ? '' : ` · ${bundle.usage.requestsRemaining} provider credits remain`}</span><a href={bundle.sourceUrl || SPORTSBOOK_SOURCE_URL} target="_blank" rel="noreferrer">The Odds API <ExternalLink size={12} /></a></div>
        </>
      )}
      <div className="model-note sportsbook-boundary"><Info size={16} /><span><strong>Shadow evidence only.</strong> A posted line is a market threshold, not an expected mean, injury report, or long-term dynasty value. These features contribute zero weight until the chronological challenger beats the existing production model.</span></div>
    </section>
  )
}
