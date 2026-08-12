import { assetReturnEvidence, buildAssetReturnIndex } from './asset-returns'
import type { AssetReturnHealthBundle } from './asset-returns'
import type { ResolvedTeamStrategy, TradeFrontierCandidate } from './strategy'
import type { Team } from './types'

export type ActionableTargetBook = 'long-term-compounder' | 'catalyst-flip' | 'liquidity-conversion'

export type ActionabilityGate = {
  id: string
  label: string
  passed: boolean
  observed: string
  requirement: string
}

export type ActionableTargetCandidate = TradeFrontierCandidate & {
  book: ActionableTargetBook
  qualifyingBooks: ActionableTargetBook[]
  gates: ActionabilityGate[]
  edgeMechanism: string
  holdPeriod: string
  exitCondition: string
  evidence: {
    starterValueFloor: number
    liquidityFloor: number | null
    drawdownFloor: number | null
    targetTradeFrequency: number | null
    targetDrawdown180: number | null
    targetAgeAtHorizon: number | null
    positionAgeCeiling: number | null
  }
}

export type ActionableTradeBook = {
  candidates: ActionableTargetCandidate[]
  evaluatedTargets: number
  qualifyingTargets: number
  thresholds: {
    starterValueFloor: number
    liquidityFloor: number | null
    drawdownFloor: number | null
    catalystPnlFloor: number | null
    catalystDownsideFloor: number | null
  }
  method: string
}

export type ActionableTradeBookOptions = {
  teams: Team[]
  myRosterId: number
  strategy: ResolvedTeamStrategy
  assetReturnHealth: AssetReturnHealthBundle | null
  numQbs: 1 | 2
  candidates: TradeFrontierCandidate[]
  limit?: number
}

function median(values: number[]): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

function gate(
  id: string,
  label: string,
  passed: boolean,
  observed: string,
  requirement: string,
): ActionabilityGate {
  return { id, label, passed, observed, requirement }
}

function gatesPass(gates: ActionabilityGate[]): boolean {
  return gates.every((item) => item.passed)
}

function formatNumber(value: number | null | undefined, digits = 0): string {
  return value === null || value === undefined ? 'Unavailable' : value.toFixed(digits)
}

function orderWithinBook(
  book: ActionableTargetBook,
  a: ActionableTargetCandidate,
  b: ActionableTargetCandidate,
): number {
  if (book === 'long-term-compounder') return (
    b.targetAsset.value - a.targetAsset.value
    || (b.evidence.targetDrawdown180 ?? Number.NEGATIVE_INFINITY) - (a.evidence.targetDrawdown180 ?? Number.NEGATIVE_INFINITY)
    || (b.evidence.targetTradeFrequency ?? Number.NEGATIVE_INFINITY) - (a.evidence.targetTradeFrequency ?? Number.NEGATIVE_INFINITY)
    || a.key.localeCompare(b.key)
  )
  if (book === 'catalyst-flip') return (
    (b.portfolio?.expectedPnl30 ?? Number.NEGATIVE_INFINITY) - (a.portfolio?.expectedPnl30 ?? Number.NEGATIVE_INFINITY)
    || (b.portfolio?.trackedAssetLowerPnl30 ?? Number.NEGATIVE_INFINITY) - (a.portfolio?.trackedAssetLowerPnl30 ?? Number.NEGATIVE_INFINITY)
    || a.key.localeCompare(b.key)
  )
  return (
    (b.portfolio?.tradeFrequency ?? Number.NEGATIVE_INFINITY) - (a.portfolio?.tradeFrequency ?? Number.NEGATIVE_INFINITY)
    || b.draftCapitalNetToMe - a.draftCapitalNetToMe
    || b.marketNetToMe - a.marketNetToMe
    || a.key.localeCompare(b.key)
  )
}

/** Screens an already-computed trade frontier into a small, named trade book.
 * Every threshold is derived from the loaded league or candidate population;
 * the function does not fit or apply an acceptance or target score. */
export function buildActionableTradeBook(options: ActionableTradeBookOptions): ActionableTradeBook {
  const empty: ActionableTradeBook = {
    candidates: [],
    evaluatedTargets: options.candidates.length,
    qualifyingTargets: 0,
    thresholds: { starterValueFloor: 0, liquidityFloor: null, drawdownFloor: null, catalystPnlFloor: null, catalystDownsideFloor: null },
    method: 'No complete target and package population was available.',
  }
  const mine = options.teams.find((team) => team.rosterId === options.myRosterId)
  if (!mine || !options.assetReturnHealth || !options.candidates.length) return empty

  const opponentAssets = options.teams
    .filter((team) => team.rosterId !== mine.rosterId)
    .flatMap((team) => [...team.players, ...team.picks])
    .filter((asset) => asset.value > 0)
  const starterValues = options.teams
    .flatMap((team) => team.optimizedStarters)
    .map((asset) => asset.value)
    .filter((value) => value > 0)
  const starterValueFloor = median(starterValues) ?? median(opponentAssets.map((asset) => asset.value)) ?? 0
  const pickValueFloor = median(opponentAssets.filter((asset) => asset.kind === 'pick').map((asset) => asset.value)) ?? starterValueFloor
  const index = buildAssetReturnIndex(options.assetReturnHealth, options.numQbs)
  const tracked = opponentAssets
    .map((asset) => assetReturnEvidence(asset, index))
    .filter((research) => research !== null)
  const liquidityFloor = median(tracked.flatMap((research) => research.tradeFrequency === null ? [] : [research.tradeFrequency]))
  const drawdownFloor = median(tracked.map((research) => research.risk.maxDrawdown180d))
  const catalystPnlFloor = median(options.candidates.flatMap((candidate) => (
    candidate.portfolio?.expectedPnl30 !== null && candidate.portfolio?.expectedPnl30 !== undefined && candidate.portfolio.expectedPnl30 > 0
      ? [candidate.portfolio.expectedPnl30]
      : []
  )))
  const catalystDownsideFloor = median(options.candidates.flatMap((candidate) => (
    candidate.portfolio?.trackedAssetLowerPnl30 !== null && candidate.portfolio?.trackedAssetLowerPnl30 !== undefined
      ? [candidate.portfolio.trackedAssetLowerPnl30]
      : []
  )))
  const positionAgeCeilings = new Map<string, number | null>()
  ;['QB', 'RB', 'WR', 'TE'].forEach((position) => {
    positionAgeCeilings.set(position, median(options.teams
      .flatMap((team) => team.optimizedStarters)
      .filter((asset) => asset.kind === 'player' && asset.position === position && asset.age !== null)
      .map((asset) => (asset.age ?? 0) + options.strategy.horizonYears)))
  })

  const decorated = options.candidates.flatMap((candidate): ActionableTargetCandidate[] => {
    const target = candidate.targetAsset
    const research = assetReturnEvidence(target, index)
    const horizon = research?.horizons['30']
    const roleVerified = target.kind === 'pick' || (
      target.active !== false
      && (target.nflStatus === null || target.nflStatus === undefined || target.nflStatus.toLowerCase() === 'active')
      && (target.depthChartOrder === null || target.depthChartOrder === undefined || target.depthChartOrder <= 2)
    )
    const targetAgeAtHorizon = target.kind === 'player' && target.age !== null
      ? target.age + options.strategy.horizonYears
      : null
    const positionAgeCeiling = target.kind === 'player' ? positionAgeCeilings.get(target.position) ?? null : null
    const targetTradeFrequency = research?.tradeFrequency ?? null
    const targetDrawdown180 = research?.risk.maxDrawdown180d ?? null
    const ageFits = target.kind === 'pick' || (
      targetAgeAtHorizon !== null
      && positionAgeCeiling !== null
      && targetAgeAtHorizon <= positionAgeCeiling
    )
    const liquidityFits = targetTradeFrequency !== null && liquidityFloor !== null && targetTradeFrequency >= liquidityFloor
    const downsideFits = targetDrawdown180 !== null && drawdownFloor !== null && targetDrawdown180 >= drawdownFloor
    const promotedReturn = horizon?.enabled === true && horizon.expectedReturn !== undefined && horizon.trackedAssetLower !== undefined
    const positionAgeRequirement = target.kind === 'pick'
      ? 'Draft capital qualifies'
      : positionAgeCeiling === null
        ? 'Position ceiling unavailable'
        : `At or below meaningful ${target.position} horizon age (${positionAgeCeiling.toFixed(1)})`
    const commonEvidence = {
      starterValueFloor,
      liquidityFloor,
      drawdownFloor,
      targetTradeFrequency,
      targetDrawdown180,
      targetAgeAtHorizon,
      positionAgeCeiling,
    }

    const compounderGates = [
      gate('compounder-player', 'Player asset', target.kind === 'player', target.kind, 'Player, not an unresolved pick'),
      gate('compounder-material', 'Starter-level materiality', target.value >= starterValueFloor, target.value.toFixed(0), `At least the league median optimized-starter value (${starterValueFloor.toFixed(0)})`),
      gate('compounder-age', 'Window-relative age', ageFits, formatNumber(targetAgeAtHorizon, 1), positionAgeRequirement),
      gate('compounder-liquidity', 'League-relative liquidity', liquidityFits, formatNumber(targetTradeFrequency, 4), liquidityFloor === null ? 'League median unavailable' : `At or above covered league median (${liquidityFloor.toFixed(4)})`),
      gate('compounder-downside', 'Tracked drawdown', downsideFits, targetDrawdown180 === null ? 'Unavailable' : `${(targetDrawdown180 * 100).toFixed(1)}%`, drawdownFloor === null ? 'League median unavailable' : `No worse than covered league median (${(drawdownFloor * 100).toFixed(1)}%)`),
      gate('compounder-carry', 'Short-horizon carry', (candidate.portfolio?.expectedPnl30 ?? Number.NEGATIVE_INFINITY) >= 0, formatNumber(candidate.portfolio?.expectedPnl30), 'Non-negative promoted 30-day package P&L'),
      gate('compounder-role', 'Current role', roleVerified, roleVerified ? 'Active top-two role marker' : 'Role needs verification', 'No inactive or depth-chart risk marker'),
    ]
    const catalystGates = [
      gate('catalyst-model', 'Promoted return evidence', promotedReturn, horizon?.enabled ? 'Enabled' : 'Unavailable', 'Validated 30-day asset-return row'),
      gate('catalyst-pnl', 'Material package repricing', catalystPnlFloor !== null && (candidate.portfolio?.expectedPnl30 ?? Number.NEGATIVE_INFINITY) >= catalystPnlFloor, formatNumber(candidate.portfolio?.expectedPnl30), catalystPnlFloor === null ? 'Positive package sample unavailable' : `At or above the median positive package P&L (${catalystPnlFloor.toFixed(0)})`),
      gate('catalyst-downside', 'Package downside', catalystDownsideFloor !== null && (candidate.portfolio?.trackedAssetLowerPnl30 ?? Number.NEGATIVE_INFINITY) >= catalystDownsideFloor, formatNumber(candidate.portfolio?.trackedAssetLowerPnl30), catalystDownsideFloor === null ? 'Tracked downside sample unavailable' : `At or above the league candidate median (${catalystDownsideFloor.toFixed(0)})`),
      gate('catalyst-liquidity', 'Exit liquidity', liquidityFits, formatNumber(targetTradeFrequency, 4), liquidityFloor === null ? 'League median unavailable' : `At or above covered league median (${liquidityFloor.toFixed(4)})`),
      gate('catalyst-age', 'Avoid veteran decay', ageFits, targetAgeAtHorizon === null ? target.kind : targetAgeAtHorizon.toFixed(1), positionAgeRequirement),
      gate('catalyst-role', 'Current role', roleVerified, roleVerified ? 'Active top-two role marker' : 'Role needs verification', 'No inactive or depth-chart risk marker'),
    ]
    const liquidityGates = [
      gate('liquidity-instrument', 'Reusable instrument', target.kind === 'pick' || liquidityFits, target.kind === 'pick' ? 'Draft capital' : formatNumber(targetTradeFrequency, 4), 'Pick or above-median covered player liquidity'),
      gate('liquidity-material', 'Material inventory', target.value >= (target.kind === 'pick' ? pickValueFloor : starterValueFloor), target.value.toFixed(0), 'At least the league median for the same inventory class'),
      gate('liquidity-improves', 'Portfolio liquidity improves', (candidate.portfolio?.tradeFrequency ?? Number.NEGATIVE_INFINITY) > 0 || candidate.draftCapitalNetToMe > 0, candidate.portfolio?.tradeFrequency === null || candidate.portfolio?.tradeFrequency === undefined ? `${candidate.draftCapitalNetToMe >= 0 ? '+' : ''}${candidate.draftCapitalNetToMe.toFixed(0)} pick value` : `${candidate.portfolio.tradeFrequency >= 0 ? '+' : ''}${candidate.portfolio.tradeFrequency.toFixed(4)}`, 'Positive covered trade-frequency delta or positive draft-capital net'),
      gate('liquidity-price', 'No current price donation', candidate.marketNetToMe >= 0, `${candidate.marketNetToMe >= 0 ? '+' : ''}${candidate.marketNetToMe.toFixed(0)}`, 'Non-negative current composite net'),
      gate('liquidity-consolidates', 'Inventory becomes simpler', target.kind === 'pick' || candidate.send.length > candidate.receive.length, `${candidate.send.length}-for-${candidate.receive.length}`, 'Pick conversion or fewer incoming pieces than outgoing pieces'),
      gate('liquidity-age', 'Window-relative age', ageFits, targetAgeAtHorizon === null ? target.kind : targetAgeAtHorizon.toFixed(1), positionAgeRequirement),
    ]
    const books: Array<{ book: ActionableTargetBook; gates: ActionabilityGate[] }> = [
      { book: 'long-term-compounder', gates: compounderGates },
      { book: 'catalyst-flip', gates: catalystGates },
      { book: 'liquidity-conversion', gates: liquidityGates },
    ]
    const qualifying = books.filter((book) => gatesPass(book.gates))
    if (!qualifying.length) return []
    const primary = qualifying[0]
    return [{
      ...candidate,
      book: primary.book,
      qualifyingBooks: qualifying.map((item) => item.book),
      gates: primary.gates,
      edgeMechanism: primary.book === 'long-term-compounder'
        ? 'Exchange package fragility for a starter-level asset with league-relative age, liquidity, and drawdown support.'
        : primary.book === 'catalyst-flip'
          ? 'Acquire a liquid asset only when the promoted 30-day return spread is material after subtracting what leaves.'
          : 'Convert harder-to-move inventory into reusable player or pick liquidity without donating current market value.',
      holdPeriod: primary.book === 'long-term-compounder'
        ? `Through the declared ${options.strategy.horizonYears}-year window, with quarterly thesis checks.`
        : primary.book === 'catalyst-flip'
          ? '30–90 days; this is an exit trade, not a permanent roster assumption.'
          : 'Until the liquid asset can fund a higher-conviction compounder or draft opportunity.',
      exitCondition: primary.book === 'long-term-compounder'
        ? 'Reassess if role, liquidity, or tracked drawdown falls below the current league-relative gate.'
        : primary.book === 'catalyst-flip'
          ? 'Sell into the modeled repricing; exit early if the role or downside gate breaks.'
          : 'Do not redeploy unless the next trade improves the long-term book without surrendering the captured liquidity.',
      evidence: commonEvidence,
    }]
  })

  const bookOrder: ActionableTargetBook[] = ['long-term-compounder', 'catalyst-flip', 'liquidity-conversion']
  const ordered = bookOrder.flatMap((book) => decorated
    .filter((candidate) => candidate.book === book)
    .sort((a, b) => orderWithinBook(book, a, b)))
  const selected: ActionableTargetCandidate[] = []
  const limit = Math.max(1, Math.min(8, options.limit ?? 5))
  bookOrder.forEach((book) => {
    const first = ordered.find((candidate) => candidate.book === book && !selected.some((item) => item.targetAsset.id === candidate.targetAsset.id))
    if (first) selected.push(first)
  })
  ordered.forEach((candidate) => {
    if (selected.length >= limit) return
    if (!selected.some((item) => item.targetAsset.id === candidate.targetAsset.id)) selected.push(candidate)
  })

  return {
    candidates: selected.slice(0, limit),
    evaluatedTargets: options.candidates.length,
    qualifyingTargets: decorated.length,
    thresholds: { starterValueFloor, liquidityFloor, drawdownFloor, catalystPnlFloor, catalystDownsideFloor },
    method: 'Targets must clear every visible gate for at least one thesis. Thresholds are medians of this league population or its candidate packages; no weighted target score is used.',
  }
}
