import type { PickValue, SleeperTransaction, Team, TradyrPlayer } from './types'

export type NegotiationConfidence = 'low' | 'medium' | 'high'

export type ManagerProfile = {
  rosterId: number
  ownerName: string
  teamName: string
  tradeCount: number
  confidence: NegotiationConfidence
  archetype: 'Unproven market' | 'Pick collector' | 'Consolidator' | 'Depth builder' | 'Player buyer' | 'Flexible trader'
  summary: string
  receivedPlayers: number
  receivedPicks: number
  sentPlayers: number
  sentPicks: number
  averageAssetsReceived: number
  averageAssetsSent: number
  pickShare: number
  favoritePositions: string[]
  currentValueDelta: number
  opening: string
  target: string
  walkAway: string
  evidenceNote: string
}

function confidenceForTrades(trades: number): NegotiationConfidence {
  if (trades >= 12) return 'high'
  if (trades >= 8) return 'medium'
  return 'low'
}

function pickValue(
  season: string,
  round: number,
  picks: PickValue[],
): number {
  const exact = picks.filter((pick) => pick.year === season && pick.round === round)
  const comparable = exact.length ? exact : picks.filter((pick) => pick.round === round)
  if (!comparable.length) return Math.max(250, 4200 / Math.pow(Math.max(1, round), 1.35))
  return comparable.reduce((sum, pick) => sum + pick.composite, 0) / comparable.length
}

function archetypeFor(
  tradeCount: number,
  pickShare: number,
  averageAssetsReceived: number,
  averageAssetsSent: number,
  receivedPlayers: number,
  receivedPicks: number,
): ManagerProfile['archetype'] {
  if (!tradeCount) return 'Unproven market'
  if (pickShare >= 0.4 && receivedPicks >= 2) return 'Pick collector'
  if (averageAssetsSent - averageAssetsReceived >= 0.35) return 'Consolidator'
  if (averageAssetsReceived - averageAssetsSent >= 0.35) return 'Depth builder'
  if (receivedPlayers >= Math.max(3, receivedPicks * 3)) return 'Player buyer'
  return 'Flexible trader'
}

function negotiationPlan(archetype: ManagerProfile['archetype']): Pick<ManagerProfile, 'opening' | 'target' | 'walkAway'> {
  if (archetype === 'Pick collector') {
    return {
      opening: 'Lead with a second or a flexible pick swap; make the draft capital the first thing they see.',
      target: 'Use picks to buy the player, but keep the best first-round outcome on your side.',
      walkAway: 'Do not turn a pick preference into a blank check—stop above 105% of market value.',
    }
  }
  if (archetype === 'Consolidator') {
    return {
      opening: 'Offer two useful pieces for one premium asset, with one piece solving a visible lineup need.',
      target: 'Make the package feel deep while preserving your highest-upside piece.',
      walkAway: 'Do not add a premium pick after the package already clears fair market value.',
    }
  }
  if (archetype === 'Depth builder') {
    return {
      opening: 'Offer one stable starter and ask for two younger or more liquid assets back.',
      target: 'Convert their appetite for depth into an extra upside piece or pick.',
      walkAway: 'Do not surrender the best asset unless the second return is genuinely startable or liquid.',
    }
  }
  if (archetype === 'Player buyer') {
    return {
      opening: 'Lead with a player who has an obvious current role; keep picks as the closing lever.',
      target: 'Ask for a small pick or age upgrade in exchange for immediate production.',
      walkAway: 'Do not pay contender prices for production your roster is not ready to use.',
    }
  }
  return {
    opening: 'Start near 90–95% of your fair-value ceiling with one clean, easy-to-read offer.',
    target: 'Aim for a small value edge plus a clear improvement to your starting lineup or timeline.',
    walkAway: 'Stop above 105% of market value unless the lineup upgrade changes your title odds.',
  }
}

export function buildManagerProfiles(
  transactions: SleeperTransaction[],
  teams: Team[],
  players: TradyrPlayer[],
  picks: PickValue[],
): ManagerProfile[] {
  const playerById = new Map(
    players.filter((player) => player.sleeperId).map((player) => [String(player.sleeperId), player]),
  )
  const trades = transactions.filter(
    (transaction) => transaction.type === 'trade' && transaction.status === 'complete',
  )

  return teams.map((team) => {
    const managerTrades = trades.filter((trade) => trade.roster_ids.includes(team.rosterId))
    let receivedPlayers = 0
    let receivedPicks = 0
    let sentPlayers = 0
    let sentPicks = 0
    let receivedValue = 0
    let sentValue = 0
    const positionCounts = new Map<string, number>()

    managerTrades.forEach((trade) => {
      Object.entries(trade.adds ?? {}).forEach(([playerId, rosterId]) => {
        if (rosterId !== team.rosterId) return
        receivedPlayers += 1
        const player = playerById.get(playerId)
        if (player) {
          receivedValue += player.composite
          positionCounts.set(player.position, (positionCounts.get(player.position) ?? 0) + 1)
        }
      })
      Object.entries(trade.drops ?? {}).forEach(([playerId, rosterId]) => {
        if (rosterId !== team.rosterId) return
        sentPlayers += 1
        sentValue += playerById.get(playerId)?.composite ?? 0
      })
      trade.draft_picks.forEach((pick) => {
        if (pick.owner_id === team.rosterId) {
          receivedPicks += 1
          receivedValue += pickValue(pick.season, pick.round, picks)
        }
        if (pick.previous_owner_id === team.rosterId) {
          sentPicks += 1
          sentValue += pickValue(pick.season, pick.round, picks)
        }
      })
    })

    const tradeCount = managerTrades.length
    const receivedAssets = receivedPlayers + receivedPicks
    const sentAssets = sentPlayers + sentPicks
    const averageAssetsReceived = tradeCount ? receivedAssets / tradeCount : 0
    const averageAssetsSent = tradeCount ? sentAssets / tradeCount : 0
    const pickShare = receivedAssets ? receivedPicks / receivedAssets : 0
    const archetype = archetypeFor(
      tradeCount,
      pickShare,
      averageAssetsReceived,
      averageAssetsSent,
      receivedPlayers,
      receivedPicks,
    )
    const confidence = confidenceForTrades(tradeCount)
    const favoritePositions = [...positionCounts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 2)
      .map(([position]) => position)
    const plan = negotiationPlan(archetype)
    const currentValueDelta = Math.round(receivedValue - sentValue)
    const summary = tradeCount
      ? `${tradeCount} completed trade${tradeCount === 1 ? '' : 's'}: ${receivedAssets} assets in, ${sentAssets} out${favoritePositions.length ? `, most often targeting ${favoritePositions.join('/')}` : ''}.`
      : 'No completed trades were found in the linked league seasons.'
    return {
      rosterId: team.rosterId,
      ownerName: team.ownerName,
      teamName: team.teamName,
      tradeCount,
      confidence,
      archetype,
      summary,
      receivedPlayers,
      receivedPicks,
      sentPlayers,
      sentPicks,
      averageAssetsReceived: Number(averageAssetsReceived.toFixed(2)),
      averageAssetsSent: Number(averageAssetsSent.toFixed(2)),
      pickShare: Number(pickShare.toFixed(3)),
      favoritePositions,
      currentValueDelta,
      ...plan,
      evidenceNote: confidence === 'low'
        ? 'Low confidence: fewer than eight completed trades. Treat this as a conversation hypothesis, not a prediction.'
        : 'Based on repeated completed trades across linked Sleeper league seasons; current-value deltas include hindsight.',
    }
  })
}
