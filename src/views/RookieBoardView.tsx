import { AlertTriangle, Check, ChevronRight, Info, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { AssetBadge } from '../components/domain-ui'
import {
  rookiePlayerKey,
  selectRookieBoardPlayers,
  type RookieBoardBundle,
  type RookieBoardSort,
  type RookiePosition,
} from '../rookies'

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

export function RookieBoardView({ bundle }: { bundle: RookieBoardBundle | null }) {
  const [basketOnly, setBasketOnly] = useState(true)
  const [position, setPosition] = useState<RookiePosition | 'ALL'>('ALL')
  const [sort, setSort] = useState<RookieBoardSort>('board')
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
  const generated = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(bundle.generatedAt))

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
          <div className="rookie-status warning"><AlertTriangle size={20} /><span><strong>Market-return forecast disabled</strong><small>No resale-profit or trade-grade claims</small></span></div>
        </div>
      </section>

      <section className="rookie-metric-grid" aria-label="Rookie model evidence summary">
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
        <label className="rookie-sort">Sort by<select value={sort} onChange={(event) => setSort(event.target.value as RookieBoardSort)}><option value="board">Model board</option><option value="market">Rookie market</option><option value="production">Production percentile</option><option value="adjustment">Evidence adjustment</option></select></label>
        <span className="rookie-result-count">{players.length} rookies</span>
      </section>

      <section className="rookie-board-layout">
        <article className="panel rookie-table-card">
          <div className="panel-heading"><div><span className="eyebrow">Current rookie class</span><h2>{basketOnly ? 'Validated sleeper basket' : 'Full production board'}</h2></div><span className="method-note">Market rank shown beside model rank</span></div>
          <div className="table-scroll">
            <table className="rookie-table">
              <thead><tr><th>Model</th><th>Prospect</th><th>Market</th><th>Expected production</th><th>Evidence adjustment</th></tr></thead>
              <tbody>
                {players.map((player) => {
                  const key = rookiePlayerKey(player)
                  const missing = !player.evidence.collegeDataPresent || !player.evidence.combineDataPresent
                  return (
                    <tr key={key} className={selected && rookiePlayerKey(selected) === key ? 'selected' : ''}>
                      <td>#{player.draftBoardRank}</td>
                      <td><button type="button" className="rookie-player-trigger" onClick={() => setSelectedKey(key)}><AssetBadge position={player.position} /><span><strong>{player.name}</strong><small>{player.nflTeam ?? 'FA'} · {player.college ?? 'College unavailable'}{missing ? ' · evidence missing' : ''}</small></span>{player.inValidatedSleeperBasket && <b>Validated sleeper</b>}<ChevronRight size={15} /></button></td>
                      <td>#{player.rookieMarketRank}</td>
                      <td>{percent(player.expectedRookieProductionPercentile)}</td>
                      <td className={player.evidenceAdjustment >= 0 ? 'positive' : 'negative'}>{signedPercent(player.evidenceAdjustment)}</td>
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
              <div className="rookie-detail-hero"><div><AssetBadge position={selected.position} /><span className="eyebrow">Model #{selected.draftBoardRank} · market #{selected.rookieMarketRank}</span></div><h2>{selected.name}</h2><p>{selected.nflTeam ?? 'NFL team unavailable'} · {selected.college ?? 'College unavailable'}</p>{selected.inValidatedSleeperBasket && <span className="rookie-sleeper-badge"><Check size={14} /> Validated sleeper basket</span>}</div>
              <div className="rookie-forecast-grid"><div><small>Expected rookie production</small><strong>{percent(selected.expectedRookieProductionPercentile)}</strong></div><div><small>Market-only expectation</small><strong>{percent(selected.marketOnlyExpectedProductionPercentile)}</strong></div><div><small>Evidence adjustment</small><strong className={selected.evidenceAdjustment >= 0 ? 'positive' : 'negative'}>{signedPercent(selected.evidenceAdjustment)}</strong></div><div><small>Model disagreement</small><strong>{percent(selected.modelDisagreement)}</strong></div></div>
              <div className="rookie-uncertainty"><span className="eyebrow">Historical residual band</span><strong>{percent(selected.historicalResidualBand80.lower)}–{percent(selected.historicalResidualBand80.upper)}</strong><p>{selected.historicalResidualBand80.meaning}</p></div>
              <div className="rookie-evidence-list"><div><small>NFL draft capital</small><strong>{selected.evidence.nflDraftOverall === null ? 'Unavailable' : `Pick ${selected.evidence.nflDraftOverall}`}</strong></div><div><small>College seasons</small><strong>{selected.evidence.collegeSeasonsObserved || 'Unavailable'}</strong></div><div><small>Final scrimmage share</small><strong>{optionalPercent(selected.evidence.finalCollegeScrimmageShare)}</strong></div><div><small>Peak scrimmage share</small><strong>{optionalPercent(selected.evidence.maxCollegeScrimmageShare)}</strong></div><div><small>Final target share</small><strong>{optionalPercent(selected.evidence.finalCollegeTargetShare)}</strong></div><div><small>40-yard dash</small><strong>{selected.evidence.forty === null ? 'Unavailable' : `${selected.evidence.forty.toFixed(2)}s`}</strong></div></div>
              <div className="rookie-data-status"><span className={selected.evidence.collegeDataPresent ? 'present' : 'missing'}>{selected.evidence.collegeDataPresent ? <Check size={13} /> : <AlertTriangle size={13} />} College data {selected.evidence.collegeDataPresent ? 'present' : 'missing'}</span><span className={selected.evidence.combineDataPresent ? 'present' : 'missing'}>{selected.evidence.combineDataPresent ? <Check size={13} /> : <AlertTriangle size={13} />} Combine data {selected.evidence.combineDataPresent ? 'present' : 'missing'}</span></div>
              <div className="rookie-detail-caveat"><Info size={15} /><span>Feature contribution can explain model movement, but it is not causal proof about the player.</span></div>
            </>
          ) : <div className="rookie-empty-detail">Choose a broader filter to inspect player evidence.</div>}
        </aside>
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
