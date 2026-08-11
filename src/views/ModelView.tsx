import { AlertTriangle, Check, Info } from 'lucide-react'
import type { LeagueContext } from '../league-context'
import type { Asset, ModelHealthBundle } from '../types'
import { AssetBadge, signedPercent } from '../components/domain-ui'

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

export function ModelView({ health, leagueContext }: { health: ModelHealthBundle | null; leagueContext: LeagueContext }) {
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
    </main>
  )
}
