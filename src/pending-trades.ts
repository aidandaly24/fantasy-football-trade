import { rebuildTeamMetrics } from './rankings'
import type {
  Asset,
  LeagueBundle,
  ManualPendingTrade,
  PendingPickMove,
  SleeperTransaction,
  SleeperTransactionPick,
  Team,
} from './types'

export type PendingTradeRecord = {
  source: 'sleeper' | 'manual'
  transaction: SleeperTransaction
  manualId?: string
}

export type PendingTradeIssue = {
  transactionId: string
  assetId: string
  message: string
}

export type PendingTradeProjection = {
  activeTrades: PendingTradeRecord[]
  committedTeams: Team[]
  availableTeams: Team[]
  lockedAssetIds: string[]
  issues: PendingTradeIssue[]
}

function cloneTeams(teams: Team[]): Team[] {
  return teams.map((team) => ({
    ...team,
    players: team.players.map((asset) => ({ ...asset })),
    picks: team.picks.map((asset) => ({ ...asset })),
    optimizedStarters: team.optimizedStarters.map((asset) => ({ ...asset })),
    metrics: { ...team.metrics },
  }))
}

export function pendingPickAssetId(pick: Pick<PendingPickMove, 'season' | 'round' | 'originalRosterId'>): string {
  return `pick:${pick.season}:${pick.round}:${pick.originalRosterId}`
}

function transactionPickAssetId(pick: SleeperTransactionPick): string {
  return pendingPickAssetId({
    season: pick.season,
    round: pick.round,
    originalRosterId: pick.roster_id,
  })
}

export function isAcceptedPendingTrade(transaction: SleeperTransaction): boolean {
  if (transaction.type !== 'trade' || transaction.status !== 'pending') return false
  const rosterIds = [...new Set(transaction.roster_ids ?? [])]
  const consenters = new Set(transaction.consenter_ids ?? [])
  return rosterIds.length >= 2 && rosterIds.every((rosterId) => consenters.has(rosterId))
}

export function manualTradeToTransaction(trade: ManualPendingTrade): SleeperTransaction {
  const adds: Record<string, number> = {}
  const drops: Record<string, number> = {}
  trade.playerMoves.forEach((move) => {
    drops[move.playerId] = move.fromRosterId
    adds[move.playerId] = move.toRosterId
  })
  return {
    transaction_id: trade.id,
    type: 'trade',
    status: 'pending',
    created: trade.createdAt,
    status_updated: trade.createdAt,
    roster_ids: [...trade.rosterIds],
    consenter_ids: [...trade.rosterIds],
    adds,
    drops,
    draft_picks: trade.pickMoves.map((pick) => ({
      season: pick.season,
      round: pick.round,
      roster_id: pick.originalRosterId,
      previous_owner_id: pick.fromRosterId,
      owner_id: pick.toRosterId,
    })),
  }
}

function transactionSignature(transaction: SleeperTransaction): string {
  const players = [...new Set([
    ...Object.keys(transaction.adds ?? {}),
    ...Object.keys(transaction.drops ?? {}),
  ])].sort().map((playerId) => (
    `p:${playerId}:${transaction.drops?.[playerId] ?? 0}>${transaction.adds?.[playerId] ?? 0}`
  ))
  const picks = [...(transaction.draft_picks ?? [])]
    .map((pick) => `d:${pick.season}:${pick.round}:${pick.roster_id}:${pick.previous_owner_id}>${pick.owner_id}`)
    .sort()
  return [...players, ...picks].join('|')
}

export function manualPendingTradeFingerprint(trade: ManualPendingTrade): string {
  return transactionSignature(manualTradeToTransaction(trade))
}

export function manualTradeRejectedBySleeper(
  trade: ManualPendingTrade,
  sleeperTransactions: SleeperTransaction[],
): boolean {
  const signature = manualPendingTradeFingerprint(trade)
  return Boolean(signature) && sleeperTransactions.some((transaction) => (
    ['failed', 'cancelled', 'rejected'].includes(transaction.status)
    && transactionSignature(transaction) === signature
  ))
}

export function mergePendingTrades(
  sleeperTransactions: SleeperTransaction[],
  manualTrades: ManualPendingTrade[],
): PendingTradeRecord[] {
  const records: PendingTradeRecord[] = []
  const seenIds = new Set<string>()
  const seenSignatures = new Set<string>()
  const add = (record: PendingTradeRecord) => {
    const id = record.transaction.transaction_id
    const signature = transactionSignature(record.transaction)
    if (seenIds.has(id) || (signature && seenSignatures.has(signature))) return
    seenIds.add(id)
    if (signature) seenSignatures.add(signature)
    records.push(record)
  }
  sleeperTransactions
    .filter(isAcceptedPendingTrade)
    .sort((a, b) => a.created - b.created || a.transaction_id.localeCompare(b.transaction_id))
    .forEach((transaction) => add({ source: 'sleeper', transaction }))
  manualTrades
    .map((manual) => ({ source: 'manual' as const, manualId: manual.id, transaction: manualTradeToTransaction(manual) }))
    .sort((a, b) => a.transaction.created - b.transaction.created || a.transaction.transaction_id.localeCompare(b.transaction.transaction_id))
    .forEach(add)
  return records
}

function findTeam(teams: Team[], rosterId: number): Team | undefined {
  return teams.find((team) => team.rosterId === rosterId)
}

function moveAsset(options: {
  teams: Team[]
  kind: 'player' | 'pick'
  assetId: string
  fromRosterId: number | null
  toRosterId: number | null
  transactionId: string
  issues: PendingTradeIssue[]
}) {
  const collection = options.kind === 'player' ? 'players' : 'picks'
  const from = options.fromRosterId === null ? undefined : findTeam(options.teams, options.fromRosterId)
  const to = options.toRosterId === null ? undefined : findTeam(options.teams, options.toRosterId)
  const currentOwner = options.teams.find((team) => team[collection].some((asset) => asset.id === options.assetId))
  const asset = options.fromRosterId === null
    ? currentOwner?.[collection].find((item) => item.id === options.assetId)
    : from?.[collection].find((item) => item.id === options.assetId)
  if (!asset || !to) {
    options.issues.push({
      transactionId: options.transactionId,
      assetId: options.assetId,
      message: !asset ? 'Asset is absent from the settled or prior projected roster.' : 'Destination roster is unavailable.',
    })
    return
  }
  options.teams.forEach((team) => {
    team[collection] = team[collection].filter((item) => item.id !== options.assetId)
  })
  const moved: Asset = options.kind === 'player'
    ? { ...asset, isStarter: false, isTaxi: false, isReserve: false }
    : { ...asset, ownerRosterId: options.toRosterId ?? asset.ownerRosterId }
  to[collection].push(moved)
  to[collection].sort((left, right) => right.value - left.value || left.id.localeCompare(right.id))
}

export function projectPendingTrades(
  settledTeams: Team[],
  records: PendingTradeRecord[],
  rosterPositions: string[],
): PendingTradeProjection {
  const teams = cloneTeams(settledTeams)
  const locked = new Set<string>()
  const issues: PendingTradeIssue[] = []

  records.forEach(({ transaction }) => {
    const playerIds = [...new Set([
      ...Object.keys(transaction.adds ?? {}),
      ...Object.keys(transaction.drops ?? {}),
    ])].sort()
    playerIds.forEach((playerId) => {
      locked.add(playerId)
      moveAsset({
        teams,
        kind: 'player',
        assetId: playerId,
        fromRosterId: transaction.drops?.[playerId] ?? null,
        toRosterId: transaction.adds?.[playerId] ?? null,
        transactionId: transaction.transaction_id,
        issues,
      })
    })
    ;[...(transaction.draft_picks ?? [])]
      .sort((a, b) => transactionPickAssetId(a).localeCompare(transactionPickAssetId(b)))
      .forEach((pick) => {
        const assetId = transactionPickAssetId(pick)
        locked.add(assetId)
        moveAsset({
          teams,
          kind: 'pick',
          assetId,
          fromRosterId: pick.previous_owner_id,
          toRosterId: pick.owner_id,
          transactionId: transaction.transaction_id,
          issues,
        })
      })
  })

  const committedTeams = rebuildTeamMetrics(teams, rosterPositions)
  const availableTeams = rebuildTeamMetrics(committedTeams.map((team) => ({
    ...team,
    players: team.players.filter((asset) => !locked.has(asset.id)),
    picks: team.picks.filter((asset) => !locked.has(asset.id)),
  })), rosterPositions)

  return {
    activeTrades: records,
    committedTeams,
    availableTeams,
    lockedAssetIds: [...locked].sort(),
    issues,
  }
}

export function manualTradeAlreadySettled(trade: ManualPendingTrade, leagueBundle: LeagueBundle): boolean {
  const playersByRoster = new Map(leagueBundle.rosters.map((roster) => [roster.roster_id, new Set(roster.players ?? [])]))
  const pickOwners = new Map<string, number>()
  leagueBundle.tradedPicks.forEach((pick) => {
    pickOwners.set(`${pick.season}:${pick.round}:${pick.roster_id}`, pick.owner_id)
  })
  const playersSettled = trade.playerMoves.every((move) => (
    playersByRoster.get(move.toRosterId)?.has(move.playerId)
    && !playersByRoster.get(move.fromRosterId)?.has(move.playerId)
  ))
  const picksSettled = trade.pickMoves.every((move) => (
    (pickOwners.get(`${move.season}:${move.round}:${move.originalRosterId}`) ?? move.originalRosterId) === move.toRosterId
  ))
  return (trade.playerMoves.length + trade.pickMoves.length) > 0 && playersSettled && picksSettled
}

export function createManualPendingTrade(options: {
  teamAId: number
  teamBId: number
  sideA: Asset[]
  sideB: Asset[]
  now?: number
}): ManualPendingTrade {
  const createdAt = options.now ?? Date.now()
  const rosterIds = [options.teamAId, options.teamBId].sort((a, b) => a - b)
  const playerMoves: ManualPendingTrade['playerMoves'] = []
  const pickMoves: ManualPendingTrade['pickMoves'] = []
  const addSide = (assets: Asset[], fromRosterId: number, toRosterId: number) => {
    assets.forEach((asset) => {
      if (asset.kind === 'player') {
        playerMoves.push({ playerId: asset.id, fromRosterId, toRosterId })
      } else if (asset.year && asset.round && asset.originalRosterId) {
        pickMoves.push({
          season: asset.year,
          round: asset.round,
          originalRosterId: asset.originalRosterId,
          fromRosterId,
          toRosterId,
        })
      }
    })
  }
  addSide(options.sideA, options.teamAId, options.teamBId)
  addSide(options.sideB, options.teamBId, options.teamAId)
  const assetKey = [...playerMoves.map((move) => move.playerId), ...pickMoves.map(pendingPickAssetId)].sort().join('-')
  return {
    id: `manual-${createdAt}-${rosterIds.join('-')}-${assetKey.slice(0, 32)}`,
    createdAt,
    rosterIds,
    playerMoves,
    pickMoves,
  }
}
