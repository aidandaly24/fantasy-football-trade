import { ArrowUpRight, LockKeyhole, ShieldCheck, Target } from 'lucide-react'
import { buildTeamPowerTable } from '../../team-power'
import type { Team } from '../../types'
import type { PowerClimbStrategyProfile } from '../types'

function signed(value: number): string {
  return `${value > 0 ? '+' : ''}${Math.round(value).toLocaleString()}`
}

export function EmperorPhilTeamPowerPlan({
  teams,
  rosterPositions,
  profile,
}: {
  teams: Team[]
  rosterPositions: string[]
  profile: PowerClimbStrategyProfile
}) {
  const table = buildTeamPowerTable(teams, rosterPositions, profile.targetRank)
  const mine = table.find((row) => row.team.rosterId === profile.rosterId)
  if (!mine) return null
  const positions = ['QB', 'RB', 'WR', 'TE'] as const
  const medians = Object.fromEntries(positions.map((position) => {
    const values = table.map((row) => row.positionTotals[position]).sort((a, b) => a - b)
    const midpoint = Math.floor(values.length / 2)
    const median = values.length % 2 ? values[midpoint] : ((values[midpoint - 1] ?? 0) + (values[midpoint] ?? 0)) / 2
    return [position, median]
  })) as Record<(typeof positions)[number], number>
  const currentGate = profile.decisionGates.find((gate) => mine.rank >= gate.ranks[0] && mine.rank <= gate.ranks[1])
  const protectedFirst = profile.protectedAssets[0]

  if (!mine.complete) {
    return (
      <section className="league-strategy-plan phil-power-plan panel" aria-label="Emperor Phil team power plan">
        <header>
          <div><span className="eyebrow">Emperor Phil · private strategy</span><h2>Lineup power is temporarily unavailable</h2><p>{mine.covered}/{mine.required} legal skill slots have a current redraft value. RosterLab will not rank a partial lineup or substitute dynasty value.</p></div>
          <span className="power-policy"><ShieldCheck size={16} /> {mine.coveragePercent}% covered</span>
        </header>
      </section>
    )
  }

  return (
    <section className="league-strategy-plan phil-power-plan panel" aria-label="Emperor Phil team power plan">
      <header>
        <div>
          <span className="eyebrow">Emperor Phil · private strategy</span>
          <h2>Improve the lineup, not the calculator</h2>
          <p>{profile.objective}</p>
        </div>
        <span className="power-policy"><ShieldCheck size={16} /> {profile.label}</span>
      </header>

      <div className="power-plan-scorecard">
        <article><small>Current power rank</small><strong>#{mine.rank}<span> / {teams.length}</span></strong><em>{mine.coveragePercent}% market coverage</em></article>
        <article><small>Current lineup index</small><strong>{mine.score.toLocaleString()}</strong><em>same-format redraft consensus</em></article>
        <article><small>Top-{profile.targetRank} threshold</small><strong>{mine.targetScore.toLocaleString()}</strong><em>current #{profile.targetRank} score</em></article>
        <article className={mine.gapToTarget > 0 ? 'power-gap' : 'power-cleared'}><small>Gap to goal</small><strong>{mine.gapToTarget ? `+${mine.gapToTarget.toLocaleString()}` : 'Cleared'}</strong><em>{profile.idealPowerGain.toLocaleString()} is the ideal move threshold</em></article>
      </div>

      <div className="power-position-grid">
        {positions.map((position) => {
          const value = mine.positionTotals[position]
          const delta = value - medians[position]
          return <article key={position}><span>{position}</span><strong>{value.toLocaleString()}</strong><small className={delta >= 0 ? 'positive' : 'negative'}>{signed(delta)} vs league median</small></article>
        })}
      </div>

      <div className="power-plan-rules">
        <div><Target size={17} /><span><strong>Move gate</strong><small>Prefer a single acquisition worth at least +{profile.minimumMeaningfulPowerGain}; target +{profile.idealPowerGain} before paying a premium.</small></span></div>
        <div><LockKeyhole size={17} /><span><strong>Protected liquidity</strong><small>Keep the {protectedFirst.label} until {protectedFirst.until}.</small></span></div>
        <div><ArrowUpRight size={17} /><span><strong>Week {profile.reassessAfterWeek} gate</strong><small>{currentGate?.action ?? 'Reassess the roster against the declared rank bands.'}</small></span></div>
      </div>
    </section>
  )
}
