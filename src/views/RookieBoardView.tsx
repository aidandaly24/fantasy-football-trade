import { AlertTriangle, BarChart3, Check, ChevronRight, Info, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import type { LeagueContext } from '../league-context'
import { buildLeagueDraftReview } from '../draft-review'
import { AssetBadge } from '../components/domain-ui'
import {
  rookiePlayerKey,
  selectRookieBoardPlayers,
  type RookieBoardBundle,
  type RookieBoardSort,
  type RookiePosition,
} from '../rookies'
import type { LeagueBundle } from '../types'

const positions: Array<RookiePosition | 'ALL'> = ['ALL', 'QB', 'RB', 'WR', 'TE']

function percent(value: number, digits = 1): string {
  return `${(value * 100).toFixed(digits)}%`
}

function signedPercent(value: number): string {
  return `${value >= 0 ? '+' : ''}${percent(value)}`
}

function optionalPercent(value: number | null): string {
  return value === null ? 'Unavailable' : percent(value)
}

function signedValue(value: number): string {
  return `${value >= 0 ? '+' : '−'}${Math.abs(Math.round(value)).toLocaleString()}`
}

export function RookieBoardView({
  bundle,
  leagueContext,
  leagueBundle,
  myRosterId,
}: {
  bundle: RookieBoardBundle | null
  leagueContext: LeagueContext
  leagueBundle: LeagueBundle
  myRosterId: number | null
}) {
  const [basketOnly, setBasketOnly] = useState(false)
  const [position, setPosition] = useState<RookiePosition | 'ALL'>('ALL')
  const [sort, setSort] = useState<RookieBoardSort>('current')
  const [selectedKey, setSelectedKey] = useState<string | null>(null)

  if (!bundle) {
    return (
      <main className="page-shell rookie-page">
        <section className="rookie-hero panel">
          <div>
            <span className="eyebrow accent-eyebrow">Private rookie research</span>
            <h1>The rookie board is unavailable.</h1>
            <p>The site could not retrieve a validated, browser-safe model artifact. No empty ranking or substitute trade grade has been fabricated.</p>
          </div>
          <div className="rookie-status unavailable"><AlertTriangle size={20} /><span><strong>Evidence unavailable</strong><small>Try again after the model artifact is refreshed</small></span></div>
        </section>
      </main>
    )
  }

  const players = selectRookieBoardPlayers(bundle.board, { basketOnly, position, sort })
  const selected = players.find((player) => rookiePlayerKey(player) === selectedKey) ?? players[0] ?? null
  const basketCount = bundle.board.filter((player) => player.inValidatedSleeperBasket).length
  const dateFormat = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
  const generated = dateFormat.format(new Date(bundle.generatedAt))
  const currentMarketGenerated = bundle.currentMarket?.generatedAt
    ? dateFormat.format(new Date(bundle.currentMarket.generatedAt))
    : null
  const draftPickByPlayer = new Map(leagueBundle.draftPicks.map((pick) => [pick.player_id, pick]))
  const handleByUserId = new Map(leagueBundle.users.map((user) => [user.user_id, `@${user.display_name}`]))
  const draftReview = buildLeagueDraftReview(leagueBundle, bundle)

  return (
    <main className="page-shell rookie-page">
      <section className="rookie-hero panel">
        <div>
          <span className="eyebrow accent-eyebrow">Private rookie research · {bundle.version}</span>
          <h1>Production evidence,<br />not a trade promise.</h1>
          <p>This board ranks expected {bundle.target.meaning}. Use it to prioritize film and acquisition-price checks, especially after rookie market rank 24.</p>
        </div>
        <div className="rookie-hero-statuses">
          <div className="rookie-status"><ShieldCheck size={20} /><span><strong>Validated production evidence</strong><small>Generated {generated}</small></span></div>
          <div className={`rookie-status ${bundle.currentMarket?.status === 'live' ? '' : 'unavailable'}`}><BarChart3 size={20} /><span><strong>{bundle.currentMarket?.status === 'live' ? 'Current rookie market live' : 'Current rookie market unavailable'}</strong><small>{currentMarketGenerated ? `Generated ${currentMarketGenerated}` : 'No stale price substituted'}</small></span></div>
          <div className="rookie-status warning"><AlertTriangle size={20} /><span><strong>Market-return forecast disabled</strong><small>No resale-profit or trade-grade claims</small></span></div>
        </div>
      </section>

      <div className="league-context-note panel"><span><strong>{leagueContext.label} rookie lens</strong> · {leagueContext.roster.rookieDraftRounds}-round draft, {leagueContext.roster.taxiSlots} taxi spots</span><small>The rookie model stays a position-relative generic-PPR production forecast. It is not falsely rescaled to exact TEP; current acquisition prices use the broad {leagueContext.labels.market}.</small></div>

      <section className="rookie-metric-grid" aria-label="Rookie model evidence summary">
        <article className="rookie-metric panel"><span>Current market coverage</span><strong>{bundle.currentMarket?.coverage ? `${bundle.currentMarket.coverage.returned}/${bundle.currentMarket.coverage.expected}` : '—'}</strong><small>{bundle.currentMarket?.coverage?.complete ? 'complete format-matched rookie catalog' : 'current ranks unavailable'}</small></article>
        <article className="rookie-metric panel"><span>Validated sleeper basket</span><strong>{basketCount}</strong><small>highest forecasts after market rank 24</small></article>
        <article className="rookie-metric panel"><span>Rolling class wins</span><strong>{bundle.validation.classWins}/{bundle.validation.eligibleClasses}</strong><small>against the strongest simple comparator</small></article>
        <article className="rookie-metric panel"><span>Mean basket lift</span><strong>{signedPercent(bundle.validation.meanBasketLift)}</strong><small>minimum class lift {signedPercent(bundle.validation.minimumClassLift)}</small></article>
        <article className="rookie-metric panel"><span>Rank correlation</span><strong>{bundle.validation.fullModelSpearman.toFixed(3)}</strong><small>market-only {bundle.validation.marketOnlySpearman.toFixed(3)}</small></article>
        <article className="rookie-metric panel"><span>Current college coverage</span><strong>{percent(bundle.trainingEvidence.currentCollegeCoverage)}</strong><small>{bundle.trainingEvidence.examples.toLocaleString()} examples · {bundle.trainingEvidence.classes.length} classes</small></article>
      </section>

      <section className="rookie-controls panel" aria-label="Rookie board controls">
        <div className="rookie-scope-toggle">
          <button type="button" className={basketOnly ? 'active' : ''} aria-pressed={basketOnly} onClick={() => setBasketOnly(true)}>Sleeper basket</button>
          <button type="button" className={!basketOnly ? 'active' : ''} aria-pressed={!basketOnly} onClick={() => setBasketOnly(false)}>Full board</button>
        </div>
        <div className="rookie-position-filter" aria-label="Position filter">
          {positions.map((item) => <button type="button" key={item} className={position === item ? 'active' : ''} aria-pressed={position === item} onClick={() => setPosition(item)}>{item === 'ALL' ? 'All' : item}</button>)}
        </div>
        <label className="rookie-sort">Sort by<select value={sort} onChange={(event) => setSort(event.target.value as RookieBoardSort)}><option value="current">Current rookie market</option><option value="board">Production model</option><option value="market">Model anchor market</option><option value="production">Production percentile</option><option value="adjustment">Evidence adjustment</option></select></label>
        <span className="rookie-result-count">{players.length} rookies</span>
      </section>

      <section className="rookie-board-layout">
        <article className="panel rookie-table-card">
          <div className="panel-heading"><div><span className="eyebrow">Current rookie class</span><h2>{basketOnly ? 'Validated sleeper basket' : 'Full production board'}</h2></div><span className="method-note">Today’s market stays separate from the August model anchor</span></div>
          <div className="table-scroll">
            <table className="rookie-table">
              <thead><tr><th>Model</th><th>Prospect</th><th>Current market</th><th>Expected production</th><th>Evidence adjustment</th></tr></thead>
              <tbody>
                {players.map((player) => {
                  const key = rookiePlayerKey(player)
                  const missing = !player.evidence.collegeDataPresent || !player.evidence.combineDataPresent
                  const draftPick = player.sleeperId ? draftPickByPlayer.get(player.sleeperId) : undefined
                  const draftOwner = draftPick ? handleByUserId.get(draftPick.picked_by) : undefined
                  const currentTeam = player.currentMarket?.team ?? draftPick?.metadata?.team ?? player.nflTeam ?? 'FA'
                  const injury = draftPick?.metadata?.injury_status
                  return (
                    <tr key={key} className={selected && rookiePlayerKey(selected) === key ? 'selected' : ''}>
                      <td>{player.draftBoardRank === null ? '—' : `#${player.draftBoardRank}`}</td>
                      <td><button type="button" className="rookie-player-trigger" onClick={() => setSelectedKey(key)}><AssetBadge position={player.position} /><span><strong>{player.name}</strong><small>{currentTeam}{injury ? ` · ${injury}` : ''}{draftPick ? ` · BC ${draftPick.round}.${String(draftPick.draft_slot).padStart(2, '0')} ${draftOwner ?? ''}` : ''}{player.draftBoardRank === null ? ' · current market only' : missing ? ' · evidence missing' : ''}</small></span>{player.inValidatedSleeperBasket && <b>Validated sleeper</b>}<ChevronRight size={15} /></button></td>
                      <td>{player.currentMarket ? <><strong>#{player.currentMarket.rank}</strong><small className="rookie-market-value">{Math.round(player.currentMarket.value).toLocaleString()}</small></> : <span className="rookie-unpriced">Unpriced</span>}</td>
                      <td>{player.expectedRookieProductionPercentile === null ? 'Unavailable' : percent(player.expectedRookieProductionPercentile)}</td>
                      <td className={player.evidenceAdjustment === null ? '' : player.evidenceAdjustment >= 0 ? 'positive' : 'negative'}>{player.evidenceAdjustment === null ? 'Unavailable' : signedPercent(player.evidenceAdjustment)}</td>
                    </tr>
                  )
                })}
                {!players.length && <tr><td colSpan={5} className="rookie-empty">No rookies match these filters.</td></tr>}
              </tbody>
            </table>
          </div>
        </article>

        <aside className="panel rookie-detail">
          {selected ? (
            <>
              <div className="rookie-detail-hero"><div><AssetBadge position={selected.position} /><span className="eyebrow">{selected.draftBoardRank === null ? 'Current market only' : `Model #${selected.draftBoardRank}`} · current market {selected.currentMarket ? `#${selected.currentMarket.rank}` : 'unpriced'}</span></div><h2>{selected.name}</h2><p>{selected.currentMarket?.team ?? selected.nflTeam ?? 'NFL team unavailable'} · {selected.college ?? 'College unavailable'}</p>{selected.inValidatedSleeperBasket && <span className="rookie-sleeper-badge"><Check size={14} /> Validated sleeper basket</span>}</div>
              <div className="rookie-forecast-grid"><div><small>Current market value</small><strong>{selected.currentMarket ? Math.round(selected.currentMarket.value).toLocaleString() : 'Unpriced'}</strong></div><div><small>Model anchor market</small><strong>{selected.rookieMarketRank === null ? 'Unavailable' : `#${selected.rookieMarketRank}`}</strong></div><div><small>Expected rookie production</small><strong>{selected.expectedRookieProductionPercentile === null ? 'Unavailable' : percent(selected.expectedRookieProductionPercentile)}</strong></div><div><small>Market-only expectation</small><strong>{selected.marketOnlyExpectedProductionPercentile === null ? 'Unavailable' : percent(selected.marketOnlyExpectedProductionPercentile)}</strong></div><div><small>Evidence adjustment</small><strong className={selected.evidenceAdjustment === null ? '' : selected.evidenceAdjustment >= 0 ? 'positive' : 'negative'}>{selected.evidenceAdjustment === null ? 'Unavailable' : signedPercent(selected.evidenceAdjustment)}</strong></div><div><small>Model disagreement</small><strong>{selected.modelDisagreement === null ? 'Unavailable' : percent(selected.modelDisagreement)}</strong></div></div>
              {selected.historicalResidualBand80 ? <div className="rookie-uncertainty"><span className="eyebrow">Historical residual band</span><strong>{percent(selected.historicalResidualBand80.lower)}–{percent(selected.historicalResidualBand80.upper)}</strong><p>{selected.historicalResidualBand80.meaning}</p></div> : <div className="rookie-uncertainty"><span className="eyebrow">Production model</span><strong>Unavailable</strong><p>This player is present in the current market but was not linked to the validated projection artifact. No forecast was invented.</p></div>}
              <div className="rookie-evidence-list"><div><small>NFL draft capital</small><strong>{selected.evidence.nflDraftOverall === null ? 'Unavailable' : `Pick ${selected.evidence.nflDraftOverall}`}</strong></div><div><small>College seasons</small><strong>{selected.evidence.collegeSeasonsObserved || 'Unavailable'}</strong></div><div><small>Final scrimmage share</small><strong>{optionalPercent(selected.evidence.finalCollegeScrimmageShare)}</strong></div><div><small>Peak scrimmage share</small><strong>{optionalPercent(selected.evidence.maxCollegeScrimmageShare)}</strong></div><div><small>Final target share</small><strong>{optionalPercent(selected.evidence.finalCollegeTargetShare)}</strong></div><div><small>40-yard dash</small><strong>{selected.evidence.forty === null ? 'Unavailable' : `${selected.evidence.forty.toFixed(2)}s`}</strong></div></div>
              <div className="rookie-data-status"><span className={selected.evidence.collegeDataPresent ? 'present' : 'missing'}>{selected.evidence.collegeDataPresent ? <Check size={13} /> : <AlertTriangle size={13} />} College data {selected.evidence.collegeDataPresent ? 'present' : 'missing'}</span><span className={selected.evidence.combineDataPresent ? 'present' : 'missing'}>{selected.evidence.combineDataPresent ? <Check size={13} /> : <AlertTriangle size={13} />} Combine data {selected.evidence.combineDataPresent ? 'present' : 'missing'}</span></div>
              <div className="rookie-detail-caveat"><Info size={15} /><span>Feature contribution can explain model movement, but it is not causal proof about the player.</span></div>
            </>
          ) : <div className="rookie-empty-detail">Choose a broader filter to inspect player evidence.</div>}
        </aside>
      </section>

      <section className="panel rookie-draft-review">
        <div className="panel-heading"><div><span className="eyebrow">Completed Sleeper draft</span><h2>{leagueContext.label} draft review</h2></div><span className="method-note">Current market-cap haul, not a hidden letter grade</span></div>
        <div className="rookie-draft-method"><Info size={16} /><span><strong>Method.</strong> {draftReview.method} Roster need and current-season power do not change these market-accounting ranks.</span></div>
        {draftReview.status === 'complete' ? (
          <div className="table-scroll">
            <table className="rookie-draft-table">
              <thead><tr><th>Rank</th><th>Manager and haul</th><th>Market acquired</th><th>Expected at slots</th><th>Market surplus</th><th>Value added</th><th>Capital efficiency</th><th>Advisory production</th><th>Best value</th></tr></thead>
              <tbody>{draftReview.managers.map((manager) => (
                <tr key={manager.userId} className={manager.rosterId === myRosterId ? 'is-user' : ''}>
                  <td>#{manager.rank}</td>
                  <td><strong>{manager.handle}</strong><small>{manager.picks.length ? manager.picks.map((pick) => `${pick.label} ${pick.name}`).join(' · ') : 'No selections'}</small></td>
                  <td>{manager.currentMarketValue.toLocaleString()}<small>{manager.marketCoverage.priced}/{manager.marketCoverage.total} priced</small></td>
                  <td>{manager.expectedSlotValue.toLocaleString()}</td>
                  <td className={manager.marketSurplus >= 0 ? 'positive' : 'negative'}>{signedValue(manager.marketSurplus)}<small>{manager.marketEfficiency === null ? '—' : signedPercent(manager.marketEfficiency)}</small></td>
                  <td>{manager.valueAddedRank ? `#${manager.valueAddedRank}` : '—'}</td>
                  <td>{manager.capitalEfficiencyRank ? `#${manager.capitalEfficiencyRank}` : '—'}</td>
                  <td>{manager.averageExpectedProductionPercentile === null ? 'Unavailable' : percent(manager.averageExpectedProductionPercentile)}</td>
                  <td>{manager.bestValuePick ? <><strong>{manager.bestValuePick.label} {manager.bestValuePick.name}</strong><small>{manager.bestValuePick.marketSurplus === null ? 'Unpriced' : signedValue(manager.bestValuePick.marketSurplus)}</small></> : '—'}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <div className="rookie-draft-unavailable"><AlertTriangle size={18} /><span>The draft ranking requires a completed Sleeper draft and a complete current rookie market. No partial ranking is shown.</span></div>}
      </section>

      <section className="panel rookie-validation">
        <div className="panel-heading"><div><span className="eyebrow">Rolling backtest</span><h2>What earned the validated label</h2></div><span className="method-note">Every eligible held-out class is shown</span></div>
        <div className="rookie-validation-body">
          <div className="table-scroll"><table className="rookie-validation-table"><thead><tr><th>Class</th><th>Model basket</th><th>Strongest simple comparator</th><th>Lift</th></tr></thead><tbody>{bundle.validation.classResults.map((result) => <tr key={result.rookieYear}><td>{result.rookieYear}</td><td>{percent(result.modelBasketMeanPercentile)}</td><td>{result.strongestSimpleBaseline} · {percent(result.strongestSimpleBaselineMeanPercentile)}</td><td className={result.lift >= 0 ? 'positive' : 'negative'}>{signedPercent(result.lift)}</td></tr>)}</tbody></table></div>
          <div className="rookie-validation-notes">
            <div><span className="eyebrow">Audit summary</span><p>Exact one-sided sign-test p-value: <strong>{bundle.validation.signTestPValue.toFixed(5)}</strong>. Full-model MAE is <strong>{bundle.validation.fullModelMae.toFixed(4)}</strong> versus <strong>{bundle.validation.marketOnlyMae.toFixed(4)}</strong> for market-only evidence.</p><p>College and athletic evidence adds {signedPercent(bundle.validation.meanLiftOverLearnedCapitalModel)} mean basket lift over the learned market-plus-capital model, but wins only {bundle.validation.learnedCapitalModelClassWins} of {bundle.validation.eligibleClasses} individual classes. Its incremental contribution remains mixed.</p></div>
            <div><span className="eyebrow">Active blockers</span><ul>{bundle.promotionBlockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul></div>
          </div>
        </div>
      </section>

      <section className="rookie-boundary panel"><Info size={17} /><div><strong>Research boundary</strong><ul>{bundle.decisionBoundary.map((boundary) => <li key={boundary}>{boundary}</li>)}</ul></div></section>
    </main>
  )
}
