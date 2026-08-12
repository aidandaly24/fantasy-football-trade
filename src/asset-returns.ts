import type { Asset, Team } from './types'

export type AssetReturnStatus = 'needs-data' | 'shadow' | 'validated'

export type AssetReturnGate = {
  id: string
  label: string
  passed: boolean
  actual: number
  requirement: string
}

export type AssetReturnCohort = {
  position: string
  ageBand: string
  rows: number
  assets: number
  medianReturn: number
  p10Return: number
  p90Return: number
}

export type AssetReturnModelHealth = {
  format: '1qb' | '2qb'
  horizonDays: 30 | 90 | 180 | 365
  target: string
  status: AssetReturnStatus
  enabled: boolean
  rows: number
  assets: number
  anchorDates: number
  trainingRows: number
  testRows: number
  heldoutAssets: number
  trainSpanDays: number
  baselineName: string
  baseline: { mae: number; rmse: number; rankCorrelation: number }
  modelMetrics: { mae: number; rmse: number; rankCorrelation: number }
  maeImprovement: number
  crossSectionRankCorrelation: number
  interval: { targetCoverage: number; heldoutCoverage: number; meanWidth: number }
  selectedModel: string
  cohorts: AssetReturnCohort[]
  gates: AssetReturnGate[]
}

export type AssetReturnHorizon = {
  status: AssetReturnStatus
  enabled: boolean
  expectedReturn?: number
  trackedAssetLower?: number
  trackedAssetUpper?: number
}

export type AssetReturnAsset = {
  fantasyCalcId: number
  sleeperId: string | null
  name: string
  position: string
  format: '1qb' | '2qb'
  currentValue: number
  overallRank: number | null
  age: number | null
  tradeFrequency: number | null
  consensusVariancePercent: number | null
  risk: {
    observed30dReturn: number | null
    observed90dReturn: number | null
    monthlyVolatility30d: number
    maxDrawdown90d: number
    maxDrawdown180d: number
    observations180d: number
  }
  horizons: Record<'30' | '90' | '180' | '365', AssetReturnHorizon>
}

export type AssetReturnHealthBundle = {
  schemaVersion: 1
  generatedAt: string
  dataAsOf: string
  source: {
    name: string
    methodology: string
    terms: string
    attribution: string
    predictionBoundary: string
  }
  sourceAudit: {
    datasetId: string
    currentCatalogAssets: number
    historyAssets: number
    tradeObservedAssetsOutsideCurrentCatalog: number
    populationBoundary: string
    survivorWarning: string
    formats: Array<{
      format: '1qb' | '2qb'
      series: number
      currentCatalogCoverage: number
      medianSpanDays: number
      medianObservations: number
      medianGapDays: number
    }>
  }
  models: AssetReturnModelHealth[]
  assets: Record<string, AssetReturnAsset>
}

export type PortfolioEvidence = {
  currentValue: number
  assetCount: number
  pickValue: number
  pickValueShare: number | null
  concentrationHhi: number | null
  valueWeightedAgeAtHorizon: number | null
  ageCoverage: number
  returnSourceValue: number
  expectedPnl30: number | null
  trackedAssetLowerPnl30: number | null
  trackedAssetUpperPnl30: number | null
  returnCoverage: number
  observedReturn30: number | null
  observedReturn90: number | null
  maxDrawdown180: number | null
  historicalRiskCoverage: number
  tradeFrequency: number | null
  liquidityCoverage: number
  cohortMedianReturn30: number | null
  cohortCoverage: number
}

export type PortfolioTradeDelta = {
  before: PortfolioEvidence
  after: PortfolioEvidence
  currentValue: number
  pickValue: number
  pickValueShare: number | null
  concentrationHhi: number | null
  valueWeightedAgeAtHorizon: number | null
  expectedPnl30: number | null
  trackedAssetLowerPnl30: number | null
  trackedAssetUpperPnl30: number | null
  observedReturn30: number | null
  observedReturn90: number | null
  maxDrawdown180: number | null
  tradeFrequency: number | null
  cohortMedianReturn30: number | null
  returnCoverage: number
  historicalRiskCoverage: number
  notes: string[]
}

function ordinal(round: number): string {
  if (round === 1) return '1st'
  if (round === 2) return '2nd'
  if (round === 3) return '3rd'
  return `${round}th`
}

function pickResearchName(asset: Asset): string | null {
  if (asset.kind !== 'pick' || !asset.year || !asset.round) return null
  if (asset.slot) return `${asset.year} Pick ${asset.round}.${String(asset.slot).padStart(2, '0')}`
  const base = `${asset.year} ${ordinal(asset.round)}`
  if (asset.projectedTier && asset.projectedTier !== 'known') {
    const tier = asset.projectedTier[0].toUpperCase() + asset.projectedTier.slice(1)
    return `${base} (${tier})`
  }
  return base
}

export function buildAssetReturnIndex(
  bundle: AssetReturnHealthBundle | null,
  numQbs: 1 | 2,
): Map<string, AssetReturnAsset> {
  if (!bundle) return new Map()
  const format = `${numQbs}qb`
  const result = new Map<string, AssetReturnAsset>()
  Object.values(bundle.assets).forEach((asset) => {
    if (asset.format !== format) return
    if (asset.sleeperId) result.set(`player:${asset.sleeperId}`, asset)
    result.set(`name:${asset.name.toLowerCase()}`, asset)
  })
  return result
}

export function assetReturnEvidence(
  asset: Asset,
  index: Map<string, AssetReturnAsset>,
): AssetReturnAsset | null {
  if (asset.kind === 'player') return index.get(`player:${asset.id}`) ?? null
  const researchName = pickResearchName(asset)
  if (!researchName) return null
  const exact = index.get(`name:${researchName.toLowerCase()}`)
  if (exact) return exact
  return index.get(`name:${asset.year} ${ordinal(asset.round!)} (${asset.projectedTier === 'early' ? 'Early' : asset.projectedTier === 'late' ? 'Late' : 'Mid'})`.toLowerCase())
    ?? index.get(`name:${asset.year} ${ordinal(asset.round!)}`.toLowerCase())
    ?? null
}

function ageBand(age: number | null): string {
  if (age === null) return 'Pick/no age'
  if (age <= 23) return 'Under 23'
  if (age <= 26) return '23–25'
  if (age <= 29) return '26–28'
  return '29+'
}

function weightedAverage(rows: Array<{ weight: number; value: number | null }>): { value: number | null; coverage: number } {
  const totalWeight = rows.reduce((sum, row) => sum + row.weight, 0)
  const covered = rows.filter((row) => row.value !== null)
  const coveredWeight = covered.reduce((sum, row) => sum + row.weight, 0)
  return {
    value: coveredWeight ? covered.reduce((sum, row) => sum + row.weight * (row.value ?? 0), 0) / coveredWeight : null,
    coverage: totalWeight ? coveredWeight / totalWeight : 1,
  }
}

function coveredPnl(rows: Array<{ weight: number; value: number | null }>): number | null {
  const covered = rows.filter((row) => row.value !== null)
  return covered.length ? covered.reduce((sum, row) => sum + row.weight * (row.value ?? 0), 0) : null
}

export function summarizePortfolio(options: {
  assets: Asset[]
  bundle: AssetReturnHealthBundle | null
  numQbs: 1 | 2
  horizonYears: number
}): PortfolioEvidence {
  const assets = options.assets.filter((asset) => asset.value > 0)
  const currentValue = assets.reduce((sum, asset) => sum + asset.value, 0)
  const pickValue = assets.filter((asset) => asset.kind === 'pick').reduce((sum, asset) => sum + asset.value, 0)
  const index = buildAssetReturnIndex(options.bundle, options.numQbs)
  const model = options.bundle?.models.find((item) => item.format === `${options.numQbs}qb` && item.horizonDays === 30)
  const rows = assets.map((asset) => ({ asset, evidence: assetReturnEvidence(asset, index) }))
  const returnRows = rows.map(({ asset, evidence }) => {
    const horizon = evidence?.horizons['30']
    return {
      coverageWeight: asset.value,
      weight: evidence?.currentValue ?? 0,
      expected: horizon?.enabled ? horizon.expectedReturn ?? null : null,
      lower: horizon?.enabled ? horizon.trackedAssetLower ?? null : null,
      upper: horizon?.enabled ? horizon.trackedAssetUpper ?? null : null,
    }
  })
  const returnCoverageValue = returnRows
    .filter((row) => row.expected !== null)
    .reduce((sum, row) => sum + row.coverageWeight, 0)
  const returnSourceValue = returnRows
    .filter((row) => row.expected !== null)
    .reduce((sum, row) => sum + row.weight, 0)
  const observed30 = weightedAverage(rows.map(({ evidence }) => ({ weight: evidence?.currentValue ?? 0, value: evidence?.risk.observed30dReturn ?? null })))
  const observed90 = weightedAverage(rows.map(({ evidence }) => ({ weight: evidence?.currentValue ?? 0, value: evidence?.risk.observed90dReturn ?? null })))
  const drawdown = weightedAverage(rows.map(({ evidence }) => ({ weight: evidence?.currentValue ?? 0, value: evidence?.risk.maxDrawdown180d ?? null })))
  const tradeFrequency = weightedAverage(rows.map(({ evidence }) => ({ weight: evidence?.currentValue ?? 0, value: evidence?.tradeFrequency ?? null })))
  const historicalRiskCoverageValue = rows
    .filter(({ evidence }) => (evidence?.risk.observations180d ?? 0) > 0)
    .reduce((sum, { asset }) => sum + asset.value, 0)
  const liquidityCoverageValue = rows
    .filter(({ evidence }) => evidence?.tradeFrequency !== null && evidence?.tradeFrequency !== undefined)
    .reduce((sum, { asset }) => sum + asset.value, 0)
  const playerAges = assets
    .filter((asset) => asset.kind === 'player')
    .map((asset) => ({ weight: asset.value, value: asset.age === null ? null : asset.age + options.horizonYears }))
  const age = weightedAverage(playerAges)
  const cohorts = new Map((model?.cohorts ?? []).map((cohort) => [`${cohort.position}:${cohort.ageBand}`, cohort]))
  const cohort = weightedAverage(rows.map(({ asset, evidence }) => {
    const observedAge = asset.kind === 'pick' ? null : evidence?.age ?? asset.age
    const match = cohorts.get(`${asset.position}:${ageBand(observedAge)}`)
    return { weight: asset.value, value: match?.medianReturn ?? null }
  }))
  const concentrationHhi = currentValue
    ? assets.reduce((sum, asset) => sum + (asset.value / currentValue) ** 2, 0)
    : null

  return {
    currentValue,
    assetCount: assets.length,
    pickValue,
    pickValueShare: currentValue ? pickValue / currentValue : null,
    concentrationHhi,
    valueWeightedAgeAtHorizon: age.value,
    ageCoverage: age.coverage,
    returnSourceValue,
    expectedPnl30: coveredPnl(returnRows.map((row) => ({ weight: row.weight, value: row.expected }))),
    trackedAssetLowerPnl30: coveredPnl(returnRows.map((row) => ({ weight: row.weight, value: row.lower }))),
    trackedAssetUpperPnl30: coveredPnl(returnRows.map((row) => ({ weight: row.weight, value: row.upper }))),
    returnCoverage: currentValue ? returnCoverageValue / currentValue : 1,
    observedReturn30: observed30.value,
    observedReturn90: observed90.value,
    maxDrawdown180: drawdown.value,
    historicalRiskCoverage: currentValue ? historicalRiskCoverageValue / currentValue : 1,
    tradeFrequency: tradeFrequency.value,
    liquidityCoverage: currentValue ? liquidityCoverageValue / currentValue : 1,
    cohortMedianReturn30: cohort.value,
    cohortCoverage: cohort.coverage,
  }
}

function nullableDelta(after: number | null, before: number | null): number | null {
  return after === null || before === null ? null : after - before
}

function postTradeAssets(team: Team, outgoing: Asset[], incoming: Asset[]): Asset[] {
  const outgoingIds = new Set(outgoing.map((asset) => asset.id))
  const existing = [...team.players, ...team.picks].filter((asset) => !outgoingIds.has(asset.id))
  const existingIds = new Set(existing.map((asset) => asset.id))
  return [...existing, ...incoming.filter((asset) => !existingIds.has(asset.id))]
}

export function evaluateRebuildPortfolioTrade(options: {
  team: Team
  outgoing: Asset[]
  incoming: Asset[]
  bundle: AssetReturnHealthBundle | null
  numQbs: 1 | 2
  horizonYears: number
}): PortfolioTradeDelta {
  const before = summarizePortfolio({
    assets: [...options.team.players, ...options.team.picks],
    bundle: options.bundle,
    numQbs: options.numQbs,
    horizonYears: options.horizonYears,
  })
  const after = summarizePortfolio({
    assets: postTradeAssets(options.team, options.outgoing, options.incoming),
    bundle: options.bundle,
    numQbs: options.numQbs,
    horizonYears: options.horizonYears,
  })
  const notes = [
    `${Math.round(after.returnCoverage * 100)}% of post-trade value has promoted 30-day return evidence.`,
    `${Math.round(after.historicalRiskCoverage * 100)}% has same-source 180-day drawdown history.`,
    options.bundle?.sourceAudit.survivorWarning ?? 'Asset return history is unavailable.',
  ]
  return {
    before,
    after,
    currentValue: after.currentValue - before.currentValue,
    pickValue: after.pickValue - before.pickValue,
    pickValueShare: nullableDelta(after.pickValueShare, before.pickValueShare),
    concentrationHhi: nullableDelta(after.concentrationHhi, before.concentrationHhi),
    valueWeightedAgeAtHorizon: nullableDelta(after.valueWeightedAgeAtHorizon, before.valueWeightedAgeAtHorizon),
    expectedPnl30: nullableDelta(after.expectedPnl30, before.expectedPnl30),
    trackedAssetLowerPnl30: nullableDelta(after.trackedAssetLowerPnl30, before.trackedAssetLowerPnl30),
    trackedAssetUpperPnl30: nullableDelta(after.trackedAssetUpperPnl30, before.trackedAssetUpperPnl30),
    observedReturn30: nullableDelta(after.observedReturn30, before.observedReturn30),
    observedReturn90: nullableDelta(after.observedReturn90, before.observedReturn90),
    maxDrawdown180: nullableDelta(after.maxDrawdown180, before.maxDrawdown180),
    tradeFrequency: nullableDelta(after.tradeFrequency, before.tradeFrequency),
    cohortMedianReturn30: nullableDelta(after.cohortMedianReturn30, before.cohortMedianReturn30),
    returnCoverage: after.returnCoverage,
    historicalRiskCoverage: after.historicalRiskCoverage,
    notes,
  }
}
