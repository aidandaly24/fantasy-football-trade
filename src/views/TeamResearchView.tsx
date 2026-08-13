import { ArrowLeft, CalendarClock, ChevronRight, DatabaseZap, Layers3, RefreshCw, TrendingUp } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { backfillTeamHistory, fetchEdgeState, fetchTeamHistory } from '../api'
import { AssetBadge, Avatar, formatValue } from '../components/domain-ui'
import type { LeagueContext } from '../league-context'
import { buildTeamRankComparisons } from '../rank-comparison'
import { rosterProfile } from '../rankings'
import { teamValueAllocation } from '../team-research'
import type {
  Asset,
  ReconstructedTeamMarketHistoryPoint,
  Team,
  TeamHistoryBackfill,
  TeamMarketHistoryPoint,
} from '../types'

function dateLabel(value: string): string {
  const parsed = new Date(`${value}T12:00:00Z`)
  return Number.isFinite(parsed.getTime())
    ? parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : value
}

function MarketHistoryChart({ points, loading, error }: {
  points: TeamMarketHistoryPoint[]
  loading: boolean
  error: string | null
}) {
  const series = points
    .filter((point) => Number.isFinite(point.totalValue))
    .sort((a, b) => a.snapshotDate.localeCompare(b.snapshotDate))
  if (loading) return <div className="team-chart-empty"><CalendarClock size={20} /><span>Loading observed market history…</span></div>
  if (error) return <div className="team-chart-empty"><CalendarClock size={20} /><span>Market history is temporarily unavailable. Current roster values remain usable.</span></div>
  if (series.length < 2) {
    return <div className="team-chart-empty"><CalendarClock size={20} /><span>RosterLab has {series.length} observed market date{series.length === 1 ? '' : 's'} for this team. Two are required before a trend is shown.</span></div>
  }

  const width = 760
  const height = 250
  const bounds = { left: 70, right: 18, top: 20, bottom: 38 }
  const values = series.map((point) => point.totalValue)
  const observedMin = Math.min(...values)
  const observedMax = Math.max(...values)
  const padding = Math.max(1, (observedMax - observedMin) * 0.12)
  const min = Math.max(0, observedMin - padding)
  const max = observedMax + padding
  const chartWidth = width - bounds.left - bounds.right
  const chartHeight = height - bounds.top - bounds.bottom
  const x = (index: number) => bounds.left + (series.length === 1 ? chartWidth / 2 : index / (series.length - 1) * chartWidth)
  const y = (value: number) => bounds.top + (1 - (value - min) / Math.max(1, max - min)) * chartHeight
  const path = series.map((point, index) => `${index ? 'L' : 'M'} ${x(index).toFixed(1)} ${y(point.totalValue).toFixed(1)}`).join(' ')
  const grid = [0, 1, 2, 3].map((index) => {
    const value = max - index / 3 * (max - min)
    return { value, y: y(value) }
  })
  const dateIndexes = [...new Set([0, Math.floor((series.length - 1) / 2), series.length - 1])]
  const first = series[0]
  const last = series[series.length - 1]
  const delta = last.totalValue - first.totalValue

  return <>
    <div className="team-chart-summary">
      <span><small>First observation</small><b>{formatValue(first.totalValue)}</b></span>
      <span><small>Latest observation</small><b>{formatValue(last.totalValue)}</b></span>
      <span><small>Observed change</small><b className={delta >= 0 ? 'positive' : 'negative'}>{delta >= 0 ? '+' : ''}{formatValue(delta)}</b></span>
    </div>
    <div className="team-history-chart">
      <svg role="img" aria-label={`Team market value from ${dateLabel(first.snapshotDate)} to ${dateLabel(last.snapshotDate)}`} viewBox={`0 0 ${width} ${height}`}>
        {grid.map((line) => <g key={line.y}><line className="team-chart-gridline" x1={bounds.left} x2={width - bounds.right} y1={line.y} y2={line.y} /><text className="team-chart-axis" x={bounds.left - 10} y={line.y + 4} textAnchor="end">{formatValue(Math.round(line.value))}</text></g>)}
        <path className="team-chart-area" d={`${path} L ${x(series.length - 1)} ${height - bounds.bottom} L ${x(0)} ${height - bounds.bottom} Z`} />
        <path className="team-chart-line" d={path} />
        {series.map((point, index) => <circle className="team-chart-point" key={`${point.snapshotDate}:${index}`} cx={x(index)} cy={y(point.totalValue)} r={index === 0 || index === series.length - 1 ? 4 : 2.5}><title>{dateLabel(point.snapshotDate)}: ${formatValue(point.totalValue)}</title></circle>)}
        {dateIndexes.map((index) => <text className="team-chart-axis" key={series[index].snapshotDate} x={x(index)} y={height - 12} textAnchor={index === 0 ? 'start' : index === series.length - 1 ? 'end' : 'middle'}>{dateLabel(series[index].snapshotDate)}</text>)}
      </svg>
    </div>
  </>
}

function FullAssetRow({ asset, index, onOpenPlayer }: { asset: Asset; index: number; onOpenPlayer: (playerId: string) => void }) {
  const content = <>
    <span className="asset-index">{index + 1}</span>
    <AssetBadge position={asset.position} />
    <span className="asset-main">
      <strong>{asset.name}</strong>
      <small>{asset.kind === 'player'
        ? [asset.team, asset.age ? `Age ${asset.age.toFixed(1)}` : null].filter(Boolean).join(' · ')
        : asset.slot ? 'Exact draft slot' : `Unresolved midpoint · ${formatValue(asset.valueLow ?? asset.value)}–${formatValue(asset.valueHigh ?? asset.value)} provider range`}</small>
    </span>
    <b className="asset-value">{formatValue(asset.value)}</b>
    {asset.kind === 'player' && <ChevronRight size={16} aria-hidden="true" />}
  </>
  return asset.kind === 'player'
    ? <button type="button" className="scout-asset scout-player-link" onClick={() => onOpenPlayer(asset.id)} aria-label={`Research ${asset.name}`}>{content}</button>
    : <div className="scout-asset">{content}</div>
}

function emptyBackfill(): TeamHistoryBackfill {
  return {
    provider: 'fantasycalc', status: 'not-started', formatKey: 'fantasycalc-dynasty-superflex-history-v1',
    requestedAssets: 0, completedAssets: 0, missingAssets: 0, failedAssets: 0,
    observationCount: 0, firstObservedAt: null, lastObservedAt: null, updatedAt: null,
    notes: ['Run the backfill to reconstruct player value from exact Sleeper weekly rosters.'],
  }
}

export function TeamResearchView({ team, teams, leagueContext, onBack, onOpenPlayer }: {
  team: Team
  teams: Team[]
  leagueContext: LeagueContext
  onBack: () => void
  onOpenPlayer: (playerId: string) => void
}) {
  const [history, setHistory] = useState<TeamMarketHistoryPoint[]>([])
  const [reconstructed, setReconstructed] = useState<ReconstructedTeamMarketHistoryPoint[]>([])
  const [backfill, setBackfill] = useState<TeamHistoryBackfill>(emptyBackfill)
  const [backfillRunning, setBackfillRunning] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(true)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [backfillError, setBackfillError] = useState<string | null>(null)
  const comparison = useMemo(() => buildTeamRankComparisons(teams).get(team.rosterId), [team.rosterId, teams])
  const profile = useMemo(() => rosterProfile(team, teams), [team, teams])
  const allocation = useMemo(() => teamValueAllocation(team), [team])
  const allocationMax = Math.max(1, ...allocation.map((bucket) => bucket.value))
  const players = useMemo(() => [...team.players].sort((a, b) => b.value - a.value || a.name.localeCompare(b.name)), [team.players])
  const picks = useMemo(() => [...team.picks].sort((a, b) => b.value - a.value || a.name.localeCompare(b.name)), [team.picks])

  useEffect(() => {
    let cancelled = false
    setHistoryLoading(true)
    setHistoryError(null)
    void Promise.all([fetchEdgeState(leagueContext.id), fetchTeamHistory(leagueContext.id)]).then(([edgeState, teamHistory]) => {
      if (cancelled) return
      setHistory(edgeState.teamMarketHistory.filter((point) => point.rosterId === team.rosterId))
      setReconstructed(teamHistory.reconstructedTeamMarketHistory.filter((point) =>
        team.ownerId ? point.ownerUserId === team.ownerId : point.rosterId === team.rosterId,
      ))
      setBackfill(teamHistory.backfill)
    }).catch((loadError) => {
      if (!cancelled) setHistoryError(loadError instanceof Error ? loadError.message : 'Market history unavailable')
    }).finally(() => {
      if (!cancelled) setHistoryLoading(false)
    })
    return () => { cancelled = true }
  }, [leagueContext.id, team.ownerId, team.rosterId])

  const visibleReconstruction = reconstructed.filter((point) => point.coverageRate >= 0.8)
  const reconstructedChart = visibleReconstruction.map((point): TeamMarketHistoryPoint => ({
    snapshotDate: point.observedAt,
    rosterId: point.rosterId,
    totalValue: point.playerValue,
    playerValue: point.playerValue,
    pickValue: 0,
    assetCount: point.coveredPlayers,
  }))
  const progressCount = backfill.completedAssets + backfill.missingAssets + backfill.failedAssets
  const averageCoverage = visibleReconstruction.length
    ? visibleReconstruction.reduce((sum, point) => sum + point.coverageRate, 0) / visibleReconstruction.length
    : 0

  async function runBackfill(): Promise<void> {
    setBackfillRunning(true)
    setBackfillError(null)
    try {
      for (let batch = 0; batch < 30; batch += 1) {
        const state = await backfillTeamHistory(leagueContext.id)
        setBackfill(state.backfill)
        setReconstructed(state.reconstructedTeamMarketHistory.filter((point) =>
          team.ownerId ? point.ownerUserId === team.ownerId : point.rosterId === team.rosterId,
        ))
        if (['complete', 'partial', 'failed'].includes(state.backfill.status)) break
      }
    } catch (error) {
      setBackfillError(error instanceof Error ? error.message : 'Historical player-value backfill failed')
    } finally {
      setBackfillRunning(false)
    }
  }

  return <main className="page-shell team-research-page">
    <section className="team-research-hero panel">
      <div className="player-research-breadcrumb"><button type="button" onClick={onBack}><ArrowLeft size={16} /> Back to Home</button><span>{leagueContext.label} · {leagueContext.labels.format}</span></div>
      <div className="team-research-identity">
        <Avatar team={team} size="lg" />
        <div><span className="eyebrow">Team research</span><h1>{team.teamName}</h1><p>Managed by @{team.ownerName}</p></div>
        <span className="window-pill"><TrendingUp size={14} /> {profile.label}</span>
      </div>
      <div className="team-fact-strip">
        <span><small>Market rank</small><b>#{comparison?.marketRank ?? '—'}</b></span>
        <span><small>Power rank</small><b>#{comparison?.powerRank ?? '—'}</b></span>
        <span><small>Player market</small><b>{formatValue(team.metrics.core)}</b></span>
        <span><small>Draft capital</small><b>{formatValue(team.metrics.picks)}</b></span>
        <span><small>Covered lineup</small><b>{team.metrics.lineup.toFixed(1)} PPG</b></span>
      </div>
    </section>

    <section className="team-research-section panel">
      <div className="panel-heading team-history-heading"><div><span className="eyebrow">Reconstructed player tape</span><h2>Historical player market value</h2></div><span className="method-note">Exact Sleeper weekly rosters · FantasyCalc generic superflex · picks excluded</span></div>
      {backfill.status === 'not-started' ? <div className="team-backfill-callout">
        <DatabaseZap size={22} />
        <div><b>Older player history is available.</b><p>This reads the league’s stored weekly rosters, then attaches point-in-time FantasyCalc player values. It does not apply today’s roster backward.</p></div>
        <button type="button" className="primary-button" onClick={() => void runBackfill()} disabled={backfillRunning}>{backfillRunning ? 'Starting…' : 'Build historical tape'}</button>
      </div> : <>
        <div className="team-backfill-status">
          <span><b>{progressCount}/{backfill.requestedAssets}</b><small>players resolved</small></span>
          <span><b>{backfill.observationCount.toLocaleString()}</b><small>weekly values stored</small></span>
          <span><b>{averageCoverage ? `${Math.round(averageCoverage * 100)}%` : '—'}</b><small>plotted coverage</small></span>
          <button type="button" onClick={() => void runBackfill()} disabled={backfillRunning}><RefreshCw size={14} className={backfillRunning ? 'spin' : ''} /> {backfillRunning ? 'Backfilling…' : backfill.status === 'running' || backfill.status === 'queued' ? 'Continue backfill' : 'Refresh tape'}</button>
        </div>
        <MarketHistoryChart points={reconstructedChart} loading={false} error={backfillError} />
      </>}
      <p className="team-chart-boundary">Only dates with at least 80% player coverage are plotted. Missing and delisted players are not estimated. This is a source-relative player-value trend—not an exact historical trade grade, and not comparable point-for-point with the Tradyr composite below.</p>
    </section>

    <section className="team-research-section panel">
      <div className="panel-heading"><div><span className="eyebrow">Observed portfolio tape</span><h2>Team market value over time</h2></div><span className="method-note">Recorded ownership and composite value on each snapshot date</span></div>
      <MarketHistoryChart points={history} loading={historyLoading} error={historyError} />
      <p className="team-chart-boundary">This remains the exact observed RosterLab portfolio tape: current Tradyr composite players plus picks. It starts when the private market tape began and stays separate from reconstructed FantasyCalc history.</p>
    </section>

    <section className="team-research-section panel">
      <div className="panel-heading"><div><span className="eyebrow">Current construction</span><h2>Where the market value lives</h2></div><span className="method-note">Current Tradyr composite · positions remain separate</span></div>
      <div className="team-allocation-chart">
        {allocation.map((bucket) => <div className="team-allocation-row" key={bucket.label}>
          <span><b>{bucket.label}</b><small>{bucket.count} asset{bucket.count === 1 ? '' : 's'}</small></span>
          <span className="team-allocation-track"><i style={{ width: `${Math.max(2, bucket.value / allocationMax * 100)}%` }} /></span>
          <strong>{formatValue(bucket.value)}</strong>
        </div>)}
      </div>
    </section>

    <section className="team-research-section panel">
      <div className="panel-heading"><div><span className="eyebrow">Settled Sleeper roster</span><h2>Players</h2></div><span className="method-note">{players.length} players · tap any player for research</span></div>
      <div className="asset-stack team-full-roster">{players.map((asset, index) => <FullAssetRow asset={asset} index={index} onOpenPlayer={onOpenPlayer} key={asset.id} />)}</div>
    </section>

    <section className="team-research-section panel">
      <div className="panel-heading"><div><span className="eyebrow">Owned inventory</span><h2>Draft picks</h2></div><span className="method-note">{picks.length} picks</span></div>
      {picks.length ? <div className="asset-stack team-full-roster">{picks.map((asset, index) => <FullAssetRow asset={asset} index={index} onOpenPlayer={onOpenPlayer} key={asset.id} />)}</div> : <div className="team-chart-empty"><Layers3 size={20} /><span>No owned picks are present in the current Sleeper ledger.</span></div>}
    </section>
  </main>
}
