import { CalendarClock, CheckCircle2, CircleDashed, ListOrdered, ShieldAlert, Target } from 'lucide-react'
import type { LeagueContext } from '../league-context'
import { availableRedraftBoard, buildRedraftDraftPlan } from '../redraft-draft'
import type { LeagueBundle, ValueBundle } from '../types'

function draftDate(startTime: number | undefined): string {
  if (!startTime) return 'Not scheduled'
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  }).format(new Date(startTime))
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
  const plan = buildRedraftDraftPlan(leagueBundle, myRosterId)
  const board = availableRedraftBoard(values.players, leagueBundle.draftPicks, 30)
  const myTeam = leagueBundle.rosters.find((roster) => roster.roster_id === myRosterId)
  const myUser = leagueBundle.users.find((user) => user.user_id === myTeam?.owner_id)
  const pickLabel = plan.draftSlot ? `1.${String(plan.draftSlot).padStart(2, '0')}` : 'Pending'

  return (
    <main className="page-shell redraft-page">
      <section className="redraft-hero">
        <div>
          <span className="eyebrow accent-eyebrow">Keeper redraft · pre-draft</span>
          <h1>Build the board before pick {pickLabel}.</h1>
          <p>
            A separate draft workspace for {leagueContext.leagueName}. It uses live league rules and current-season market order;
            dynasty values, rookie-pick curves, and long-horizon trade models are excluded.
          </p>
        </div>
        <div className="redraft-hero-status">
          <CalendarClock size={20} />
          <span><small>Scheduled draft</small><strong>{draftDate(leagueBundle.draft?.start_time)}</strong></span>
        </div>
      </section>

      <section className="redraft-scorecard" aria-label="Pre-draft facts">
        <article><small>Your seat</small><strong>{pickLabel}</strong><span>{myUser ? `@${myUser.display_name}` : 'Roster mapping pending'}</span></article>
        <article><small>Draft shape</small><strong>{plan.rounds} rounds</strong><span>{plan.teamCount}-team {plan.draftType} · {plan.recordedPicks} picks recorded</span></article>
        <article><small>Keepers</small><strong>{plan.myKeepers} / {plan.keeperLimit}</strong><span>{plan.leagueKeepers} recorded league-wide</span></article>
        <article><small>Lineup</small><strong>{leagueContext.roster.skillStartingSlots} + {leagueContext.roster.benchSlots}</strong><span>skill starters + bench</span></article>
      </section>

      <section className="redraft-grid redraft-grid-top">
        <article className="panel redraft-panel">
          <header className="redraft-panel-heading">
            <div><span className="eyebrow">Draft geometry v0.1</span><h2>Your first six windows</h2></div>
            <ListOrdered size={20} />
          </header>
          <div className="pick-window-list">
            {plan.pickWindows.length > 0 ? plan.pickWindows.map((pick) => (
              <div key={pick.round}>
                <span>Round {pick.round}</span>
                <strong>{pick.round}.{String(pick.draftSlot).padStart(2, '0')}</strong>
                <small>Overall {pick.overallPick}</small>
              </div>
            )) : <p>Draft order has not been assigned to this roster.</p>}
          </div>
        </article>

        <article className="panel redraft-panel">
          <header className="redraft-panel-heading">
            <div><span className="eyebrow">League pressure</span><h2>Starter demand before depth</h2></div>
            <Target size={20} />
          </header>
          <div className="starter-demand-list">
            {plan.starterDemand.map((row) => (
              <div key={row.position}>
                <b>{row.position}</b>
                <strong>{row.leagueWide}</strong>
                <span>{row.note}</span>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="panel redraft-plan-panel">
        <header className="redraft-panel-heading">
          <div><span className="eyebrow">Rule-based draft plan v0.1</span><h2>What the settings change</h2></div>
          <span className="redraft-method-chip">Settings-derived · not outcome-trained</span>
        </header>
        <div className="redraft-plan-rules">
          {plan.strategyRules.map((rule, index) => (
            <article key={rule}><b>{String(index + 1).padStart(2, '0')}</b><p>{rule}</p></article>
          ))}
        </div>
        <p className="redraft-boundary-note">
          Opening posture at 1.04: take an elite volume bet at RB or WR, build the flex core before forcing scarce-position narratives,
          and let the room—not a dynasty ranking—set the QB and TE price.
        </p>
      </section>

      <section className="redraft-grid redraft-grid-bottom">
        <article className="panel redraft-market-panel">
          <header className="redraft-panel-heading">
            <div><span className="eyebrow">Current-season market board</span><h2>Top available players</h2></div>
            <span className="redraft-method-chip">{board.length} shown · drafted players removed</span>
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
            Tradyr current-season composite as of {new Date(values.meta.generatedAt).toLocaleString()}. This is market order, not projected points or a trained draft-outcome score.
          </p>
        </article>

        <article className="panel redraft-model-panel">
          <header className="redraft-panel-heading">
            <div><span className="eyebrow">Separate model register</span><h2>What can be trusted today</h2></div>
          </header>
          <div className="redraft-model-list">
            {modelStatus(plan.draftSlot ? 'active' : 'waiting', 'Draft geometry v0.1', plan.draftSlot ? `Exact snake windows from slot ${plan.draftSlot}.` : 'Waiting for assigned draft order.')}
            {modelStatus(board.length > 0 ? 'active' : 'unavailable', 'Current-season market board', board.length > 0 ? 'Live redraft provider lane; drafted players excluded.' : 'No current-season provider output is available.')}
            {modelStatus(plan.leagueKeepers > 0 ? 'active' : 'waiting', 'Keeper-adjusted availability', plan.leagueKeepers > 0 ? `${plan.leagueKeepers} keepers included in availability.` : 'No keeper declarations are recorded yet.')}
            {modelStatus(plan.recordedPicks > 0 ? 'waiting' : 'unavailable', 'Roster power', plan.recordedPicks > 0 ? 'Partial draft only; wait for complete rosters.' : 'No roster exists before the draft.')}
            {modelStatus('unavailable', 'Draft outcome model', 'Needs historical draft, waiver, lineup, and scoring outcomes before training.')}
          </div>
        </article>
      </section>
    </main>
  )
}
