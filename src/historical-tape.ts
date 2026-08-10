import type { HistoricalTapeAudit, HistoricalTapeGate, MarketTapeAssetInput } from './types'

const DAY_MS = 86_400_000
const AUDIT_TARGET = 50
const POSITION_QUOTAS: Record<string, number> = { QB: 10, RB: 14, WR: 16, TE: 10 }

export type HistoricalAuditCandidate = Pick<
  MarketTapeAssetInput,
  'assetId' | 'assetName' | 'kind' | 'position' | 'currentValue'
>

export type HistoricalPointInput = { date: string; value: number; raw?: number | null }

export type HistoricalSeriesSummary = {
  observations: Array<{ observedAt: string; providerValue: number; rawValue: number | null }>
  observationCount: number
  labelCount: number
  firstObservedAt: string | null
  lastObservedAt: string | null
  spanDays: number
  medianGapDays: number
  scaleStatus: 'compatible' | 'component-like' | 'unknown'
  scaleGap: number | null
}

export type HistoricalAuditAssetResult = {
  status: 'pending' | 'complete' | 'missing' | 'failed'
  observationCount: number
  labelCount: number
  spanDays: number
  medianGapDays: number
  scaleStatus: HistoricalSeriesSummary['scaleStatus']
}

const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value))

function median(values: number[]): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

function relativeGap(a: number | null | undefined, b: number | null | undefined): number | null {
  if (!Number.isFinite(a) || !Number.isFinite(b) || Number(a) <= 0 || Number(b) <= 0) return null
  return Math.abs(Number(a) - Number(b)) / Math.max(1, Number(b))
}

export function normalizeHistoricalDate(value: string): string | null {
  const compact = value.trim()
  const match = compact.match(/^(\d{2})(\d{2})(\d{2})$/)
  if (!match) return null
  const year = 2000 + Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
  return date.toISOString().slice(0, 10)
}

/** Selects a deterministic cross-position, cross-value sample instead of only stars. */
export function selectHistoricalAuditAssets(
  candidates: HistoricalAuditCandidate[],
  limit = AUDIT_TARGET,
): HistoricalAuditCandidate[] {
  const unique = new Map<string, HistoricalAuditCandidate>()
  candidates.forEach((candidate) => {
    if (candidate.kind !== 'player' || !['QB', 'RB', 'WR', 'TE'].includes(candidate.position) || candidate.currentValue <= 0) return
    if (!unique.has(candidate.assetId)) unique.set(candidate.assetId, candidate)
  })
  const selected: HistoricalAuditCandidate[] = []
  const used = new Set<string>()
  Object.entries(POSITION_QUOTAS).forEach(([position, quota]) => {
    const rows = [...unique.values()]
      .filter((candidate) => candidate.position === position)
      .sort((a, b) => b.currentValue - a.currentValue || a.assetId.localeCompare(b.assetId))
    // Alternating high/low values catches both well-covered stars and fringe roster players.
    const ordered: HistoricalAuditCandidate[] = []
    for (let left = 0, right = rows.length - 1; left <= right;) {
      ordered.push(rows[left])
      left += 1
      if (left <= right) {
        ordered.push(rows[right])
        right -= 1
      }
    }
    ordered.slice(0, Math.min(quota, limit - selected.length)).forEach((candidate) => {
      selected.push(candidate)
      used.add(candidate.assetId)
    })
  })
  if (selected.length < limit) {
    [...unique.values()]
      .filter((candidate) => !used.has(candidate.assetId))
      .sort((a, b) => b.currentValue - a.currentValue || a.assetId.localeCompare(b.assetId))
      .slice(0, limit - selected.length)
      .forEach((candidate) => selected.push(candidate))
  }
  return selected.slice(0, limit)
}

function countReturnLabels(observedAt: string[], horizonDays = 30, toleranceDays = 10, spacingDays = 21): number {
  let labels = 0
  let lastAnchor = Number.NEGATIVE_INFINITY
  observedAt.forEach((anchor, index) => {
    const anchorMs = Date.parse(anchor)
    if (anchorMs - lastAnchor < spacingDays * DAY_MS) return
    const found = observedAt.slice(index + 1).some((candidate) => {
      const elapsed = (Date.parse(candidate) - anchorMs) / DAY_MS
      return elapsed >= horizonDays - toleranceDays && elapsed <= horizonDays + toleranceDays
    })
    if (found) {
      labels += 1
      lastAnchor = anchorMs
    }
  })
  return labels
}

export function summarizeHistoricalSeries(input: {
  history: HistoricalPointInput[]
  currentComposite?: number | null
  currentKtc?: number | null
  currentFantasyCalc?: number | null
}): HistoricalSeriesSummary {
  const observations = input.history.flatMap((point) => {
    const observedAt = normalizeHistoricalDate(point.date)
    const providerValue = Number(point.value)
    const rawValue = point.raw == null ? null : Number(point.raw)
    return observedAt && Number.isFinite(providerValue) && providerValue > 0
      ? [{ observedAt, providerValue, rawValue: Number.isFinite(rawValue) && Number(rawValue) > 0 ? rawValue : null }]
      : []
  }).sort((a, b) => a.observedAt.localeCompare(b.observedAt))
  const deduped = [...new Map(observations.map((point) => [point.observedAt, point])).values()]
  const gaps = deduped.slice(1).map((point, index) => (Date.parse(point.observedAt) - Date.parse(deduped[index].observedAt)) / DAY_MS)
  const firstObservedAt = deduped[0]?.observedAt ?? null
  const lastObservedAt = deduped.at(-1)?.observedAt ?? null
  const latest = deduped.at(-1)
  const normalizedGap = relativeGap(latest?.providerValue, input.currentComposite)
  const componentGaps = [
    relativeGap(latest?.rawValue, input.currentKtc),
    relativeGap(latest?.rawValue, input.currentFantasyCalc),
  ].filter((value): value is number => value !== null)
  const componentGap = componentGaps.length ? Math.min(...componentGaps) : null
  const scaleStatus = normalizedGap !== null && normalizedGap <= 0.12
    ? 'compatible'
    : componentGap !== null && componentGap <= 0.12
      ? 'component-like'
      : 'unknown'
  return {
    observations: deduped,
    observationCount: deduped.length,
    labelCount: countReturnLabels(deduped.map((point) => point.observedAt)),
    firstObservedAt,
    lastObservedAt,
    spanDays: firstObservedAt && lastObservedAt
      ? Math.max(0, Math.round((Date.parse(lastObservedAt) - Date.parse(firstObservedAt)) / DAY_MS))
      : 0,
    medianGapDays: median(gaps),
    scaleStatus,
    scaleGap: scaleStatus === 'compatible' ? normalizedGap : componentGap,
  }
}

export function emptyHistoricalTapeAudit(): HistoricalTapeAudit {
  return {
    provider: 'tradyr', status: 'not-started', formatKey: 'tradyr-default-history',
    queuedAt: null, updatedAt: null, completedAt: null, targetAssets: 0, attemptedAssets: 0,
    coveredAssets: 0, missingAssets: 0, failedAssets: 0, observationCount: 0, labelCount: 0,
    coverageRate: 0, medianObservations: 0, medianSpanDays: 0, medianGapDays: 0,
    scaleCompatibleRate: 0, sourceRelativeReady: false, liveScaleReady: false, featureReady: false, gates: [],
    notes: ['The audit starts automatically after this league seeds its private market tape.'],
  }
}

export function buildHistoricalTapeAudit(input: {
  assets: HistoricalAuditAssetResult[]
  formatCompatible: boolean
  lifecycleStatus: 'queued' | 'running' | 'complete' | 'failed'
  queuedAt: string | null
  updatedAt: string | null
  completedAt: string | null
}): HistoricalTapeAudit {
  const attempted = input.assets.filter((asset) => asset.status !== 'pending')
  const covered = input.assets.filter((asset) => asset.status === 'complete' && asset.observationCount > 0)
  const targetAssets = input.assets.length
  const coverageRate = targetAssets ? covered.length / targetAssets : 0
  const scaleCompatibleRate = covered.length
    ? covered.filter((asset) => asset.scaleStatus === 'compatible').length / covered.length
    : 0
  const medianObservations = median(covered.map((asset) => asset.observationCount))
  const medianSpanDays = median(covered.map((asset) => asset.spanDays))
  const medianGapDays = median(covered.map((asset) => asset.medianGapDays).filter((value) => value > 0))
  const gates: HistoricalTapeGate[] = [
    { id: 'coverage', label: 'Player coverage', passed: coverageRate >= 0.85, actual: coverageRate, requirement: '>= 85%' },
    { id: 'observations', label: 'Median observations', passed: medianObservations >= 24, actual: medianObservations, requirement: '>= 24 per covered player' },
    { id: 'span', label: 'Median history depth', passed: medianSpanDays >= 365, actual: medianSpanDays, requirement: '>= 365 days' },
    { id: 'cadence', label: 'Median sampling gap', passed: medianGapDays > 0 && medianGapDays <= 35, actual: medianGapDays, requirement: '<= 35 days' },
    { id: 'format', label: 'League-format compatibility', passed: input.formatCompatible, actual: input.formatCompatible ? 1 : 0, requirement: 'default SF, non-TEP format' },
    { id: 'scale', label: 'Current-scale compatibility', passed: scaleCompatibleRate >= 0.8, actual: scaleCompatibleRate, requirement: '>= 80% of covered players' },
  ]
  const sourceRelativeReady = gates.filter((gate) => gate.id !== 'scale').every((gate) => gate.passed)
  const liveScaleReady = gates.every((gate) => gate.passed)
  const terminalStatus = input.lifecycleStatus === 'failed'
    ? 'failed'
    : liveScaleReady
      ? 'passed'
      : 'blocked'
  const status: HistoricalTapeAudit['status'] = input.lifecycleStatus === 'queued' || input.lifecycleStatus === 'running'
    ? input.lifecycleStatus
    : terminalStatus
  const componentLike = covered.filter((asset) => asset.scaleStatus === 'component-like').length
  return {
    provider: 'tradyr', status, formatKey: 'tradyr-default-history', queuedAt: input.queuedAt,
    updatedAt: input.updatedAt, completedAt: input.completedAt, targetAssets,
    attemptedAssets: attempted.length, coveredAssets: covered.length,
    missingAssets: input.assets.filter((asset) => asset.status === 'missing').length,
    failedAssets: input.assets.filter((asset) => asset.status === 'failed').length,
    observationCount: covered.reduce((sum, asset) => sum + asset.observationCount, 0),
    labelCount: covered.reduce((sum, asset) => sum + asset.labelCount, 0),
    coverageRate: clamp(coverageRate), medianObservations, medianSpanDays, medianGapDays,
    scaleCompatibleRate: clamp(scaleCompatibleRate), sourceRelativeReady, liveScaleReady, featureReady: false, gates,
    notes: [
      `${componentLike} covered histories currently resemble a component scale more closely than the live Tradyr composite.`,
      'Historical price labels remain isolated from the live recommendation model until every audit gate passes.',
      'Historical news, roster context, and manager intent are not present yet, so this tape cannot train the full feature model by itself.',
    ],
  }
}
