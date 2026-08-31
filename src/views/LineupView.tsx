import { AlertTriangle, ArrowRight, CalendarDays, CheckCircle2, Clock3, RefreshCw, ShieldQuestion } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { fetchLeagueMatchups, fetchSleeperPlayers, fetchWeeklyLineupData } from '../api'
import { AssetBadge, Avatar } from '../components/domain-ui'
import type { LeagueContext } from '../league-context'
import type { LeagueBundle, PlayerProjection, SleeperMatchup, Team } from '../types'
import {
  buildWeeklyCandidates,
  hydrateLineupTeam,
  optimizeWeeklyLineup,
  submittedLineupDelta,
  type WeeklyCandidate,
  type WeeklyLineupRecommendation,
  type WeeklyProjectionBundle,
} from '../weekly-lineup'

type LoadedLineup = {
  bundle: WeeklyProjectionBundle
  matchups: SleeperMatchup[]
  teams: Team[]
}

function unavailableWeeklyBundle(season: number, week: number): WeeklyProjectionBundle {
  return {
    season,
    week,
    status: 'unavailable',
    generatedAt: new Date().toISOString(),
    sourceDate: null,
    source: {
      name: 'DynastyProcess weekly FantasyPros consensus',
      url: 'https://github.com/dynastyprocess/data',
      pointMethod: 'rank-to-points',
    },
    projections: {},
    games: {},
    scheduleComplete: false,
    coverage: { sourceRows: 0, matchedSleeperPlayers: 0, scheduleTeams: 0 },
    warnings: ['The current weekly source could not be reached.'],
  }
}

function points(value: number | null): string {
  return value === null ? 'Uncovered' : value.toFixed(1)
}

function sourceLabel(candidate: WeeklyCandidate): string {
  if (candidate.source === 'weekly-consensus') return 'Weekly consensus'
  return 'Awaiting weekly projection'
}

function kickoffLabel(candidate: WeeklyCandidate): string {
  const game = candidate.game
  if (!game) return candidate.asset.team ? 'Schedule unavailable' : 'NFL team unavailable'
  const kickoff = new Date(`${game.gameday}T${game.gametime}:00`)
  const time = Number.isFinite(kickoff.getTime())
    ? kickoff.toLocaleTimeString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })
    : `${game.gameday} ${game.gametime}`
  return `${time} · ${game.home ? 'vs.' : '@'} ${game.opponent}`
}

function availabilityLabel(candidate: WeeklyCandidate): string | null {
  if (candidate.availability === 'available') return null
  if (candidate.availability === 'questionable') return 'Questionable'
  if (candidate.availability === 'doubtful') return 'Doubtful'
  if (candidate.availability === 'bye') return 'Bye'
  if (candidate.availability === 'reserve') return 'Reserve'
  if (candidate.availability === 'taxi') return 'Taxi'
  if (candidate.availability === 'inactive') return 'Inactive'
  return 'Out'
}

function sourceStatus(bundle: WeeklyProjectionBundle): { tone: string; title: string; copy: string } {
  if (bundle.status === 'ready') return {
    tone: 'ready',
    title: `Week ${bundle.week} consensus is live`,
    copy: `${bundle.coverage.matchedSleeperPlayers} players are joined to stable Sleeper IDs.`,
  }
  if (bundle.status === 'partial') return {
    tone: 'warning',
    title: `Week ${bundle.week} coverage is partial`,
    copy: 'RosterLab ranks only players covered by the current weekly board. Uncovered players never inherit preseason points.',
  }
  if (bundle.status === 'not-published') return {
    tone: 'warning',
    title: `The ${bundle.season} weekly board is not published yet`,
    copy: 'RosterLab will show current roster, schedule and availability facts, but it will not recommend lineup changes yet.',
  }
  return {
    tone: 'error',
    title: 'Weekly projections are unavailable',
    copy: 'RosterLab will not turn a missing projection into a zero.',
  }
}

function LineupRows({ recommendation, onOpenPlayer }: {
  recommendation: WeeklyLineupRecommendation
  onOpenPlayer: (playerId: string) => void
}) {
  return <div className="weekly-lineup-list">
    {recommendation.slots.map((slot) => {
      const candidate = slot.candidate
      return <div className={`weekly-lineup-row ${candidate ? '' : 'uncovered'}`} key={`${slot.slot}:${slot.slotIndex}`}>
        <span className="weekly-slot">{slot.slot.replace('_', ' ')}</span>
        {candidate ? <>
          <AssetBadge position={candidate.asset.position} />
          <button type="button" className="weekly-player-link" onClick={() => onOpenPlayer(candidate.asset.id)}>
            <strong>{candidate.asset.name}</strong>
            <small>{kickoffLabel(candidate)}</small>
          </button>
          <span className="weekly-source">
            <b>{sourceLabel(candidate)}</b>
            <small>{candidate.weekly?.positionRank ?? (candidate.scoringComplete ? 'League adjusted' : 'Scoring caveat')}</small>
          </span>
          <span className="weekly-points"><b>{points(candidate.points)}</b><small>projected</small></span>
          {availabilityLabel(candidate) && <span className={`availability-tag ${candidate.availability}`}>{availabilityLabel(candidate)}</span>}
        </> : <div className="weekly-missing-slot"><strong>No covered legal starter</strong><small>RosterLab is withholding a fake point estimate.</small></div>}
      </div>
    })}
  </div>
}

function BenchRows({ candidates, onOpenPlayer }: { candidates: WeeklyCandidate[]; onOpenPlayer: (playerId: string) => void }) {
  if (!candidates.length) return <div className="weekly-empty"><ShieldQuestion size={18} /><span>No players were found in the current Sleeper roster.</span></div>
  return <div className="weekly-bench-list">
    {candidates.map((candidate) => <button type="button" key={candidate.asset.id} onClick={() => onOpenPlayer(candidate.asset.id)}>
      <AssetBadge position={candidate.asset.position} />
      <span><strong>{candidate.asset.name}</strong><small>{kickoffLabel(candidate)}</small></span>
      <span className="weekly-bench-source"><small>{sourceLabel(candidate)}</small>{availabilityLabel(candidate) && <em>{availabilityLabel(candidate)}</em>}</span>
      <b>{points(candidate.points)}</b>
    </button>)}
  </div>
}

function TeamProjection({ label, team, recommendation }: {
  label: string
  team: Team | null
  recommendation: WeeklyLineupRecommendation | null
}) {
  return <article>
    <small>{label}</small>
    <strong>{team?.teamName ?? 'No matchup found'}</strong>
    <span>{team ? `@${team.ownerName}` : 'Sleeper has not paired this roster yet.'}</span>
    <b>{recommendation?.complete ? `${recommendation.total.toFixed(1)} pts` : 'Projection incomplete'}</b>
  </article>
}

export function LineupView({ teams, leagueBundle, leagueContext, myRosterId, playerProjections, onOpenPlayer }: {
  teams: Team[]
  leagueBundle: LeagueBundle
  leagueContext: LeagueContext
  myRosterId: number
  playerProjections: Map<string, PlayerProjection>
  onOpenPlayer: (playerId: string) => void
}) {
  const season = Number(leagueBundle.league.season)
  const week = Math.max(1, Math.min(18, Number(leagueBundle.league.settings.leg ?? 1)))
  const [loaded, setLoaded] = useState<LoadedLineup | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshNonce, setRefreshNonce] = useState(0)

  useEffect(() => {
    let cancelled = false
    const issues: string[] = []
    setLoading(true)
    setError(null)
    const ids = teams.flatMap((team) => team.players.map((asset) => asset.id))
    void Promise.all([
      fetchWeeklyLineupData(season, week, { fresh: refreshNonce > 0 }).catch((loadError) => {
        issues.push(loadError instanceof Error ? loadError.message : 'Weekly projection source unavailable')
        return unavailableWeeklyBundle(season, week)
      }),
      fetchLeagueMatchups(leagueContext.id, week).catch((loadError) => {
        issues.push(loadError instanceof Error ? loadError.message : 'Sleeper matchup unavailable')
        return []
      }),
      fetchSleeperPlayers(ids).catch(() => new Map()),
    ]).then(([bundle, matchups, catalog]) => {
      if (cancelled) return
      setLoaded({ bundle, matchups, teams: teams.map((team) => hydrateLineupTeam(team, catalog)) })
      if (issues.length) setError([...new Set(issues)].join(' · '))
    }).catch((loadError) => {
      if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Weekly lineup data is unavailable')
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [leagueContext.id, refreshNonce, season, teams, week])

  const analysis = useMemo(() => {
    if (!loaded) return null
    const myTeam = loaded.teams.find((team) => team.rosterId === myRosterId) ?? null
    const myMatchup = loaded.matchups.find((matchup) => matchup.roster_id === myRosterId) ?? null
    const opponentMatchup = myMatchup?.matchup_id === null || myMatchup?.matchup_id === undefined
      ? null
      : loaded.matchups.find((matchup) => matchup.matchup_id === myMatchup.matchup_id && matchup.roster_id !== myRosterId) ?? null
    const opponent = opponentMatchup
      ? loaded.teams.find((team) => team.rosterId === opponentMatchup.roster_id) ?? null
      : null
    const myCandidates = myTeam ? buildWeeklyCandidates(myTeam, loaded.bundle, playerProjections, leagueContext) : []
    const opponentCandidates = opponent ? buildWeeklyCandidates(opponent, loaded.bundle, playerProjections, leagueContext) : []
    const recommendation = myTeam ? optimizeWeeklyLineup(myCandidates, leagueBundle.league.roster_positions) : null
    const opponentRecommendation = opponent ? optimizeWeeklyLineup(opponentCandidates, leagueBundle.league.roster_positions) : null
    return {
      myTeam,
      opponent,
      myCandidates,
      recommendation,
      opponentRecommendation,
      submitted: recommendation ? submittedLineupDelta(myMatchup?.starters ?? [], recommendation, myCandidates) : null,
      hasSubmittedLineup: Boolean(myMatchup?.starters?.some((id) => id && id !== '0')),
    }
  }, [leagueBundle.league.roster_positions, leagueContext, loaded, myRosterId, playerProjections])

  const status = loaded ? sourceStatus(loaded.bundle) : null
  const scoringCaveat = analysis?.recommendation
    ? analysis.recommendation.exactScoringCovered < analysis.recommendation.covered
    : false
  const weeklyBoardExists = loaded
    ? (loaded.bundle.status === 'ready' || loaded.bundle.status === 'partial')
      && loaded.bundle.coverage.matchedSleeperPlayers > 0
    : false

  return <main className="page-shell lineup-page">
    <section className="lineup-hero panel">
      <div>
        <span className="eyebrow accent-eyebrow">Weekly decision desk · {leagueContext.label}</span>
        <h1>Week {week} Lineup Lab</h1>
        <p>Set the highest covered legal lineup, see the closest calls, and preserve late-swap flexibility. Missing data stays missing—not zero.</p>
      </div>
      <button type="button" className="lineup-refresh" disabled={loading} onClick={() => setRefreshNonce((value) => value + 1)}>
        <RefreshCw size={16} className={loading ? 'spin' : ''} /> {loading ? 'Refreshing…' : 'Refresh week'}
      </button>
      <div className="lineup-league-facts">
        <span><small>Active starters</small><b>{leagueContext.roster.startingSlots}</b></span>
        <span><small>Reception scoring</small><b>{leagueContext.scoring.receptionPpr} PPR · +{leagueContext.scoring.tePremiumPerReception} TEP</b></span>
        <span><small>Quarterbacks</small><b>{leagueContext.scoring.passingTd}-pt TD · {leagueContext.scoring.passingInterception} INT</b></span>
        <span><small>Special teams</small><b>{leagueBundle.league.roster_positions.includes('K') ? 'K + DEF required' : 'No K / DEF slots'}</b></span>
      </div>
    </section>

    {error ? <section className="lineup-notice error panel"><AlertTriangle size={20} /><div><strong>Lineup Lab could not refresh</strong><p>{error}. No recommendation is being inferred from missing data.</p></div></section> : null}
    {loading && !loaded ? <section className="lineup-loading panel"><RefreshCw className="spin" size={20} /><div><strong>Building the Week {week} board…</strong><span>Joining current Sleeper rosters, matchups, injuries, schedule, and projections.</span></div></section> : null}

    {loaded && analysis && status ? <>
      <section className={`lineup-notice ${status.tone} panel`}>
        {status.tone === 'ready' ? <CheckCircle2 size={20} /> : <AlertTriangle size={20} />}
        <div><strong>{status.title}</strong><p>{status.copy}</p></div>
        <span>{loaded.bundle.sourceDate ? `Source date ${loaded.bundle.sourceDate}` : 'No source date'}</span>
      </section>

      {weeklyBoardExists ? <section className="lineup-matchup panel">
        <div className="panel-heading"><div><span className="eyebrow">Current matchup</span><h2>Covered lineup comparison</h2></div><span className="method-note">Sleeper Week {week} pairing</span></div>
        <div className="lineup-matchup-grid">
          <TeamProjection label="Your team" team={analysis.myTeam} recommendation={analysis.recommendation} />
          <span className="lineup-versus">vs</span>
          <TeamProjection label="Opponent" team={analysis.opponent} recommendation={analysis.opponentRecommendation} />
        </div>
        <p className="lineup-boundary">These are projection totals only when every required slot is covered. They are not win probabilities and do not include sportsbook or news adjustments.</p>
      </section> : null}

      {weeklyBoardExists && analysis.recommendation ? <section className="lineup-grid">
        <article className="panel lineup-starters">
          <div className="panel-heading"><div><span className="eyebrow">Recommended starters</span><h2>Best covered legal lineup</h2></div><span className="method-note">{analysis.recommendation.covered}/{analysis.recommendation.required} slots covered</span></div>
          <LineupRows recommendation={analysis.recommendation} onOpenPlayer={onOpenPlayer} />
          <div className="lineup-total">
            <span><small>Projected total</small><b>{analysis.recommendation.complete ? `${analysis.recommendation.total.toFixed(1)} pts` : 'Incomplete'}</b></span>
            <span><small>Current-week sources</small><b>{analysis.recommendation.weeklySourceCount}/{analysis.recommendation.covered}</b></span>
            <span><small>Exact scoring coverage</small><b>{analysis.recommendation.exactScoringCovered}/{analysis.recommendation.covered}</b></span>
          </div>
          {scoringCaveat && <p className="lineup-boundary warning"><AlertTriangle size={15} /> Generic weekly points do not fully reproduce this league’s QB, kicker, or defense scoring. Those rows remain useful for ordering, but the site labels the total provisional.</p>}
        </article>

        <aside className="lineup-side-stack">
          <section className="panel lineup-changes">
            <div className="panel-heading"><div><span className="eyebrow">Sleeper check</span><h2>Changes to make</h2></div></div>
            {!analysis.recommendation.complete ? <div className="weekly-empty"><ShieldQuestion size={18} /><span>Current-week coverage is incomplete, so RosterLab is withholding lineup changes.</span></div> : !analysis.hasSubmittedLineup ? <div className="weekly-empty"><CalendarDays size={18} /><span>No starting lineup is submitted in Sleeper yet.</span></div> : analysis.submitted && (analysis.submitted.incoming.length || analysis.submitted.outgoing.length) ? <>
              <div className="lineup-swap-list">
                {analysis.submitted.incoming.map((incoming, index) => <div key={incoming.asset.id}>
                  <span><small>Bench</small><b>{analysis.submitted?.outgoing[index]?.asset.name ?? 'Current starter'}</b></span>
                  <ArrowRight size={15} />
                  <span><small>Start</small><b>{incoming.asset.name}</b></span>
                </div>)}
              </div>
              <p className="lineup-swap-delta">Covered projection change <b>{analysis.submitted.projectedDelta === null ? 'Unavailable' : `${analysis.submitted.projectedDelta >= 0 ? '+' : ''}${analysis.submitted.projectedDelta.toFixed(1)} pts`}</b></p>
            </> : <div className="weekly-empty"><CheckCircle2 size={18} /><span>Your submitted covered starters already match the recommendation.</span></div>}
          </section>

          <section className="panel lineup-close-calls">
            <div className="panel-heading"><div><span className="eyebrow">Decision margin</span><h2>Closest calls</h2></div></div>
            {analysis.recommendation.closeCalls.length ? <div>
              {analysis.recommendation.closeCalls.map((call) => <article key={`${call.slot}:${call.starter.asset.id}`}>
                <span><small>{call.slot.replace('_', ' ')}</small><b>{call.starter.asset.name}</b></span>
                <strong>+{call.projectedDelta.toFixed(1)}</strong>
                <span><small>over</small><b>{call.alternative.asset.name}</b></span>
              </article>)}
            </div> : <div className="weekly-empty"><ShieldQuestion size={18} /><span>No fully covered alternatives exist for the selected slots.</span></div>}
          </section>
        </aside>
      </section> : null}

      {weeklyBoardExists && analysis.recommendation ? <section className="lineup-bench panel">
        <div className="panel-heading"><div><span className="eyebrow">Bench and unavailable</span><h2>What the optimizer left out</h2></div><span className="method-note">Sorted by covered points; statuses are not probability discounts</span></div>
        <BenchRows candidates={analysis.recommendation.bench} onOpenPlayer={onOpenPlayer} />
      </section> : null}

      {!weeklyBoardExists ? <section className="lineup-bench panel">
        <div className="panel-heading"><div><span className="eyebrow">Current Sleeper facts</span><h2>Roster availability and schedule</h2></div><span className="method-note">No start/sit model is active</span></div>
        <BenchRows candidates={analysis.myCandidates} onOpenPlayer={onOpenPlayer} />
        <p className="lineup-boundary warning"><AlertTriangle size={15} /> Your submitted lineup remains unchanged. RosterLab will not compare players until the current Week {week} consensus is available.</p>
      </section> : null}

      <section className="lineup-method panel">
        <Clock3 size={20} />
        <div><strong>What “weekly consensus” means</strong><p>It is a current-week aggregate of multiple fantasy analysts’ rankings, converted to estimated PPR points. It changes with matchup, role and injury information. RosterLab joins it to current Sleeper ownership, submitted starters, reserve/taxi state and the NFL schedule, then applies the active league’s TE reception premium only when reception evidence exists. It never substitutes the season-transition model for a missing weekly projection.</p></div>
        <a href={loaded.bundle.source.url} target="_blank" rel="noreferrer">Inspect source</a>
      </section>
    </> : null}
  </main>
}
