import type { ManagerProfile } from './negotiation'
import { buildNegotiationLadder } from './strategy'
import type { ComparablePackage, NegotiationStage } from './strategy'
import type { Asset, Team } from './types'

const POSITIONS = ['QB', 'RB', 'WR', 'TE'] as const
type SkillPosition = typeof POSITIONS[number]

export type CounterpartyPositionLedger = {
  position: SkillPosition
  rosteredPlayers: number
  optimizedStarters: number
  dynastyValue: number
  currentSeasonValue: number
  leagueMedianDynastyValue: number
  leagueStanding: 'below-median' | 'at-median' | 'above-median'
}

export type CounterpartyRosterRead = {
  rosterId: number
  teamName: string
  rosterValue: number
  pickValue: number
  pickValueShare: number
  leagueMedianPickValueShare: number
  positions: CounterpartyPositionLedger[]
  needPositions: SkillPosition[]
  surplusPositions: SkillPosition[]
  coreAssets: Asset[]
  completedTradeEvidence: {
    tradeCount: number
    receivedPlayers: number
    receivedPicks: number
    averageAssetsReceived: number
    evidenceNote: string
  } | null
}

export type CounterpartyPackageRead = {
  stage: NegotiationStage
  package: ComparablePackage
  sellerMarketNet: number
  sellerCurrentSeasonPowerDelta: number | null
  fillsNeedWith: string[]
  targetComesFromSurplus: boolean
  whyTheyMightConsider: string[]
  blockers: string[]
  explanation: string
}

export type ThreeWayBridge = {
  key: string
  sellerRosterId: number
  thirdRosterId: number
  target: Asset
  bridgeToSeller: Asset
  assetToThird: Asset
  marketLedger: Array<{ rosterId: number; teamName: string; net: number }>
  evidence: string[]
  caveat: string
}

export type CounterpartyNegotiationBook = {
  seller: CounterpartyRosterRead
  stages: CounterpartyPackageRead[]
  directUtilityMismatch: boolean
  threeWayBridges: ThreeWayBridge[]
  method: string
}

function median(values: number[]): number {
  if (!values.length) return 0
  const ordered = [...values].sort((a, b) => a - b)
  const middle = Math.floor(ordered.length / 2)
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2
}

function allAssets(team: Team): Asset[] {
  return [...team.players, ...team.picks]
}

function positionValue(team: Team, position: SkillPosition): number {
  return team.players.filter((asset) => asset.position === position).reduce((sum, asset) => sum + asset.value, 0)
}

function teamPickShare(team: Team): number {
  const rosterValue = allAssets(team).reduce((sum, asset) => sum + asset.value, 0)
  const pickValue = team.picks.reduce((sum, asset) => sum + asset.value, 0)
  return rosterValue ? pickValue / rosterValue : 0
}

/** Describes the whole current roster relative to this league. Medians are
 * derived from the loaded league; no contender label or hidden utility score is
 * inferred. */
export function buildCounterpartyRosterRead(
  teams: Team[],
  rosterId: number,
  profile?: ManagerProfile | null,
): CounterpartyRosterRead | null {
  const team = teams.find((candidate) => candidate.rosterId === rosterId)
  if (!team) return null
  const rosterValue = allAssets(team).reduce((sum, asset) => sum + asset.value, 0)
  const pickValue = team.picks.reduce((sum, asset) => sum + asset.value, 0)
  const leagueMedianPickValueShare = median(teams.map(teamPickShare))
  const starterIds = new Set(team.optimizedStarters.map((asset) => asset.id))
  const positions = POSITIONS.map((position): CounterpartyPositionLedger => {
    const dynastyValue = positionValue(team, position)
    const leagueMedianDynastyValue = median(teams.map((candidate) => positionValue(candidate, position)))
    return {
      position,
      rosteredPlayers: team.players.filter((asset) => asset.position === position).length,
      optimizedStarters: team.players.filter((asset) => asset.position === position && starterIds.has(asset.id)).length,
      dynastyValue,
      currentSeasonValue: team.players
        .filter((asset) => asset.position === position)
        .reduce((sum, asset) => sum + (asset.currentSeasonValue ?? 0), 0),
      leagueMedianDynastyValue,
      leagueStanding: dynastyValue < leagueMedianDynastyValue
        ? 'below-median'
        : dynastyValue > leagueMedianDynastyValue ? 'above-median' : 'at-median',
    }
  })
  return {
    rosterId,
    teamName: team.teamName,
    rosterValue,
    pickValue,
    pickValueShare: rosterValue ? pickValue / rosterValue : 0,
    leagueMedianPickValueShare,
    positions,
    needPositions: positions.filter((position) => position.leagueStanding === 'below-median').map((position) => position.position),
    surplusPositions: positions.filter((position) => position.leagueStanding === 'above-median').map((position) => position.position),
    coreAssets: allAssets(team).sort((a, b) => b.value - a.value || a.id.localeCompare(b.id)).slice(0, 5),
    completedTradeEvidence: profile ? {
      tradeCount: profile.tradeCount,
      receivedPlayers: profile.receivedPlayers,
      receivedPicks: profile.receivedPicks,
      averageAssetsReceived: profile.averageAssetsReceived,
      evidenceNote: profile.evidenceNote,
    } : null,
  }
}

function assetFitsRead(asset: Asset, read: CounterpartyRosterRead): boolean {
  if (asset.kind === 'pick') return read.pickValueShare < read.leagueMedianPickValueShare
  return read.needPositions.includes(asset.position as SkillPosition)
}

function decorateStage(
  stage: ReturnType<typeof buildNegotiationLadder>[number],
  seller: CounterpartyRosterRead,
  target: Asset,
): CounterpartyPackageRead {
  const fillsNeedWith = stage.package.send.filter((asset) => assetFitsRead(asset, seller)).map((asset) => asset.name)
  const targetComesFromSurplus = target.kind === 'player'
    && seller.surplusPositions.includes(target.position as SkillPosition)
  const sellerMarketNet = -stage.package.marketNetToMe
  const whyTheyMightConsider: string[] = []
  if ((stage.package.currentSeasonPowerDeltaThem ?? Number.NEGATIVE_INFINITY) > 0) {
    whyTheyMightConsider.push(`Their covered current-season lineup power improves by ${stage.package.currentSeasonPowerDeltaThem}.`)
  }
  if (fillsNeedWith.length) whyTheyMightConsider.push(`The return adds league-below-median inventory: ${fillsNeedWith.join(' + ')}.`)
  if (targetComesFromSurplus) whyTheyMightConsider.push(`${target.position} is currently above the league median by dynasty value on their roster.`)
  if (stage.package.send.length > stage.package.receive.length) whyTheyMightConsider.push(`They receive ${stage.package.send.length} pieces for ${stage.package.receive.length}.`)
  if (seller.completedTradeEvidence?.tradeCount) {
    whyTheyMightConsider.push(`Their factual ledger contains ${seller.completedTradeEvidence.tradeCount} completed trades, ${seller.completedTradeEvidence.receivedPlayers} players received, and ${seller.completedTradeEvidence.receivedPicks} picks received.`)
  }
  const blockers: string[] = []
  if ((stage.package.currentSeasonPowerDeltaThem ?? 0) < 0) blockers.push(`Their covered current-season lineup power falls by ${Math.abs(stage.package.currentSeasonPowerDeltaThem!)}.`)
  if (!fillsNeedWith.length) blockers.push('The package does not add a position currently below this league’s median value.')
  if (!targetComesFromSurplus && target.kind === 'player') blockers.push(`${target.name} does not come from a position currently above the league median on their roster.`)
  if (sellerMarketNet < 0) blockers.push(`They give ${Math.abs(sellerMarketNet).toFixed(0)} more current composite value than they receive.`)
  return {
    stage: stage.stage,
    package: stage.package,
    sellerMarketNet,
    sellerCurrentSeasonPowerDelta: stage.package.currentSeasonPowerDeltaThem,
    fillsNeedWith,
    targetComesFromSurplus,
    whyTheyMightConsider,
    blockers,
    explanation: stage.explanation,
  }
}

function buildThreeWayBridges(
  teams: Team[],
  myRosterId: number,
  seller: CounterpartyRosterRead,
  target: Asset,
  directUtilityMismatch: boolean,
): ThreeWayBridge[] {
  if (!directUtilityMismatch || !seller.needPositions.length) return []
  const mine = teams.find((team) => team.rosterId === myRosterId)
  const sellerTeam = teams.find((team) => team.rosterId === seller.rosterId)
  if (!mine || !sellerTeam) return []
  const mineAssets = allAssets(mine).filter((asset) => asset.value > 0)
  const candidates = teams
    .filter((team) => team.rosterId !== myRosterId && team.rosterId !== seller.rosterId)
    .flatMap((third) => {
      const thirdRead = buildCounterpartyRosterRead(teams, third.rosterId)
      if (!thirdRead) return []
      const starterIds = new Set(third.optimizedStarters.map((asset) => asset.id))
      return third.players
        .filter((asset) => asset.value > 0 && seller.needPositions.includes(asset.position as SkillPosition) && !starterIds.has(asset.id))
        .flatMap((bridge) => mineAssets
          .filter((asset) => assetFitsRead(asset, thirdRead))
          .map((assetToThird): ThreeWayBridge & { distance: number } => ({
            key: `${target.id}:${bridge.id}:${assetToThird.id}`,
            sellerRosterId: seller.rosterId,
            thirdRosterId: third.rosterId,
            target,
            bridgeToSeller: bridge,
            assetToThird,
            marketLedger: [
              { rosterId: mine.rosterId, teamName: mine.teamName, net: target.value - assetToThird.value },
              { rosterId: sellerTeam.rosterId, teamName: sellerTeam.teamName, net: bridge.value - target.value },
              { rosterId: third.rosterId, teamName: third.teamName, net: assetToThird.value - bridge.value },
            ],
            evidence: [
              `${bridge.name} is a non-optimized starter at seller need position ${bridge.position}.`,
              assetToThird.kind === 'pick'
                ? `${third.teamName} holds a below-median pick-value share and receives ${assetToThird.name}.`
                : `${third.teamName} is below the league median at ${assetToThird.position} and receives ${assetToThird.name}.`,
            ],
            caveat: 'This is a market-balanced bridge candidate, not an acceptance prediction. Verify every manager’s actual interest before expanding the deal.',
            distance: Math.abs(target.value - bridge.value) + Math.abs(bridge.value - assetToThird.value),
          })))
    })
    .sort((a, b) => a.distance - b.distance || a.key.localeCompare(b.key))
  return candidates.slice(0, 2).map(({ distance: _distance, ...candidate }) => candidate)
}

/** Adds seller-side facts to the existing price ladder. The price anchors do
 * not move; roster fit is a separate lane and no acceptance probability is
 * produced. */
export function buildCounterpartyNegotiationBook(options: {
  teams: Team[]
  myRosterId: number
  counterpartRosterId: number
  target: Asset
  packages: ComparablePackage[]
  profile?: ManagerProfile | null
}): CounterpartyNegotiationBook | null {
  const seller = buildCounterpartyRosterRead(options.teams, options.counterpartRosterId, options.profile)
  if (!seller) return null
  const stages = buildNegotiationLadder(options.packages).map((stage) => decorateStage(stage, seller, options.target))
  const directUtilityMismatch = stages.length > 0 && stages.every((stage) => (
    stage.fillsNeedWith.length === 0
    && !stage.targetComesFromSurplus
    && (stage.sellerCurrentSeasonPowerDelta === null || stage.sellerCurrentSeasonPowerDelta <= 0)
  ))
  return {
    seller,
    stages,
    directUtilityMismatch,
    threeWayBridges: buildThreeWayBridges(options.teams, options.myRosterId, seller, options.target, directUtilityMismatch),
    method: 'Opening, target, and ceiling remain current-price anchors. Seller roster fit, completed-trade facts, and three-way bridge candidates are displayed separately and never converted into acceptance odds.',
  }
}
