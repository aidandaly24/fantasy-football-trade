import { CalendarClock, ListOrdered, LoaderCircle, Search, ShieldAlert, Target } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { fetchRedraftDraftPool } from '../api'
import type { LeagueContext } from '../league-context'
import { buildRedraftDraftPlan } from '../redraft-draft'
import { availableRedraftRankings, draftPickLabel, runRedraftMockDrafts } from '../redraft-simulator'
import type { DraftablePosition, MockDraftResult, RedraftRanking } from '../redraft-simulator'
import type { LeagueBundle, RedraftDraftPool } from '../types'

type BoardPosition = 'ALL' | DraftablePosition

const BOARD_POSITIONS: BoardPosition[] = ['ALL', 'RB', 'WR', 'QB', 'TE']

function draftDate(startTime: number | undefined): string {
  if (!startTime) return 'Not scheduled'
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  }).format(new Date(startTime))
}

function percentage(value: number): string {
  return `${Math.round(value * 100)}%`
}

function score(value: number): string {
  return Math.round(value).toLocaleString()
}

function providerLabel(company: string): string {
  if (company.toLowerCase() === 'rotowire') return 'Rotowire'
  return company.charAt(0).toUpperCase() + company.slice(1)
}

function marketWindow(player: RedraftRanking, teamCount: number, rounds: number): string {
  const overallPick = Math.max(1, Math.round(player.adp))
  return overallPick > teamCount * rounds ? 'Waiver range' : draftPickLabel(overallPick, teamCount)
}

function closestUserTurn(player: RedraftRanking, pickWindows: Array<{ overallPick: number }>, teamCount: number, rounds: number): string {
  if (player.adp > teamCount * rounds) return 'After draft'
  const closest = pickWindows.reduce((best, pick) => (
    Math.abs(pick.overallPick - player.adp) < Math.abs(best.overallPick - player.adp) ? pick : best
  ), pickWindows[0])
  return closest ? draftPickLabel(closest.overallPick, teamCount) : 'Pending'
}

export function RedraftDraftView({
  leagueBundle,
  leagueContext,
  myRosterId,
}: {
  leagueBundle: LeagueBundle
  leagueContext: LeagueContext
  myRosterId: number | null
}) {
  const plan = useMemo(() => buildRedraftDraftPlan(leagueBundle, myRosterId), [leagueBundle, myRosterId])
  const [pool, setPool] = useState<RedraftDraftPool | null>(null)
  const [poolError, setPoolError] = useState<string | null>(null)
  const [mockResult, setMockResult] = useState<MockDraftResult | null>(null)
  const [calculating, setCalculating] = useState(false)
  const [boardPosition, setBoardPosition] = useState<BoardPosition>('ALL')
  const [boardQuery, setBoardQuery] = useState('')

  useEffect(() => {
    let cancelled = false
    setPool(null)
    setPoolError(null)
    void fetchRedraftDraftPool(leagueBundle.league.season)
      .then((nextPool) => {
        if (!cancelled) setPool(nextPool)
      })
      .catch((error: unknown) => {
        if (!cancelled) setPoolError(error instanceof Error ? error.message : 'Draft projection source is unavailable')
      })
    return () => { cancelled = true }
  }, [leagueBundle.league.season])

  useEffect(() => {
    setMockResult(null)
    if (!pool || myRosterId === null || !plan.draftSlot) return
    setCalculating(true)
    const timer = window.setTimeout(() => {
      setMockResult(runRedraftMockDrafts(leagueBundle, pool, myRosterId, { simulations: 140, scenarioSimulations: 60 }))
      setCalculating(false)
    }, 0)
    return () => {
      window.clearTimeout(timer)
      setCalculating(false)
    }
  }, [leagueBundle, myRosterId, plan.draftSlot, pool])

  const rankings = useMemo(() => pool ? availableRedraftRankings(pool, leagueBundle) : [], [pool, leagueBundle])
  const positionCounts = useMemo(() => rankings.reduce<Record<BoardPosition, number>>((counts, player) => {
    counts.ALL += 1
    counts[player.position] += 1
    return counts
  }, { ALL: 0, RB: 0, WR: 0, QB: 0, TE: 0 }), [rankings])
  const filteredRankings = useMemo(() => {
    const query = boardQuery.trim().toLowerCase()
    return rankings.filter((player) => {
      if (boardPosition !== 'ALL' && player.position !== boardPosition) return false
      if (!query) return true
      return `${player.name} ${player.team ?? ''} ${player.position}`.toLowerCase().includes(query)
    })
  }, [boardPosition, boardQuery, rankings])
  const projectionProviders = useMemo(() => pool
    ? [...new Set(pool.players.flatMap((player) => player.company ? [providerLabel(player.company)] : []))]
    : [], [pool])

  const myTeam = leagueBundle.rosters.find((roster) => roster.roster_id === myRosterId)
  const myUser = leagueBundle.users.find((user) => user.user_id === myTeam?.owner_id)
  const nextPick = mockResult?.nextUserOverallPick ?? plan.pickWindows[0]?.overallPick ?? null
  const nextPickLabel = nextPick ? draftPickLabel(nextPick, plan.teamCount) : 'Pending'
  const followingPickLabel = mockResult?.followingUserOverallPick
    ? draftPickLabel(mockResult.followingUserOverallPick, plan.teamCount)
    : plan.pickWindows[1] ? draftPickLabel(plan.pickWindows[1].overallPick, plan.teamCount) : 'Pending'
  const currentPick = mockResult?.currentOverallPick ?? 1
  const picksBeforeYou = nextPick ? Math.max(0, nextPick - currentPick) : null

  return (
    <main className="page-shell redraft-page">
      <section className="redraft-hero">
        <div>
          <span className="eyebrow accent-eyebrow">Freakbull draft room · full board</span>
          <h1>Draft all 13 rounds from seat {plan.draftSlot ?? '—'}.</h1>
          <p>
            Start with every available player, then use the simulator as a secondary what-if tool. Rankings are ordered by
            Sleeper PPR draft market; projections are rescored for this league’s six-point passing touchdowns.
          </p>
        </div>
        <div className="redraft-hero-status">
          <CalendarClock size={20} />
          <span><small>Scheduled draft</small><strong>{draftDate(leagueBundle.draft?.start_time)}</strong></span>
        </div>
      </section>

      <section className="redraft-scorecard" aria-label="Draft facts">
        <article><small>Your next pick</small><strong>{nextPickLabel}</strong><span>{myUser ? `@${myUser.display_name}` : 'Roster mapping pending'}</span></article>
        <article><small>Following turn</small><strong>{followingPickLabel}</strong><span>{picksBeforeYou === 0 ? 'You are on the clock' : `${picksBeforeYou ?? '—'} picks before you`}</span></article>
        <article><small>Draft shape</small><strong>{plan.rounds} rounds</strong><span>{plan.teamCount}-team snake · {plan.recordedPicks} picks recorded</span></article>
        <article><small>Roster</small><strong>{leagueContext.roster.skillStartingSlots} + {leagueContext.roster.benchSlots}</strong><span>skill starters + bench · no K/DST</span></article>
      </section>

      <section className="panel redraft-rankings-panel">
        <header className="redraft-panel-heading redraft-rankings-heading">
          <div><span className="eyebrow">Full rankings</span><h2>Every remaining draftable player</h2></div>
          <span className="redraft-method-chip">{rankings.length || '—'} available · drafted players and keepers removed</span>
        </header>
        <div className="redraft-board-controls">
          <div className="redraft-position-filters" role="group" aria-label="Filter rankings by position">
            {BOARD_POSITIONS.map((position) => (
              <button
                key={position}
                type="button"
                aria-pressed={boardPosition === position}
                className={boardPosition === position ? 'active' : ''}
                onClick={() => setBoardPosition(position)}
              >
                {position === 'ALL' ? 'All' : position}<small>{positionCounts[position]}</small>
              </button>
            ))}
          </div>
          <label className="redraft-board-search">
            <Search size={15} />
            <span className="sr-only">Search full rankings</span>
            <input value={boardQuery} onChange={(event) => setBoardQuery(event.target.value)} placeholder="Search player or team" />
          </label>
        </div>
        {!pool && !poolError && (
          <div className="redraft-loading"><LoaderCircle className="spin" size={20} /><span>Loading the full {leagueBundle.league.season} rankings…</span></div>
        )}
        {poolError && <div className="redraft-unavailable"><ShieldAlert size={20} /><span>{poolError}. No substitute ranking is being shown.</span></div>}
        {pool && (
          <div className="redraft-full-board" role="table" aria-label="Full available redraft rankings">
            <div className="redraft-full-board-head" role="row">
              <span>Rank</span><span>Player</span><span>Position</span><span>Market window</span><span>Your closest turn</span><span>League projection</span>
            </div>
            {filteredRankings.map((player) => (
              <article key={player.playerId} role="row">
                <b>#{player.overallRank}</b>
                <span className="redraft-full-player">
                  <strong>{player.name}</strong>
                  <small>{player.team ?? 'FA'}{player.injuryStatus ? ` · ${player.injuryStatus}` : ''}</small>
                </span>
                <span className={`redraft-position-tag position-${player.position.toLowerCase()}`}><strong>{player.position}{player.positionRank}</strong></span>
                <span><strong>ADP {player.adp.toFixed(1)}</strong><small>{marketWindow(player, plan.teamCount, plan.rounds)}</small></span>
                <span><strong>{closestUserTurn(player, plan.pickWindows, plan.teamCount, plan.rounds)}</strong><small>nearest selection</small></span>
                <span><strong>{score(player.projectedPoints)}</strong><small>league points</small></span>
              </article>
            ))}
            {filteredRankings.length === 0 && <p>No remaining player matches this filter.</p>}
          </div>
        )}
        <p className="redraft-source-note">
          Ordered by Sleeper PPR ADP. Raw season stats from {projectionProviders.join(', ') || 'the Sleeper projection feed'} are rescored with the league settings.
          This is draft-market order, not a blended dynasty value or Tradyr composite.
        </p>
      </section>

      <section className="panel redraft-pick-panel">
        <header className="redraft-panel-heading">
          <div><span className="eyebrow">Experimental on-clock comparison</span><h2>What the simulator prefers at {nextPickLabel}</h2></div>
          <span className="redraft-method-chip">{mockResult ? `${mockResult.simulations} room paths · ${mockResult.scenarioSimulations} builds/player` : 'Loading simulator'}</span>
        </header>
        {pool && calculating && (
          <div className="redraft-loading"><LoaderCircle className="spin" size={20} /><span>Running full {plan.rounds}-round snake drafts around seat {plan.draftSlot}…</span></div>
        )}
        {mockResult && mockResult.candidates.length > 0 && (
          <div className="redraft-candidate-board">
            <div className="redraft-candidate-head"><span>Priority</span><span>Player</span><span>Available now</span><span>League projection</span><span>Completed lineup</span><span>Survives to {followingPickLabel}</span></div>
            {mockResult.candidates.map((candidate, index) => (
              <article key={candidate.player.playerId}>
                <b>{index + 1}</b>
                <span className="redraft-player-cell">
                  <strong>{candidate.player.name}</strong>
                  <small>{candidate.player.position} · {candidate.player.team ?? 'FA'} · PPR ADP {candidate.player.adp.toFixed(1)}</small>
                </span>
                <span className="redraft-probability redraft-availability"><strong>{percentage(candidate.availableAtPickProbability)}</strong><small>at {nextPickLabel}</small><i style={{ width: percentage(candidate.availableAtPickProbability) }} /></span>
                <span className="redraft-projection"><strong>{score(candidate.player.projectedPoints)}</strong><small>season pts</small></span>
                <span className="redraft-lineup"><strong>{score(candidate.expectedStarterPoints)}</strong><small>starter pts</small></span>
                <span className="redraft-survival"><strong>{percentage(candidate.survivesNextTurnProbability)}</strong><small>to {followingPickLabel}</small></span>
              </article>
            ))}
          </div>
        )}
        {mockResult && mockResult.candidates.length === 0 && (
          <div className="redraft-unavailable"><ShieldAlert size={20} /><span>No remaining pick could be mapped to your roster.</span></div>
        )}
        {mockResult && (
          <p className="redraft-boundary-note">
            Use this to compare paths, not as a universal ranking. The full board above is the source of truth for who is available;
            this model’s opponent behavior is still being calibrated against real mock rooms.
          </p>
        )}
      </section>

      <section className="panel redraft-round-panel">
        <header className="redraft-panel-heading">
          <div><span className="eyebrow">All 13 turns</span><h2>Current contingent roadmap</h2></div>
          <ListOrdered size={20} />
        </header>
        <div className="redraft-round-plan redraft-round-plan-full">
          {mockResult?.roundPlans.map((round) => (
            <article key={round.overallPick}>
              <b>{draftPickLabel(round.overallPick, plan.teamCount)}</b>
              <span>
                {round.topSelections.map((selection) => (
                  <strong key={selection.player.playerId}>{selection.player.name} <small>{percentage(selection.probability)}</small></strong>
                ))}
              </span>
              <em>{round.positionMix.slice(0, 2).map((position) => `${position.position} ${percentage(position.probability)}`).join(' · ')}</em>
            </article>
          ))}
          {!mockResult && <p>The full round map appears after the simulator finishes.</p>}
        </div>
      </section>

      <section className="panel redraft-build-panel">
        <header className="redraft-panel-heading">
          <div><span className="eyebrow">Complete roster paths</span><h2>What different openings can become</h2></div>
          <Target size={20} />
        </header>
        <div className="redraft-builds">
          {mockResult?.builds.map((build) => (
            <article key={build.firstPick.playerId}>
              <header><span><small>Opened with</small><strong>{build.firstPick.name}</strong></span><em>{percentage(build.frequency)} of base mocks</em></header>
              <div>
                {build.picks.map((pick) => (
                  <span key={pick.overallPick}><b>{draftPickLabel(pick.overallPick, plan.teamCount)}</b><strong>{pick.player.name}</strong><small>{pick.player.position}</small></span>
                ))}
              </div>
              <footer><span>Starter projection <b>{score(build.starterPoints)}</b></span><span>Roster score <b>{score(build.rosterScore)}</b></span></footer>
            </article>
          ))}
          {!mockResult && <p>Complete example builds appear after the simulator finishes.</p>}
        </div>
      </section>

      {mockResult && (
        <section className="redraft-model-boundary">
          <strong>What is and is not modeled</strong>
          <p>Keeper rule: one guaranteed keeper plus two retained from three equal-odds wheel candidates. It is recorded separately and does not distort the current-season ranking.</p>
          {mockResult.boundary.map((boundary) => <p key={boundary}>{boundary}</p>)}
          <small>Projection pool generated {pool ? new Date(pool.generatedAt).toLocaleString() : 'unavailable'} · {pool?.source}</small>
        </section>
      )}
    </main>
  )
}
