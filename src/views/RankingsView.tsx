import { AlertTriangle, ChevronRight, Clock3, LockKeyhole, Sparkles, Target, TrendingUp, Trophy, X } from 'lucide-react'
import { useMemo } from 'react'
import type { LeagueContext } from '../league-context'
import type { PendingTradeProjection } from '../pending-trades'
import { rosterProfile } from '../rankings'
import type { RankingMode, Team } from '../types'
import { AssetBadge, Avatar, formatValue, MetricBar } from '../components/domain-ui'

const modeCopy: Record<RankingMode, { label: string; description: string }> = {
  overall: {
    label: 'Current market',
    description: 'The direct sum of current player and pick composite values. No package compression or roster-fit adjustment.',
  },
  contender: {
    label: 'Covered lineup',
    description: 'League-adjusted points per team week for the best legal lineup among players covered by the validated production model.',
  },
  future: {
    label: 'Draft capital',
    description: 'The direct sum of current provider values for owned picks. Unresolved picks use the provider midpoint and show their full range.',
  },
}

function PendingRosterPanel({
  settledTeams,
  projection,
  failedRounds,
  snapshot,
  onSnapshotChange,
  onCancel,
}: {
  settledTeams: Team[]
  projection: PendingTradeProjection
  failedRounds: number[]
  snapshot: 'settled' | 'committed'
  onSnapshotChange: (snapshot: 'settled' | 'committed') => void
  onCancel: (manualId: string) => void
}) {
  if (!projection.activeTrades.length && !failedRounds.length) return null
  if (!projection.activeTrades.length) {
    return <div className="pending-roster-warning pending-source-only panel"><AlertTriangle size={16} /> Sleeper transaction rounds {failedRounds.join(', ')} could not be checked. Rankings use the settled roster only.</div>
  }
  const names = new Map(settledTeams.map((team) => [team.rosterId, team.teamName]))
  return (
    <section className="pending-roster-panel panel" aria-label="Accepted trades awaiting Sleeper processing">
      <div className="pending-roster-heading">
        <span className="pending-roster-icon"><Clock3 size={20} /></span>
        <div>
          <span className="eyebrow">Accepted-trade overlay</span>
          <h2>{projection.activeTrades.length} deal{projection.activeTrades.length === 1 ? '' : 's'} committed, not settled</h2>
          <p>Rankings use the projected post-trade league. Every asset in review is removed from available trading inventory.</p>
        </div>
        <div className="pending-snapshot-switch" role="group" aria-label="Roster snapshot">
          <button type="button" className={snapshot === 'committed' ? 'active' : ''} onClick={() => onSnapshotChange('committed')}>Committed</button>
          <button type="button" className={snapshot === 'settled' ? 'active' : ''} onClick={() => onSnapshotChange('settled')}>Settled</button>
        </div>
      </div>
      <div className="pending-trade-list">
        {projection.activeTrades.map((record) => {
          const transaction = record.transaction
          const assetCount = new Set([
            ...Object.keys(transaction.adds ?? {}),
            ...Object.keys(transaction.drops ?? {}),
            ...(transaction.draft_picks ?? []).map((pick) => `pick:${pick.season}:${pick.round}:${pick.roster_id}`),
          ]).size
          return (
            <article key={`${record.source}:${transaction.transaction_id}`}>
              <span><LockKeyhole size={15} /></span>
              <div>
                <strong>{transaction.roster_ids.map((rosterId) => names.get(rosterId) ?? `Roster ${rosterId}`).join(' ↔ ')}</strong>
                <small>{assetCount} locked asset{assetCount === 1 ? '' : 's'} · {record.source === 'sleeper' ? 'Sleeper transaction' : 'Private commitment'}</small>
              </div>
              {record.manualId && <button type="button" onClick={() => onCancel(record.manualId!)} aria-label="Remove cancelled pending trade"><X size={14} /> Cancel / veto</button>}
            </article>
          )
        })}
      </div>
      {projection.issues.length > 0 && <div className="pending-roster-warning"><AlertTriangle size={16} /> {projection.issues.length} asset leg{projection.issues.length === 1 ? '' : 's'} could not be resolved and were not invented.</div>}
      {failedRounds.length > 0 && <div className="pending-roster-warning"><AlertTriangle size={16} /> Sleeper transaction rounds {failedRounds.join(', ')} could not be checked. Private commitments remain intact.</div>}
      {projection.activeTrades.some((trade) => trade.source === 'manual') && <div className="pending-roster-note">Sleeper can omit accepted trades during its review window. Private commitments reconcile automatically once the settled roster and pick ledger reflect every leg; use Cancel / veto if a deal does not process.</div>}
    </section>
  )
}
function RankingBoard({
  teams,
  mode,
  selectedId,
  onSelect,
}: {
  teams: Team[]
  mode: RankingMode
  selectedId: number
  onSelect: (id: number) => void
}) {
  return (
    <div className="ranking-board panel">
      <div className="panel-heading ranking-heading">
        <div>
          <span className="eyebrow">League table</span>
          <h2>{modeCopy[mode].label}</h2>
        </div>
        <span className="method-note">Observed value or validated model output</span>
      </div>
      <div className="ranking-list">
        {teams.map((team, index) => {
          const score = team.metrics[mode]
          return (
            <button
              type="button"
              className={`ranking-row ${team.rosterId === selectedId ? 'selected' : ''}`}
              key={team.rosterId}
              onClick={() => onSelect(team.rosterId)}
            >
              <span className={`rank-number rank-${index + 1}`}>{index + 1}</span>
              <Avatar team={team} size="sm" />
              <span className="rank-team-copy">
                <strong>{team.teamName}</strong>
                <small>@{team.ownerName}</small>
              </span>
              <span className="rank-score-block">
                <span className="rank-score-line">
                  <b>{mode === 'contender' ? score.toFixed(1) : formatValue(score)}</b>
                  <small>{mode === 'contender' ? 'covered PPG' : 'current value'}</small>
                </span>
              </span>
              <ChevronRight size={18} aria-hidden="true" />
            </button>
          )
        })}
      </div>
    </div>
  )
}

function TeamScout({ team, teams }: { team: Team; teams: Team[] }) {
  const profile = rosterProfile(team, teams)
  const topAssets = [...team.players, ...team.picks].sort((a, b) => b.value - a.value).slice(0, 6)
  const rank = [...teams]
    .sort((a, b) => b.metrics.overall - a.metrics.overall)
    .findIndex((item) => item.rosterId === team.rosterId) + 1

  return (
    <aside className="team-scout panel">
      <div className="scout-hero">
        <div className="scout-topline">
          <span className="window-pill"><Sparkles size={14} /> {profile.label}</span>
          <span className="overall-rank">#{rank} overall</span>
        </div>
        <div className="scout-identity">
          <Avatar team={team} size="lg" />
          <div>
            <h2>{team.teamName}</h2>
            <p>Managed by {team.ownerName}</p>
          </div>
        </div>
        <p className="window-copy">{profile.description}</p>
      </div>

      <div className="scout-section metrics-grid">
        <MetricBar label="Covered lineup PPG" value={team.metrics.lineup.toFixed(1)} />
        <MetricBar label="Player market value" value={formatValue(team.metrics.core)} />
        <MetricBar label="Bench market value" value={formatValue(team.metrics.depth)} />
        <MetricBar label="Draft-capital value" value={formatValue(team.metrics.picks)} />
      </div>
      <div className="scout-model-note">
        These are direct quantities, not 0–100 ratings. Missing production projections contribute no points and remain visibly uncovered.
      </div>

      <div className="scout-section">
        <div className="section-title-row">
          <div>
            <span className="eyebrow">Asset board</span>
            <h3>Most valuable pieces</h3>
          </div>
          <span className="asset-count">{team.players.length + team.picks.length} assets</span>
        </div>
        <div className="asset-stack">
          {topAssets.map((asset, index) => (
            <div className="scout-asset" key={asset.id}>
              <span className="asset-index">{index + 1}</span>
              <AssetBadge position={asset.position} />
              <span className="asset-main">
                <strong>{asset.name}</strong>
                <small>
                  {asset.kind === 'player'
                    ? [asset.team, asset.age ? `Age ${asset.age.toFixed(1)}` : null].filter(Boolean).join(' · ')
                    : asset.slot
                      ? 'Exact draft slot'
                      : `Unresolved midpoint · ${formatValue(asset.valueLow ?? asset.value)}–${formatValue(asset.valueHigh ?? asset.value)} provider range`}
                </small>
              </span>
              <b className="asset-value">{formatValue(asset.value)}</b>
            </div>
          ))}
        </div>
      </div>
    </aside>
  )
}

export function RankingsView({
  teams,
  settledTeams,
  pendingProjection,
  pendingFetchFailedRounds,
  rosterSnapshot,
  setRosterSnapshot,
  onCancelPending,
  mode,
  setMode,
  selectedId,
  setSelectedId,
  leagueContext,
}: {
  teams: Team[]
  settledTeams: Team[]
  pendingProjection: PendingTradeProjection
  pendingFetchFailedRounds: number[]
  rosterSnapshot: 'settled' | 'committed'
  setRosterSnapshot: (snapshot: 'settled' | 'committed') => void
  onCancelPending: (manualId: string) => void
  mode: RankingMode
  setMode: (mode: RankingMode) => void
  selectedId: number
  setSelectedId: (id: number) => void
  leagueContext: LeagueContext
}) {
  const sorted = useMemo(
    () => [...teams].sort((a, b) => b.metrics[mode] - a.metrics[mode]),
    [mode, teams],
  )
  const selectedTeam = teams.find((team) => team.rosterId === selectedId) ?? sorted[0]
  const lineupLeader = [...teams].sort((a, b) => b.metrics.lineup - a.metrics.lineup)[0]
  const coreLeader = [...teams].sort((a, b) => b.metrics.core - a.metrics.core)[0]
  const pickLeader = [...teams].sort((a, b) => b.metrics.picks - a.metrics.picks)[0]

  return (
    <main className="page-shell">
      <section className="page-intro">
        <div>
          <span className="eyebrow accent-eyebrow">League intelligence</span>
          <h1>Compare the league.<br />Without a mystery score.</h1>
          <p>{mode === 'contender' ? `${modeCopy[mode].description} ${leagueContext.labels.projection}.` : modeCopy[mode].description}</p>
        </div>
        <div className="mode-switch" role="group" aria-label="Ranking model">
          {(Object.keys(modeCopy) as RankingMode[]).map((item) => (
            <button
              type="button"
              key={item}
              className={item === mode ? 'active' : ''}
              onClick={() => setMode(item)}
            >
              {modeCopy[item].label}
            </button>
          ))}
        </div>
      </section>

      <div className="league-context-note panel"><span><strong>{leagueContext.label}</strong> · {leagueContext.labels.format}</span><small>{leagueContext.labels.roster}</small></div>

      <PendingRosterPanel
        settledTeams={settledTeams}
        projection={pendingProjection}
        failedRounds={pendingFetchFailedRounds}
        snapshot={rosterSnapshot}
        onSnapshotChange={setRosterSnapshot}
        onCancel={onCancelPending}
      />

      <section className="leader-strip" aria-label="League leaders">
        <div className="leader-card">
          <span className="leader-icon"><Trophy size={19} /></span>
          <span><small>Highest covered lineup</small><strong>{lineupLeader.teamName}</strong></span>
          <b>{lineupLeader.metrics.lineup.toFixed(1)}</b>
        </div>
        <div className="leader-card">
          <span className="leader-icon"><TrendingUp size={19} /></span>
          <span><small>Highest player market</small><strong>{coreLeader.teamName}</strong></span>
          <b>{formatValue(coreLeader.metrics.core)}</b>
        </div>
        <div className="leader-card">
          <span className="leader-icon"><Target size={19} /></span>
          <span><small>Most draft capital</small><strong>{pickLeader.teamName}</strong></span>
          <b>{formatValue(pickLeader.metrics.picks)}</b>
        </div>
      </section>

      <section className="rankings-layout">
        <RankingBoard teams={sorted} mode={mode} selectedId={selectedTeam.rosterId} onSelect={setSelectedId} />
        <TeamScout team={selectedTeam} teams={teams} />
      </section>
    </main>
  )
}
