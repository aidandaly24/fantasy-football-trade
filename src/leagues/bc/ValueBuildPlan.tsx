import { ArrowUpRight, LockKeyhole, ShieldCheck, Target } from 'lucide-react'
import { buildTeamPowerTable, optimizeLineupBy } from '../../team-power'
import type { Team } from '../../types'
import type { ValueBuildStrategyProfile } from '../types'

const POSITIONS = ['QB', 'RB', 'WR', 'TE'] as const

function rankFor(team: Team, teams: Team[], score: (candidate: Team) => number): number {
  const scoreByRoster = teams
    .map((candidate) => ({ rosterId: candidate.rosterId, score: score(candidate) }))
    .sort((a, b) => b.score - a.score || a.rosterId - b.rosterId)
  const mine = score(team)
  return scoreByRoster.findIndex((candidate) => candidate.score === mine) + 1
}

function starterMarket(team: Team, rosterPositions: string[]): number {
  return optimizeLineupBy(team.players, rosterPositions, (asset) => asset.value)
    .reduce((sum, asset) => sum + asset.value, 0)
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const midpoint = Math.floor(sorted.length / 2)
  return sorted.length % 2
    ? sorted[midpoint]
    : ((sorted[midpoint - 1] ?? 0) + (sorted[midpoint] ?? 0)) / 2
}

export function BCValueBuildPlan({
  teams,
  rosterPositions,
  profile,
}: {
  teams: Team[]
  rosterPositions: string[]
  profile: ValueBuildStrategyProfile
}) {
  const powerTable = buildTeamPowerTable(teams, rosterPositions, profile.targetRanks.currentSeasonPower)
  const power = powerTable.find((row) => row.team.rosterId === profile.rosterId)
  const mine = teams.find((team) => team.rosterId === profile.rosterId)
  if (!power || !mine) return null

  const ranks = {
    power: power.rank,
    players: rankFor(mine, teams, (team) => team.metrics.core),
    starters: rankFor(mine, teams, (team) => starterMarket(team, rosterPositions)),
    bench: rankFor(mine, teams, (team) => team.metrics.depth),
    picks: rankFor(mine, teams, (team) => team.metrics.picks),
  }
  const positionPriorities = POSITIONS.map((position) => {
    const leagueMedian = median(powerTable.map((row) => row.positionTotals[position]))
    const value = power.positionTotals[position]
    return { position, value, delta: value - leagueMedian }
  }).sort((a, b) => a.delta - b.delta || a.position.localeCompare(b.position))
  const contenderGateCleared = power.complete
    && ranks.power <= profile.targetRanks.currentSeasonPower
    && ranks.starters <= profile.targetRanks.dynastyStarters

  return (
    <section className="league-strategy-plan bc-value-plan panel" aria-label="BC value-build plan">
      <header>
        <div>
          <span className="eyebrow">BC League · private strategy</span>
          <h2>Build the core before spending the war chest</h2>
          <p>{profile.objective}</p>
        </div>
        <span className="power-policy"><ShieldCheck size={16} /> {profile.label}</span>
      </header>

      <div className="power-plan-scorecard bc-strategy-scorecard">
        <article><small>Current power</small><strong>#{ranks.power}<span> / {teams.length}</span></strong><em>{power.complete ? `${power.score.toLocaleString()} lineup index` : `${power.coveragePercent}% covered · guarded`}</em></article>
        <article><small>Player market</small><strong>#{ranks.players}<span> / {teams.length}</span></strong><em>{mine.metrics.core.toLocaleString()} total player value</em></article>
        <article><small>Starter market</small><strong>#{ranks.starters}<span> / {teams.length}</span></strong><em>{starterMarket(mine, rosterPositions).toLocaleString()} legal-starter value</em></article>
        <article><small>Bench market</small><strong>#{ranks.bench}<span> / {teams.length}</span></strong><em>{mine.metrics.depth.toLocaleString()} depth value</em></article>
        <article className={ranks.picks <= 3 ? 'power-cleared' : 'power-gap'}><small>Draft capital</small><strong>#{ranks.picks}<span> / {teams.length}</span></strong><em>{mine.metrics.picks.toLocaleString()} current pick value</em></article>
      </div>

      <div className="power-position-grid bc-position-priorities">
        {positionPriorities.map((row, index) => (
          <article key={row.position}>
            <span>Need #{index + 1} · {row.position}</span>
            <strong>{row.value.toLocaleString()}</strong>
            <small className={row.delta >= 0 ? 'positive' : 'negative'}>{row.delta >= 0 ? '+' : ''}{Math.round(row.delta).toLocaleString()} vs league median</small>
          </article>
        ))}
      </div>

      <div className="power-plan-rules">
        <div><Target size={17} /><span><strong>Phase-one gate</strong><small>Reach top {profile.targetRanks.currentSeasonPower} in current power and top {profile.targetRanks.dynastyStarters} in starter market before pivoting toward the top-{profile.playoffRank} playoff line.</small></span></div>
        <div><LockKeyhole size={17} /><span><strong>Protected liquidity</strong><small>Keep the {profile.protectedAssets.map((asset) => asset.label).join(' and ')} unless equivalent pick liquidity returns or both phase-one gates are cleared.</small></span></div>
        <div><ArrowUpRight size={17} /><span><strong>{contenderGateCleared ? 'Climb gate cleared' : 'Value-build mode'}</strong><small>{contenderGateCleared ? 'Shop one concentrated upgrade while keeping the triple-loss guard active.' : 'Prioritize young starters at the weakest position; reject any deal that loses market, power, and net draft capital together.'}</small></span></div>
      </div>
    </section>
  )
}
