import type { LeagueBundle, SleeperDraftPick } from './types'
import type { RookieBoardBundle, RookieBoardPlayer } from './rookies'

export const DRAFT_REVIEW_METHOD = 'Overall rank uses total current format-matched rookie market value acquired, with current market surplus versus the exact pick slots as the tie-breaker. Value-added rank orders absolute surplus; capital-efficiency rank orders surplus as a percentage of expected slot value. These are current mark-to-market measures because no frozen pre-draft value snapshot is available. The production model remains a separate advisory lane.'

export type DraftPickReview = {
  pickNo: number
  label: string
  playerId: string
  name: string
  position: string
  currentMarketRank: number | null
  currentMarketValue: number | null
  expectedSlotValue: number | null
  marketSurplus: number | null
  modelBoardRank: number | null
  expectedProductionPercentile: number | null
}

export type ManagerDraftReview = {
  rank: number
  valueAddedRank: number | null
  capitalEfficiencyRank: number | null
  userId: string
  rosterId: number | null
  handle: string
  picks: DraftPickReview[]
  currentMarketValue: number
  expectedSlotValue: number
  marketSurplus: number
  marketEfficiency: number | null
  marketCoverage: { priced: number; total: number }
  averageExpectedProductionPercentile: number | null
  bestValuePick: DraftPickReview | null
}

export type LeagueDraftReview = {
  status: 'complete' | 'unavailable'
  method: string
  marketGeneratedAt: string | null
  marketCoverageComplete: boolean
  managers: ManagerDraftReview[]
}

function pickLabel(pickNo: number, teams: number): string {
  const round = Math.floor((pickNo - 1) / teams) + 1
  const slot = ((pickNo - 1) % teams) + 1
  return `${round}.${String(slot).padStart(2, '0')}`
}

function pickName(pick: SleeperDraftPick): string {
  const metadataName = [pick.metadata?.first_name, pick.metadata?.last_name].filter(Boolean).join(' ').trim()
  return metadataName || `Sleeper player ${pick.player_id}`
}

function finiteAverage(values: Array<number | null>): number | null {
  const finite = values.filter((value): value is number => value !== null && Number.isFinite(value))
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : null
}

function playerReview(
  pick: SleeperDraftPick,
  boardBySleeperId: Map<string, RookieBoardPlayer>,
  marketValueByRank: Map<number, number>,
  teams: number,
): DraftPickReview {
  const player = boardBySleeperId.get(pick.player_id)
  const currentMarketValue = player?.currentMarket?.value ?? null
  const expectedSlotValue = marketValueByRank.get(pick.pick_no) ?? null
  return {
    pickNo: pick.pick_no,
    label: pickLabel(pick.pick_no, teams),
    playerId: pick.player_id,
    name: player?.name ?? pickName(pick),
    position: player?.position ?? pick.metadata?.position ?? 'NA',
    currentMarketRank: player?.currentMarket?.rank ?? null,
    currentMarketValue,
    expectedSlotValue,
    marketSurplus: currentMarketValue !== null && expectedSlotValue !== null
      ? currentMarketValue - expectedSlotValue
      : null,
    modelBoardRank: player?.draftBoardRank ?? null,
    expectedProductionPercentile: player?.expectedRookieProductionPercentile ?? null,
  }
}

export function buildLeagueDraftReview(
  leagueBundle: LeagueBundle,
  rookieBoard: RookieBoardBundle,
): LeagueDraftReview {
  const draftComplete = leagueBundle.draft?.status === 'complete' && leagueBundle.draftPicks.length > 0
  const marketComplete = rookieBoard.currentMarket?.status === 'live'
    && rookieBoard.currentMarket.coverage?.complete === true
  if (!draftComplete || !marketComplete) {
    return {
      status: 'unavailable',
      method: DRAFT_REVIEW_METHOD,
      marketGeneratedAt: rookieBoard.currentMarket?.generatedAt ?? null,
      marketCoverageComplete: marketComplete,
      managers: [],
    }
  }

  const teams = Number(leagueBundle.draft?.settings?.teams ?? leagueBundle.league.total_rosters ?? 12)
  const boardBySleeperId = new Map(
    rookieBoard.board.filter((player) => player.sleeperId).map((player) => [String(player.sleeperId), player]),
  )
  const marketValueByRank = new Map(
    rookieBoard.board
      .filter((player) => player.currentMarket)
      .map((player) => [player.currentMarket!.rank, player.currentMarket!.value]),
  )
  const rosterByUserId = new Map(
    leagueBundle.rosters.filter((roster) => roster.owner_id).map((roster) => [String(roster.owner_id), roster.roster_id]),
  )
  const picksByUserId = new Map<string, DraftPickReview[]>()
  leagueBundle.draftPicks.forEach((pick) => {
    const picks = picksByUserId.get(pick.picked_by) ?? []
    picks.push(playerReview(pick, boardBySleeperId, marketValueByRank, teams))
    picksByUserId.set(pick.picked_by, picks)
  })

  const managerIds = new Set([
    ...leagueBundle.users.map((user) => user.user_id),
    ...leagueBundle.draftPicks.map((pick) => pick.picked_by),
  ])
  const handleByUserId = new Map(leagueBundle.users.map((user) => [user.user_id, `@${user.display_name}`]))
  const managers: ManagerDraftReview[] = [...managerIds].map((userId): ManagerDraftReview => {
    const picks = [...(picksByUserId.get(userId) ?? [])].sort((left, right) => left.pickNo - right.pickNo)
    const priced = picks.filter((pick) => pick.currentMarketValue !== null && pick.expectedSlotValue !== null)
    const currentMarketValue = priced.reduce((sum, pick) => sum + Number(pick.currentMarketValue), 0)
    const expectedSlotValue = priced.reduce((sum, pick) => sum + Number(pick.expectedSlotValue), 0)
    const marketSurplus = currentMarketValue - expectedSlotValue
    return {
      rank: 0,
      valueAddedRank: null,
      capitalEfficiencyRank: null,
      userId,
      rosterId: rosterByUserId.get(userId) ?? null,
      handle: handleByUserId.get(userId) ?? `@unknown-${userId.slice(-4)}`,
      picks,
      currentMarketValue,
      expectedSlotValue,
      marketSurplus,
      marketEfficiency: expectedSlotValue > 0 ? marketSurplus / expectedSlotValue : null,
      marketCoverage: { priced: priced.length, total: picks.length },
      averageExpectedProductionPercentile: finiteAverage(picks.map((pick) => pick.expectedProductionPercentile)),
      bestValuePick: [...priced].sort((left, right) => Number(right.marketSurplus) - Number(left.marketSurplus) || left.pickNo - right.pickNo)[0] ?? null,
    }
  })

  const ranked = [...managers].sort((left, right) => (
    right.currentMarketValue - left.currentMarketValue
    || right.marketSurplus - left.marketSurplus
    || left.handle.localeCompare(right.handle)
  ))
  ranked.forEach((manager, index) => { manager.rank = index + 1 })
  const valueAddedRanked = ranked.filter((manager) => manager.picks.length > 0)
    .sort((left, right) => right.marketSurplus - left.marketSurplus || right.currentMarketValue - left.currentMarketValue)
  valueAddedRanked.forEach((manager, index) => { manager.valueAddedRank = index + 1 })
  const capitalEfficiencyRanked = ranked.filter((manager) => manager.marketEfficiency !== null)
    .sort((left, right) => Number(right.marketEfficiency) - Number(left.marketEfficiency) || right.marketSurplus - left.marketSurplus)
  capitalEfficiencyRanked.forEach((manager, index) => { manager.capitalEfficiencyRank = index + 1 })

  return {
    status: 'complete',
    method: DRAFT_REVIEW_METHOD,
    marketGeneratedAt: rookieBoard.currentMarket?.generatedAt ?? null,
    marketCoverageComplete: true,
    managers: ranked,
  }
}
