import { CalendarClock, CheckCircle2, CircleDashed, Dice5, ListOrdered, LoaderCircle, ShieldAlert, Target } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { fetchRedraftDraftPool } from '../api'
import type { LeagueContext } from '../league-context'
import { FREAKBULL_KEEPER_RULE, keeperRetentionProbability, totalFreakbullKeepers } from '../leagues/freakbull/keeper-rules'
import { availableRedraftBoard, buildRedraftDraftPlan } from '../redraft-draft'
import { draftPickLabel, runRedraftMockDrafts } from '../redraft-simulator'
import type { MockDraftResult } from '../redraft-simulator'
import type { LeagueBundle, RedraftDraftPool, ValueBundle } from '../types'

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

function modelStatus(status: 'active' | 'waiting' | 'unavailable', label: string, detail: string) {
  const Icon = status === 'active' ? CheckCircle2 : status === 'waiting' ? CircleDashed : ShieldAlert
  return (
    <article className={`redraft-model-status status-${status}`}>
      <Icon size={18} />
      <div><strong>{label}</strong><span>{detail}</span></div>
      <b>{status === 'active' ? 'Active' : status === 'waiting' ? 'Waiting' : 'Unavailable'}</b>
    </article>
  )
}

export function RedraftDraftView({
  leagueBundle,
  leagueContext,
  values,
  myRosterId,
}: {
  leagueBundle: LeagueBundle
  leagueContext: LeagueContext
  values: ValueBundle
  myRosterId: number | null
}) {
  const plan = useMemo(() => buildRedraftDraftPlan(leagueBundle, myRosterId), [leagueBundle, myRosterId])
  const board = useMemo(() => availableRedraftBoard(values.players, leagueBundle.draftPicks, 18), [values.players, leagueBundle.draftPicks])
  const [pool, setPool] = useState<RedraftDraftPool | null>(null)
  const [poolError, setPoolError] = useState<string | null>(null)
  const [mockResult, setMockResult] = useState<MockDraftResult | null>(null)
  const [calculating, setCalculating] = useState(false)

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

  const myTeam = leagueBundle.rosters.find((roster) => roster.roster_id === myRosterId)
  const myUser = leagueBundle.users.find((user) => user.user_id === myTeam?.owner_id)
  const nextPick = mockResult?.nextUserOverallPick ?? plan.pickWindows[0]?.overallPick ?? null
  const nextPickLabel = nextPick ? draftPickLabel(nextPick, plan.teamCount) : 'Pending'
  const currentPick = mockResult?.currentOverallPick ?? 1
  const picksBeforeYou = nextPick ? Math.max(0, nextPick - currentPick) : null
  const followingPickLabel = mockResult?.followingUserOverallPick
    ? draftPickLabel(mockResult.followingUserOverallPick, plan.teamCount)
    : 'your next turn'

  return (
    <main className="page-shell redraft-page">
      <section className="redraft-hero">
        <div>
          <span className="eyebrow accent-eyebrow">Keeper redraft · live snake planning</span>
          <h1>Prepare the decision at {nextPickLabel}.</h1>
          <p>
            This workspace now runs full snake drafts around your actual seat, removes live Sleeper picks and keepers,
            varies opponent selections, and compares the completed teams produced by each opening choice.
          </p>
        </div>
        <div className="redraft-hero-status">
          <CalendarClock size={20} />
          <span><small>Scheduled draft</small><strong>{draftDate(leagueBundle.draft?.start_time)}</strong></span>
        </div>
      </section>

      <section className="redraft-scorecard" aria-label="Pre-draft facts">
        <article><small>Your next pick</small><strong>{nextPickLabel}</strong><span>{myUser ? `@${myUser.display_name}` : 'Roster mapping pending'}</span></article>
        <article><small>Snake state</small><strong>{picksBeforeYou === 0 ? 'On clock' : `${picksBeforeYou ?? '—'} before you`}</strong><span>{plan.teamCount} teams · {plan.rounds} rounds · {plan.recordedPicks} recorded</span></article>
        <article><small>Keeper process</small><strong>{totalFreakbullKeepers()} of 4</strong><span>1 protected + 3 on wheel; 1 wheel cut</span></article>
        <article><small>Starting lineup</small><strong>{leagueContext.roster.skillStartingSlots}</strong><span>skill starters · {leagueContext.roster.benchSlots} bench</span></article>
      </section>

      <section className="panel redraft-pick-panel">
        <header className="redraft-panel-heading">
          <div><span className="eyebrow">Monte Carlo decision ladder</span><h2>Take the first available player in this order at {nextPickLabel}</h2></div>
          <span className="redraft-method-chip">{mockResult ? `${mockResult.simulations} room paths · ${mockResult.scenarioSimulations} builds/player` : 'Loading live draft pool'}</span>
        </header>
        {!pool && !poolError && (
          <div className="redraft-loading"><LoaderCircle className="spin" size={20} /><span>Loading the full 2026 projection and ADP pool…</span></div>
        )}
        {pool && calculating && (
          <div className="redraft-loading"><LoaderCircle className="spin" size={20} /><span>Running full 13-round snake drafts around seat {plan.draftSlot}…</span></div>
        )}
        {poolError && <div className="redraft-unavailable"><ShieldAlert size={20} /><span>{poolError}. No substitute mock ranking is being shown.</span></div>}
        {mockResult && mockResult.candidates.length > 0 && (
          <div className="redraft-candidate-board">
            <div className="redraft-candidate-head"><span>Priority</span><span>Player</span><span>Available at {nextPickLabel}</span><span>League projection</span><span>Simulated lineup</span><span>Survives to {followingPickLabel}</span></div>
            {mockResult.candidates.slice(0, 8).map((candidate, index) => (
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
            The lineup column is the average completed starting-lineup projection when that player is available and forced at {nextPickLabel}.
            Availability—not a global rank—drives the ladder. Refresh the league during the draft to remove recorded picks.
          </p>
        )}
      </section>

      <section className="redraft-grid redraft-grid-top">
        <article className="panel redraft-round-panel">
          <header className="redraft-panel-heading">
            <div><span className="eyebrow">Contingent round plan</span><h2>What the mocks select at each turn</h2></div>
            <ListOrdered size={20} />
          </header>
          <div className="redraft-round-plan">
            {mockResult?.roundPlans.slice(0, 8).map((round) => (
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
            {!mockResult && <p>Round contingencies appear after the live mocks finish.</p>}
          </div>
        </article>

        <article className="panel redraft-keeper-panel">
          <header className="redraft-panel-heading">
            <div><span className="eyebrow">Recorded league rule</span><h2>Four keeper candidates, three retained</h2></div>
            <Dice5 size={20} />
          </header>
          <div className="redraft-keeper-lanes">
            <article><small>Protected lane</small><strong>{FREAKBULL_KEEPER_RULE.protectedKeepers}</strong><span>{percentage(keeperRetentionProbability('protected'))} retained</span></article>
            <article><small>Wheel lane</small><strong>{FREAKBULL_KEEPER_RULE.wheelCandidates}</strong><span>{percentage(keeperRetentionProbability('wheel'))} each</span></article>
            <article><small>Wheel result</small><strong>{FREAKBULL_KEEPER_RULE.wheelCuts} cut</strong><span>equal odds</span></article>
          </div>
          <p className="redraft-keeper-advice">
            Draft implication: build toward four credible keeper candidates, not just three. The mocks still optimize the 2026 lineup;
            keeper optionality stays visible and separate until a following-season forecast is validated.
          </p>
        </article>
      </section>

      <section className="panel redraft-build-panel">
        <header className="redraft-panel-heading">
          <div><span className="eyebrow">Representative complete teams</span><h2>What different openings can become</h2></div>
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
          {!mockResult && <p>Complete example builds appear after the simulation finishes.</p>}
        </div>
      </section>

      <section className="redraft-grid redraft-grid-bottom">
        <article className="panel redraft-market-panel">
          <header className="redraft-panel-heading">
            <div><span className="eyebrow">Independent market cross-check</span><h2>Current-season consensus</h2></div>
            <span className="redraft-method-chip">secondary evidence · not the pick model</span>
          </header>
          <div className="redraft-board">
            {board.map((player, index) => (
              <div key={player.sleeperId ?? player.slug}>
                <b>{index + 1}</b>
                <span><strong>{player.name}</strong><small>{player.team ?? 'FA'} · {player.position}{player.posRank ? player.posRank : ''}</small></span>
                <em>{Math.round(player.composite)}</em>
              </div>
            ))}
            {board.length === 0 && <p>Current-season market data is unavailable. No substitute ranking is being shown.</p>}
          </div>
          <p className="redraft-source-note">
            Tradyr current-season composite as of {new Date(values.meta.generatedAt).toLocaleString()}. Market order is kept separate from league projections and simulated builds.
          </p>
        </article>

        <article className="panel redraft-model-panel">
          <header className="redraft-panel-heading">
            <div><span className="eyebrow">Model register</span><h2>What can be trusted today</h2></div>
          </header>
          <div className="redraft-model-list">
            {modelStatus(plan.draftSlot ? 'active' : 'waiting', 'Exact snake engine', plan.draftSlot ? `Seat ${plan.draftSlot}; live picks and keepers override every path.` : 'Waiting for assigned draft order.')}
            {modelStatus(mockResult ? 'active' : poolError ? 'unavailable' : 'waiting', 'Opponent availability simulation', mockResult ? `${mockResult.simulations} variable room paths plus conditional completed builds.` : poolError ?? 'Waiting for the projection pool.')}
            {modelStatus(pool ? 'active' : poolError ? 'unavailable' : 'waiting', 'League-scored projections', pool ? `${pool.players.length} draftable players; ${leagueBundle.league.scoring_settings.pass_td}-point passing TDs.` : poolError ?? 'Waiting for source data.')}
            {modelStatus('active', 'Keeper process', 'One protected keeper plus two of three equal-odds wheel candidates; descriptive rule only.')}
            {modelStatus('unavailable', 'Championship probability', 'No historical league draft, waiver, lineup, and outcome model has been validated.')}
          </div>
        </article>
      </section>

      {mockResult && (
        <section className="redraft-model-boundary">
          <strong>Model boundary</strong>
          {mockResult.boundary.map((boundary) => <p key={boundary}>{boundary}</p>)}
          <small>Projection pool generated {pool ? new Date(pool.generatedAt).toLocaleString() : 'unavailable'} · {pool?.source}</small>
        </section>
      )}
    </main>
  )
}
