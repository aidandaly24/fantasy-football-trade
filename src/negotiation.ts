import type { PickValue, SleeperTransaction, Team, TradyrPlayer } from './types'

export type NegotiationConfidence = 'unmodeled'

export type ManagerProfile = {
  rosterId: number
  ownerName: string
  teamName: string
  tradeCount: number
  confidence: NegotiationConfidence
  archetype: 'Unmodeled'
  summary: string
  receivedPlayers: number
  receivedPicks: number
  sentPlayers: number
  sentPicks: number
  averageAssetsReceived: number
  averageAssetsSent: number
  pickShare: number
  favoritePositions: string[]
  currentValueDelta: null
  opening: string
  target: string
  walkAway: string
  evidenceNote: string
}

/** Builds a factual completed-trade ledger by current manager identity. It does
 * not infer preferences, archetypes, acceptance chances, or negotiation prices.
 * Startup-draft pick swaps are excluded because they are not dynasty asset trades. */
export function buildManagerProfiles(
  transactions: SleeperTransaction[],
  teams: Team[],
  players: TradyrPlayer[],
  _picks: PickValue[],
): ManagerProfile[] {
  const playerById = new Map(
    players.filter((player) => player.sleeperId).map((player) => [String(player.sleeperId), player]),
  )
  const trades = transactions.filter(
    (transaction) => transaction.type === 'trade'
      && transaction.status === 'complete'
      && !transaction.draft_picks.some((pick) => pick.round > 4),
  )

  return teams.map((team) => {
    const managerTrades = trades.filter((trade) => trade.roster_ids.includes(team.rosterId))
    let receivedPlayers = 0
    let receivedPicks = 0
    let sentPlayers = 0
    let sentPicks = 0
    const positionCounts = new Map<string, number>()

    managerTrades.forEach((trade) => {
      Object.entries(trade.adds ?? {}).forEach(([playerId, rosterId]) => {
        if (rosterId !== team.rosterId) return
        receivedPlayers += 1
        const position = playerById.get(playerId)?.position
        if (position) positionCounts.set(position, (positionCounts.get(position) ?? 0) + 1)
      })
      Object.entries(trade.drops ?? {}).forEach(([, rosterId]) => {
        if (rosterId === team.rosterId) sentPlayers += 1
      })
      trade.draft_picks.forEach((pick) => {
        if (pick.owner_id === team.rosterId) receivedPicks += 1
        if (pick.previous_owner_id === team.rosterId) sentPicks += 1
      })
    })

    const tradeCount = managerTrades.length
    const receivedAssets = receivedPlayers + receivedPicks
    const sentAssets = sentPlayers + sentPicks
    const favoritePositions = [...positionCounts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 2)
      .map(([position]) => position)
    return {
      rosterId: team.rosterId,
      ownerName: team.ownerName,
      teamName: team.teamName,
      tradeCount,
      confidence: 'unmodeled',
      archetype: 'Unmodeled',
      summary: tradeCount
        ? `${tradeCount} completed dynasty trade${tradeCount === 1 ? '' : 's'}: ${receivedAssets} assets received and ${sentAssets} sent.`
        : 'No completed dynasty trades were found in the linked seasons.',
      receivedPlayers,
      receivedPicks,
      sentPlayers,
      sentPicks,
      averageAssetsReceived: tradeCount ? Number((receivedAssets / tradeCount).toFixed(2)) : 0,
      averageAssetsSent: tradeCount ? Number((sentAssets / tradeCount).toFixed(2)) : 0,
      pickShare: receivedAssets ? Number((receivedPicks / receivedAssets).toFixed(3)) : 0,
      favoritePositions,
      currentValueDelta: null,
      opening: 'Unavailable until real offer-response labels exist.',
      target: 'Unavailable until real offer-response labels exist.',
      walkAway: 'Set manually in Trade Lab from current market evidence.',
      evidenceNote: 'Completed trades describe what happened. They do not reveal rejected offers, counters, motives, or a manager acceptance probability.',
    }
  })
}
