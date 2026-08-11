import { ChevronRight, Info, Radar } from 'lucide-react'
import { useMemo, useState } from 'react'
import { selectMarketDislocations } from '../dislocations'
import type { DislocationCategory, DislocationLens, MarketDislocation } from '../dislocations'
import { AssetBadge, formatValue } from '../components/domain-ui'

const LENSES: Array<{ id: DislocationLens; label: string; description: string }> = [
  { id: 'frontier', label: 'Supported frontier', description: 'Non-dominated across the visible, measured facts.' },
  { id: 'market', label: 'Source gaps', description: 'Largest current KTC/FantasyCalc percentage disagreements.' },
  { id: 'production', label: 'Production ahead', description: 'Largest positive production-percentile gap versus market within position.' },
  { id: 'pressure', label: 'Owner pressure', description: 'Bench depth and completed-trade activity, without an acceptance claim.' },
]

const CATEGORY_LABELS: Record<DislocationCategory, string> = {
  'market-gap': 'source gap',
  'production-ahead': 'production ahead',
  'owner-depth': 'owner depth',
  'active-trader': 'active trader',
}

function signedValue(value: number): string {
  return `${value >= 0 ? '+' : ''}${formatValue(value)}`
}

function lineupValue(value: number | null, suffix = 'PPG'): string {
  return value === null ? 'Coverage guarded' : `${value >= 0 ? '+' : ''}${value.toFixed(1)} ${suffix}`
}

export function DislocationBoard({
  candidates,
  onInspect,
}: {
  candidates: MarketDislocation[]
  onInspect: (candidate: MarketDislocation) => void
}) {
  const [lens, setLens] = useState<DislocationLens>('frontier')
  const visible = useMemo(() => selectMarketDislocations(candidates, lens, 10), [candidates, lens])
  const selectedLens = LENSES.find((item) => item.id === lens) ?? LENSES[0]
  const counts = useMemo(() => Object.fromEntries(LENSES.map((item) => [
    item.id,
    selectMarketDislocations(candidates, item.id, 500).length,
  ])) as Record<DislocationLens, number>, [candidates])

  return (
    <section className="market-dislocation-board panel">
      <div className="panel-heading">
        <div><span className="eyebrow">Current-state dislocation desk</span><h2>Where the evidence disagrees</h2></div>
        <span className="method-note">No composite edge score</span>
      </div>
      <div className="dislocation-method"><Info size={16} /><span>Player-only scan across current league rosters. Production gaps compare market and modeled-production percentiles within the same position and covered population; owner pressure uses current roster construction and completed Sleeper trades. A row is a research lead, not a predicted profit or acceptance.</span></div>
      <div className="dislocation-toolbar">
        <div className="intel-tabs" role="group" aria-label="Dislocation lens">
          {LENSES.map((item) => <button type="button" className={lens === item.id ? 'active' : ''} key={item.id} onClick={() => setLens(item.id)}>{item.label} <b>{counts[item.id]}</b></button>)}
        </div>
        <span>{selectedLens.description}</span>
      </div>
      <div className="dislocation-list">
        {visible.length ? visible.map((candidate) => (
          <article key={candidate.key}>
            <header className="dislocation-player">
              <AssetBadge position={candidate.asset.position} />
              <span><strong>{candidate.asset.name}</strong><small>{candidate.owner.teamName} · {formatValue(candidate.asset.value)} composite</small></span>
              <div className="dislocation-tags">
                {candidate.frontier && <i className="frontier">Pareto</i>}
                {candidate.categories.map((category) => <i key={category}>{CATEGORY_LABELS[category]}</i>)}
              </div>
            </header>
            <div className="dislocation-facts">
              <section>
                <small>Current source disagreement</small>
                <strong>{candidate.market.spreadPercent === null
                  ? 'Source pair unavailable'
                  : `${(candidate.market.spreadPercent * 100).toFixed(1)}% spread${candidate.market.higherSource === 'equal' ? '' : ` · ${candidate.market.higherSource} higher`}`}</strong>
                <span>{candidate.market.ktc === null ? 'KTC —' : `KTC ${formatValue(candidate.market.ktc)}`} · {candidate.market.fantasycalc === null ? 'FC —' : `FC ${formatValue(candidate.market.fantasycalc)}`}</span>
              </section>
              <section>
                <small>Production versus market</small>
                <strong>{candidate.production.percentileGap === null
                  ? 'Comparison unavailable'
                  : `${candidate.production.percentileGap >= 0 ? '+' : ''}${candidate.production.percentileGap.toFixed(0)} percentile points`}</strong>
                <span>{candidate.production.productionRank === null ? 'Production uncovered' : `${candidate.production.projectedPpg?.toFixed(1)} PPG · production ${candidate.production.productionRank}/${candidate.production.productionPopulation}`} · market {candidate.production.marketRank}/{candidate.production.marketPopulation}</span>
              </section>
              <section>
                <small>Owner pressure</small>
                <strong>{candidate.pressure.ownerLikelyStarter ? 'Likely lineup asset' : 'Outside likely lineup'}</strong>
                <span>{candidate.pressure.ownerPositionCount} {candidate.asset.position}s · {candidate.pressure.dedicatedSlots} dedicated slot{candidate.pressure.dedicatedSlots === 1 ? '' : 's'} · {candidate.pressure.recentTrades} recent trade{candidate.pressure.recentTrades === 1 ? '' : 's'}</span>
                <span>{candidate.pressure.directionLabel} · {candidate.pressure.directionManual ? 'manual manager label' : 'neutral context'}</span>
                {(candidate.pressure.playerValueFlow !== 0 || candidate.pressure.pickValueFlow !== 0) && <span>Current-value flow: players {signedValue(candidate.pressure.playerValueFlow)} · picks {signedValue(candidate.pressure.pickValueFlow)}</span>}
              </section>
              <section>
                <small>Your declared window</small>
                <strong>{candidate.horizon.ageAtHorizon === null ? 'Age unavailable' : `Age ${candidate.horizon.ageAtHorizon.toFixed(1)} in ${candidate.horizon.years} years`}</strong>
                <span>Your lineup {lineupValue(candidate.pressure.myLineupDelta)} · owner loss {candidate.pressure.ownerLineupLoss === null ? 'coverage guarded' : `${candidate.pressure.ownerLineupLoss.toFixed(1)} PPG`}</span>
              </section>
            </div>
            <button type="button" onClick={() => onInspect(candidate)}>Inspect packages <ChevronRight size={14} /></button>
          </article>
        )) : <div className="intel-empty"><Radar size={22} /><strong>No player meets this lens.</strong><span>The current league data does not support a candidate here; nothing is filled in by a heuristic score.</span></div>}
      </div>
      <div className="model-caveat"><Info size={17} /><span>“Supported frontier” means no other measured candidate is at least as favorable on every displayed objective and better on one. Missing source or lineup evidence is treated as missing—not estimated.</span></div>
    </section>
  )
}
