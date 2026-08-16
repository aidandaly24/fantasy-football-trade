import { AlertTriangle, Check, Info } from 'lucide-react'
import { useEffect, useState } from 'react'
import { fetchSportsbookModelHealth } from '../api'
import type { LeagueContext } from '../league-context'
import type { Asset, ModelHealthBundle } from '../types'
import { AssetBadge, signedPercent } from '../components/domain-ui'
import type { TradeModelHealthBundle } from '../trade-models'
import type { AssetReturnHealthBundle } from '../asset-returns'
import type { SportsbookModelHealth } from '../sportsbook'

const baselineLabels: Record<string, string> = {
  repeatPrior: 'Repeat prior season',
  positionMean: 'Position average',
  shrinkToPosition: '75% prior + 25% position',
}
const sliceLabels: Record<string, string> = {
  all: 'All players',
  QB: 'Quarterbacks',
  RB: 'Running backs',
  WR: 'Wide receivers',
  TE: 'Tight ends',
  priorPpgUnder3: 'Under 3 prior PPG',
  priorPpg3to6: '3–6 prior PPG',
  priorPpg6to10: '6–10 prior PPG',
  priorPpgAtLeast10: '10+ prior PPG',
  gamesObserved1to8: '1–8 games observed',
  gamesObserved9to13: '9–13 games observed',
  gamesObserved14plus: '14+ games observed',
}

export function ModelView({ health, tradeHealth, assetReturnHealth, leagueContext }: { health: ModelHealthBundle | null; tradeHealth: TradeModelHealthBundle | null; assetReturnHealth: AssetReturnHealthBundle | null; leagueContext: LeagueContext }) {
  const [sportsbookHealth, setSportsbookHealth] = useState<SportsbookModelHealth | null>(null)
  useEffect(() => {
    let cancelled = false
    void fetchSportsbookModelHealth().then((value) => {
      if (!cancelled) setSportsbookHealth(value)
    })
    return () => { cancelled = true }
  }, [])
  if (!health) {
    return (
      <main className="page-shell model-page">
        <section className="model-hero panel">
          <span className="eyebrow accent-eyebrow">Model audit</span>
          <h1>No trusted model report is available.</h1>
          <p>The calculator is using its transparent market-and-role fallback.</p>
        </section>
      </main>
    )
  }

  const importantSlices = health.slices.filter((slice) => slice.id !== 'all')
  const intervalPositions = Object.entries(health.interval.byPosition)
  const visibleGates = [
    ...health.gates,
    ...(health.phaseGates?.['v1.2']?.checks ?? []),
    ...(health.phaseGates?.['v1.3']?.checks ?? []),
    ...(health.phaseGates?.['v2.1']?.checks ?? []),
  ]

  return (
    <main className="page-shell model-page">
      <section className="model-hero panel">
        <div>
          <span className="eyebrow accent-eyebrow">Model audit · held-out {health.testSeason}</span>
          <h1>Trust is earned<br />one gate at a time.</h1>
          <p>The production forecast is allowed into lineup impact only when every visible test passes. Current market prices remain a separate observed input.</p>
        </div>
        <div className={`model-status ${health.enabled ? 'enabled' : 'disabled'}`}>
          {health.enabled ? <Check size={20} /> : <AlertTriangle size={20} />}
          <span><strong>{health.enabled ? 'Production enabled' : 'Production blocked'}</strong><small>{health.model}</small></span>
        </div>
      </section>

      <div className="league-context-note panel"><span><strong>Active output layer · {leagueContext.label}</strong> · {leagueContext.labels.projection}</span><small>The promotion metrics below audit the generic-PPR base model. The deterministic TE bonus is kept outside training so the same validated forecast can serve both fixed leagues without pretending there are two separately validated models.</small></div>

      {sportsbookHealth && <section className="panel sportsbook-model-audit">
        <div className="panel-heading"><div><span className="eyebrow">Sportsbook challenger · shadow</span><h2>Current lines are visible; model influence is blocked</h2></div><span className="method-note">{sportsbookHealth.rows.toLocaleString()} historical rows · {sportsbookHealth.status}</span></div>
        <div className="sportsbook-model-summary">
          <article><small>Target</small><strong>Weekly PPR lift</strong><span>{sportsbookHealth.target}</span></article>
          <article><small>Prediction anchors</small><strong>{sportsbookHealth.anchors.length}</strong><span>{sportsbookHealth.anchors.join(' · ')}</span></article>
          <article><small>Current influence</small><strong>{sportsbookHealth.enabled ? 'Enabled' : 'Zero weight'}</strong><span>Dynasty price and trade verdict remain unchanged.</span></article>
        </div>
        <div className="sportsbook-gate-grid">{sportsbookHealth.gates.map((gate) => <article className={gate.passed ? 'passed' : 'failed'} key={gate.id}><span>{gate.passed ? <Check size={15} /> : <AlertTriangle size={15} />}</span><div><strong>{gate.label}</strong><small>{gate.requirement}</small></div><b>{gate.actual === null ? 'Unavailable' : String(gate.actual)}</b></article>)}</div>
        <div className="model-note sportsbook-boundary"><Info size={16} /><span>Early-week and pregame lines train as different challengers. Closing information can never leak into an earlier decision timestamp, and no manually chosen weight can bypass these gates.</span></div>
      </section>}

      {assetReturnHealth && <section className="panel asset-return-audit">
        <div className="panel-heading"><div><span className="eyebrow">V7.4 asset return audit</span><h2>Each horizon earns promotion separately</h2></div><span className="method-note">FantasyCalc value history · {assetReturnHealth.dataAsOf}</span></div>
        <div className="asset-return-model-grid">
          {assetReturnHealth.models
            .filter((model) => model.format === `${leagueContext.marketFormat.numQbs}qb`)
            .map((model) => <article key={`${model.format}-${model.horizonDays}`} className={model.enabled ? 'enabled' : 'disabled'}>
              <small>{model.horizonDays}-day return</small>
              <strong>{model.enabled ? 'Promoted' : model.status}</strong>
              <span>{model.rows.toLocaleString()} rows · {model.testRows.toLocaleString()} held-out · {model.heldoutAssets} assets</span>
              <b>{(model.maeImprovement * 100).toFixed(2)}% MAE lift</b>
              <em>Cross-section rank {model.crossSectionRankCorrelation.toFixed(3)} · interval {(model.interval.heldoutCoverage * 100).toFixed(1)}%</em>
            </article>)}
        </div>
        <div className="model-note scenario-note"><Info size={16} /><span>Only an enabled horizon can enter a portfolio comparison. Today that is 30 days; 90/180/365 remain visible for audit and contribute nothing.</span></div>
      </section>}

      <section className="model-metric-grid" aria-label="Held-out model results">
        <article className="model-metric panel"><span>MAE improvement</span><strong>{signedPercent(health.metrics.maeImprovement)}</strong><small>against {baselineLabels[health.metrics.baselineName] ?? health.metrics.baselineName}</small></article>
        <article className="model-metric panel"><span>Model MAE</span><strong>{health.metrics.model.mae.toFixed(2)}</strong><small>baseline {health.metrics.baseline.mae.toFixed(2)}</small></article>
        <article className="model-metric panel"><span>Rank correlation</span><strong>{health.metrics.model.rank_correlation.toFixed(3)}</strong><small>{health.metrics.rankCorrelationDelta >= 0 ? '+' : ''}{health.metrics.rankCorrelationDelta.toFixed(3)} vs baseline</small></article>
        <article className="model-metric panel"><span>20–80 coverage</span><strong>{(health.interval.test.coverage * 100).toFixed(1)}%</strong><small>target {(health.interval.targetCoverage * 100).toFixed(0)}%</small></article>
        <article className="model-metric panel"><span>Current projections</span><strong>{health.currentPlayers}</strong><small>{health.freshness?.stale ? 'snapshot stale · fallback guarded' : `through ${health.freshness?.sourceSeason ?? 'current season'}`}</small></article>
      </section>

      <section className="model-layout">
        <div className="panel model-gates">
          <div className="panel-heading"><div><span className="eyebrow">Promotion gates</span><h2>All must pass</h2></div><span className="method-note">No manual override</span></div>
          <div className="gate-list">
            {visibleGates.map((gate) => (
              <div className={`gate-row ${gate.passed ? 'passed' : 'failed'}`} key={gate.id}>
                <span>{gate.passed ? <Check size={16} /> : <AlertTriangle size={16} />}</span>
                <div><strong>{gate.label}</strong><small>{gate.requirement}</small></div>
                <b>{['mae', 'positions', 'interval', 'contextMae', 'contextRegression', 'rosMae', 'rosPositions', 'eventMae', 'eventOverall', 'eventPositions'].includes(gate.id) ? `${(gate.actual * 100).toFixed(1)}%` : ['contextPositions', 'projectionCoverage', 'eventRows'].includes(gate.id) ? gate.actual.toFixed(0) : ['snapshotFreshness', 'deterministicRefresh'].includes(gate.id) ? (gate.passed ? 'pass' : 'fail') : gate.actual.toFixed(3)}</b>
              </div>
            ))}
          </div>
        </div>

        <div className="panel interval-card">
          <div className="panel-heading"><div><span className="eyebrow">Uncertainty calibration</span><h2>Coverage by position</h2></div></div>
          <div className="interval-list">
            {intervalPositions.map(([position, values]) => (
              <div key={position}><AssetBadge position={position as Asset['position']} /><span><strong>{(values.coverage * 100).toFixed(1)}%</strong><small>{values.rows} held-out players · {values.mean_width.toFixed(1)} PPG wide</small></span></div>
            ))}
          </div>
        </div>
      </section>

      <section className="panel model-table-card">
        <div className="panel-heading"><div><span className="eyebrow">Simple challengers</span><h2>Baseline comparison</h2></div><span className="method-note">Selected on validation, judged later</span></div>
        <div className="table-scroll">
          <table className="model-table">
            <thead><tr><th>Baseline</th><th>Validation MAE</th><th>Held-out MAE</th><th>Held-out rank</th></tr></thead>
            <tbody>
              {health.baselines.map((baseline) => (
                <tr key={baseline.id} className={baseline.selected ? 'selected' : ''}><td>{baselineLabels[baseline.id] ?? baseline.id}{baseline.selected && <small> strongest</small>}</td><td>{baseline.validation.mae.toFixed(2)}</td><td>{baseline.test.mae.toFixed(2)}</td><td>{baseline.test.rank_correlation.toFixed(3)}</td></tr>
              ))}
              <tr className="model-row"><td>Production model</td><td>—</td><td>{health.metrics.model.mae.toFixed(2)}</td><td>{health.metrics.model.rank_correlation.toFixed(3)}</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel model-table-card">
        <div className="panel-heading"><div><span className="eyebrow">Failure map</span><h2>Where the model helps—and where it doesn’t</h2></div><span className="method-note">Positive lift is better</span></div>
        <div className="table-scroll">
          <table className="model-table slice-table">
            <thead><tr><th>Slice</th><th>Players</th><th>Model MAE</th><th>Baseline MAE</th><th>Lift</th></tr></thead>
            <tbody>{importantSlices.map((slice) => (
              <tr key={slice.id}><td>{sliceLabels[slice.id] ?? slice.id}</td><td>{slice.rows}</td><td>{slice.model.mae.toFixed(2)}</td><td>{slice.baseline.mae.toFixed(2)}</td><td className={slice.maeImprovement >= 0 ? 'positive' : 'negative'}>{signedPercent(slice.maeImprovement)}</td></tr>
            ))}</tbody>
          </table>
        </div>
      </section>

      <section className="model-caveat panel"><Info size={17} /><span><strong>What this does not claim:</strong> production MAE improved{health.metrics.rankCorrelationDelta >= 0 ? ` and rank correlation improved by ${health.metrics.rankCorrelationDelta.toFixed(3)}` : ` while rank correlation trails the simple baseline by ${Math.abs(health.metrics.rankCorrelationDelta).toFixed(3)}`}. That is useful held-out evidence, not proof the model is universally smarter.</span></section>

      {tradeHealth && (
        <section className="panel trade-model-audit">
          <div className="panel-heading"><div><span className="eyebrow">Historical trade models</span><h2>Exchange price and future outcome are different targets</h2></div><span className="method-note">Accepted trades only</span></div>
          <div className="trade-model-audit-grid">
            <article><small>Training input</small><strong>{tradeHealth.trainingManifest ? `${tradeHealth.trainingManifest.importedTrades ?? 0} hosted · ${tradeHealth.trainingManifest.localCacheTrades ?? 0} local` : 'Legacy artifact'}</strong><span>{tradeHealth.trainingManifest ? `${tradeHealth.trainingManifest.pointInTimeValuedTrades}/${tradeHealth.trainingManifest.totalTrades} trades have point-in-time price coverage` : 'No content-addressed training manifest is attached.'}</span><b>{tradeHealth.trainingManifest?.datasetId.slice(0, 20) ?? 'Dataset unknown'}{tradeHealth.trainingManifest ? '…' : ''}</b></article>
            <article><small>Exchange premium</small><strong>{tradeHealth.exchange.status}</strong><span>{tradeHealth.exchange.rows} eligible 1-for-2/3 trades · {tradeHealth.exchange.uniqueLeagues} leagues · {tradeHealth.exchange.dateSpanDays} days</span><b>{tradeHealth.exchange.medianPremium === null ? 'No estimate' : `${(tradeHealth.exchange.medianPremium * 100).toFixed(1)}% observed median`}</b></article>
            {tradeHealth.outcomes.map((outcome) => <article key={outcome.horizonDays}><small>{outcome.horizonDays}-day market outcome</small><strong>{outcome.status}</strong><span>{outcome.rows} point-in-time labels · {outcome.testRows} later held-out rows</span><b>{outcome.enabled ? `${(outcome.premiumAware.maeImprovementVsStructure ?? 0) * 100}% premium lift` : 'Not used in Trade Lab'}</b></article>)}
            <article><small>Lineup outcome</small><strong>{tradeHealth.lineupOutcome.status}</strong><span>{tradeHealth.lineupOutcome.reason}</span><b>{tradeHealth.lineupOutcome.rows} valid labels</b></article>
          </div>
          <div className="model-note scenario-note"><Info size={16} /><span>The first tape is real but only {tradeHealth.exchange.dateSpanDays} days deep. Its provisional {(tradeHealth.exchange.maeImprovement * 100).toFixed(1)}% held-out MAE lift is visible for audit and remains blocked until every sample, span, coverage, and performance gate passes.</span></div>
        </section>
      )}
    </main>
  )
}
