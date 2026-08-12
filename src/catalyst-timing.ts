import type { Asset, EdgeCalibrationGroup, EdgeShadowModelHealth, EventModelHealthBundle, IntelSignal, NewsArticle } from './types'

export type CatalystEventRead = {
  playerId: string
  playerName: string
  article: NewsArticle
  marketCohort: EdgeCalibrationGroup | null
}

export type CatalystTimingRead = {
  events: CatalystEventRead[]
  productionEventModelEnabled: boolean
  marketEventModelEnabled: boolean
  timingInfluenceEnabled: boolean
  productionChecksPassed: number
  productionChecksTotal: number
  marketStatus: EdgeShadowModelHealth['status'] | 'unavailable'
  method: string
}

/** Joins current reports to historical cohort observations. Cohort means remain
 * descriptive; they cannot time or rank a trade until a chronological,
 * incremental market-event model exists and passes its own gate. */
export function buildCatalystTimingRead(options: {
  incoming: Asset[]
  signals: IntelSignal[]
  eventHealth: EventModelHealthBundle | null
  calibration: EdgeCalibrationGroup[]
  shadowModel: EdgeShadowModelHealth | null
}): CatalystTimingRead {
  const incoming = new Set(options.incoming.filter((asset) => asset.kind === 'player').map((asset) => asset.id))
  const events = options.signals
    .filter((signal) => signal.player.sleeperId && incoming.has(signal.player.sleeperId))
    .flatMap((signal) => signal.articles.map((article): CatalystEventRead => ({
      playerId: signal.player.sleeperId!,
      playerName: signal.player.name,
      article,
      marketCohort: article.eventType
        ? options.calibration.find((cohort) => cohort.key === `event:${article.eventType}`) ?? null
        : null,
    })))
    .sort((a, b) => Date.parse(b.article.publishedAt) - Date.parse(a.article.publishedAt) || a.article.id.localeCompare(b.article.id))
  const productionChecksPassed = options.eventHealth?.checks.filter((check) => check.passed).length ?? 0
  const productionChecksTotal = options.eventHealth?.checks.length ?? 0
  const productionEventModelEnabled = options.eventHealth?.enabled === true
  // The current private calibration is descriptive and the shadow model does
  // not isolate incremental event lift. It therefore cannot promote timing.
  const marketEventModelEnabled = false
  return {
    events,
    productionEventModelEnabled,
    marketEventModelEnabled,
    timingInfluenceEnabled: productionEventModelEnabled && marketEventModelEnabled,
    productionChecksPassed,
    productionChecksTotal,
    marketStatus: options.shadowModel?.status ?? 'unavailable',
    method: 'Current reports and observed 30-day event cohorts are shown together. News does not move price, target order, or a decision recommendation until a chronological market-event challenger proves incremental held-out lift.',
  }
}
