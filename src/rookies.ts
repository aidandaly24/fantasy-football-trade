export type RookiePosition = 'QB' | 'RB' | 'WR' | 'TE'

export type RookieBoardPlayer = {
  id: string
  sleeperId: string | null
  name: string
  position: RookiePosition
  nflTeam: string | null
  college: string | null
  draftBoardRank: number
  rookieMarketRank: number
  lateCandidate: boolean
  inValidatedSleeperBasket: boolean
  expectedRookieProductionPercentile: number
  marketOnlyExpectedProductionPercentile: number
  evidenceAdjustment: number
  modelDisagreement: number
  historicalResidualBand80: {
    lower: number
    upper: number
    meaning: string
  }
  evidence: {
    nflDraftOverall: number | null
    collegeSeasonsObserved: number
    finalCollegeScrimmageShare: number | null
    maxCollegeScrimmageShare: number | null
    finalCollegeTargetShare: number | null
    forty: number | null
    collegeDataPresent: boolean
    combineDataPresent: boolean
  }
}

export type RookieClassResult = {
  rookieYear: number
  modelBasketMeanPercentile: number
  strongestSimpleBaseline: string
  strongestSimpleBaselineMeanPercentile: number
  lift: number
}

export type RookiePickOpportunityCandidate = {
  sleeperId: string | null
  name: string
  position: RookiePosition
  team: string | null
  college: string | null
  rookieMarketRank: number
  nflDraftOverall: number | null
  availableByRule: Record<string, boolean>
  expectedProductionPercentile: number
  historicalResidualBand80: { lower: number; upper: number; meaning: string }
}

export type RookiePickOpportunity = {
  class: number
  status: 'advisory'
  advisoryOnly: true
  availabilityMeaning: string
  availabilityRules: string[]
  targetMeaning: string
  exactSlotPromotion: false
  exact112Gate: {
    passed: boolean
    eligibleClasses: number
    primaryAvailabilityClassWins: number
    exactOneSidedSignPValue: number
    requirement: string
  }
  slots: Array<{ slot: number; label: string; candidates: RookiePickOpportunityCandidate[] }>
  boundary: string[]
}

export type FutureRookieClassOpportunity = {
  version: string
  generatedAt: string
  targetDraftYear: number
  status: 'blocked' | 'shadow' | 'ready'
  reason: string
  trainingEnabled: boolean
  downstreamEnabled: boolean
  phasePassed: boolean
  evaluableDraftYears: number[]
  boundary: string[]
}

export type RookieBoardBundle = {
  version: string
  generatedAt: string
  mode: string
  draftEvidenceEnabled: boolean
  tradeReturnForecastEnabled: false
  target: {
    meaning: string
    status: 'backtest-passed' | 'shadow' | 'blocked'
  }
  decisionBoundary: string[]
  trainingEvidence: {
    examples: number
    classes: number[]
    historicalCollegeCoverage: number
    currentCollegeCoverage: number
  }
  validation: {
    eligibleClasses: number
    classWins: number
    meanBasketLift: number
    minimumClassLift: number
    signTestPValue: number
    fullModelMae: number
    fullModelSpearman: number
    marketOnlyMae: number
    marketOnlySpearman: number
    meanLiftOverLearnedCapitalModel: number
    learnedCapitalModelClassWins: number
    classResults: RookieClassResult[]
  }
  board: RookieBoardPlayer[]
  pickOpportunity: RookiePickOpportunity
  futureClassOpportunity: FutureRookieClassOpportunity
  promotionBlockers: string[]
}

export type RookieBoardSort = 'board' | 'market' | 'production' | 'adjustment'

export function rookiePlayerKey(player: RookieBoardPlayer): string {
  return player.id
}

export function selectRookieBoardPlayers(
  board: readonly RookieBoardPlayer[],
  options: {
    basketOnly: boolean
    position: RookiePosition | 'ALL'
    sort: RookieBoardSort
  },
): RookieBoardPlayer[] {
  const filtered = board.filter((player) => (
    (!options.basketOnly || player.inValidatedSleeperBasket)
    && (options.position === 'ALL' || player.position === options.position)
  ))
  const compareNumber = (left: number, right: number, descending = false) => (
    descending ? right - left : left - right
  )
  return [...filtered].sort((left, right) => {
    const primary = options.sort === 'board'
      ? compareNumber(left.draftBoardRank, right.draftBoardRank)
      : options.sort === 'market'
        ? compareNumber(left.rookieMarketRank, right.rookieMarketRank)
        : options.sort === 'production'
          ? compareNumber(left.expectedRookieProductionPercentile, right.expectedRookieProductionPercentile, true)
          : compareNumber(left.evidenceAdjustment, right.evidenceAdjustment, true)
    return primary || left.name.localeCompare(right.name)
  })
}
