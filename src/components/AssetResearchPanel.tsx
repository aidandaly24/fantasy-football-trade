import { AlertTriangle, Check, Clock3, Info, TrendingDown, TrendingUp } from 'lucide-react'
import { assetReturnEvidence, buildAssetReturnIndex } from '../asset-returns'
import type { AssetReturnHealthBundle } from '../asset-returns'
import type { Asset } from '../types'

function percent(value: number | null | undefined): string {
  if (value === null || value === undefined) return 'Unavailable'
  return `${value > 0 ? '+' : ''}${(value * 100).toFixed(1)}%`
}

function number(value: number | null | undefined, digits = 1): string {
  return value === null || value === undefined ? 'Unavailable' : value.toFixed(digits)
}

export function AssetResearchPanel({
  asset,
  bundle,
  numQbs,
  horizonYears,
  compact = false,
}: {
  asset: Asset
  bundle: AssetReturnHealthBundle | null
  numQbs: 1 | 2
  horizonYears: number
  compact?: boolean
}) {
  const evidence = assetReturnEvidence(asset, buildAssetReturnIndex(bundle, numQbs))
  const health = bundle?.models.find((model) => model.format === `${numQbs}qb` && model.horizonDays === 30)
  const forecast = evidence?.horizons['30']
  const promoted = Boolean(health?.enabled && forecast?.enabled && forecast.expectedReturn !== undefined)
  const ageAtHorizon = asset.kind === 'player' && asset.age !== null ? asset.age + horizonYears : null

  if (!bundle || !evidence) {
    return (
      <section className={`asset-research ${compact ? 'compact' : ''}`}>
        <div className="asset-research-heading"><span><AlertTriangle size={16} /> Return tape unavailable</span><small>No matching {numQbs === 2 ? 'superflex' : '1QB'} FantasyCalc history</small></div>
        <p>This asset contributes no assumed return, risk, or liquidity value. The optimizer exposes the missing coverage instead of filling it with zero.</p>
      </section>
    )
  }

  return (
    <section className={`asset-research ${compact ? 'compact' : ''}`}>
      <div className="asset-research-heading">
        <span>{promoted ? <Check size={16} /> : <AlertTriangle size={16} />} {promoted ? '30-day return model promoted' : 'Return forecast blocked'}</span>
        <small>FantasyCalc tape as of {bundle.dataAsOf}</small>
      </div>
      <div className="asset-research-grid">
        <article><small>Expected 30-day return</small><strong className={(forecast?.expectedReturn ?? 0) >= 0 ? 'positive' : 'negative'}>{promoted ? percent(forecast?.expectedReturn) : 'Unavailable'}</strong><span>{promoted ? `Tracked interval ${percent(forecast?.trackedAssetLower)} to ${percent(forecast?.trackedAssetUpper)}` : 'A disabled horizon never enters a trade decision.'}</span></article>
        <article><small>Observed path</small><strong>{percent(evidence.risk.observed30dReturn)}</strong><span>90 days {percent(evidence.risk.observed90dReturn)}</span></article>
        <article><small>Drawdown / volatility</small><strong><TrendingDown size={14} /> {percent(evidence.risk.maxDrawdown180d)}</strong><span>30-day monthly volatility {percent(evidence.risk.monthlyVolatility30d)}</span></article>
        <article><small>Liquidity proxy</small><strong>{number(evidence.tradeFrequency)} trades/day</strong><span>Provider variance {percent(evidence.consensusVariancePercent === null ? null : evidence.consensusVariancePercent / 100)}</span></article>
        <article><small>Your holding window</small><strong><Clock3 size={14} /> Reassess in 30 days</strong><span>{ageAtHorizon === null ? 'Draft capital has no player-age decay.' : `Age ${ageAtHorizon.toFixed(1)} at your ${horizonYears}-year horizon.`}</span></article>
        <article><small>Exit discipline</small><strong><TrendingUp size={14} /> No validated sell trigger</strong><span>{ageAtHorizon !== null && ageAtHorizon >= 29 ? 'Rebuild warning: require a named near-term buyer or catalyst before acquiring this aging asset.' : 'Record the thesis and reassess after the validated 30-day window; do not extrapolate it to three years.'}</span></article>
      </div>
      <div className="asset-research-note"><Info size={15} /><span>Current trade price stays on the Tradyr composite scale. Return, interval, drawdown, and liquidity facts stay on the attributed FantasyCalc scale. 90/180/365-day forecasts remain disabled.</span></div>
    </section>
  )
}
