import type { JournalBundle, JournalIdentity, JournalTrade, SleeperTransaction } from './types'

export type JournalDisplayAsset = {
  key: string
  name: string
  kind: 'player' | 'pick'
  value: number | null
}

export type JournalTradeSide = {
  rosterId: number
  teamName: string
  received: JournalDisplayAsset[]
  marketNet: number | null
}

function identityKey(leagueId: string, rosterId: number): string {
  return `${leagueId}:${rosterId}`
}

export function journalIdentityMap(identities: JournalIdentity[]): Map<string, JournalIdentity> {
  return new Map(identities.map((identity) => [identityKey(identity.leagueId, identity.rosterId), identity]))
}

export function tradePartyNames(trade: JournalTrade, identities: JournalIdentity[]): Map<number, string> {
  const lookup = journalIdentityMap(identities)
  return new Map(trade.raw.roster_ids.map((rosterId) => [
    rosterId,
    lookup.get(identityKey(trade.leagueId, rosterId))?.teamName ?? `Roster ${rosterId}`,
  ]))
}

/**
 * Builds a display-safe trade tape from the immutable Sleeper record. Value
 * snapshots enrich the row when available, but they are never required for a
 * completed trade to remain visible.
 */
export function journalTradeSides(
  trade: JournalTrade,
  journal: JournalBundle,
  playerNames: Map<string, string> = new Map(),
): JournalTradeSide[] {
  const names = tradePartyNames(trade, journal.identities)
  const snapshots = journal.snapshots.filter(
    (item) => item.leagueId === trade.leagueId && item.transactionId === trade.transactionId,
  )
  const baseline = snapshots.find((item) => item.kind === 'ingestion')
    ?? snapshots.find((item) => item.kind === 'backfill-current')
    ?? snapshots[0]

  return [...new Set(trade.raw.roster_ids)].sort((a, b) => a - b).map((rosterId) => {
    const snapshotAssets = baseline?.values.assets
      .filter((asset) => asset.toRosterId === rosterId)
      .map((asset) => {
        const playerId = asset.kind === 'player' ? asset.key.replace(/^player:/, '') : null
        return {
          key: asset.key,
          name: playerId ? playerNames.get(playerId) ?? asset.name : asset.name,
          kind: asset.kind,
          value: asset.value,
        }
      }) ?? []
    const rawAssets: JournalDisplayAsset[] = [
      ...Object.entries(trade.raw.adds ?? {})
        .filter(([, ownerRosterId]) => ownerRosterId === rosterId)
        .map(([playerId]) => ({
          key: `player:${playerId}`,
          name: playerNames.get(playerId) ?? `Player ${playerId}`,
          kind: 'player' as const,
          value: null,
        })),
      ...trade.raw.draft_picks
        .filter((pick) => pick.owner_id === rosterId)
        .map((pick) => ({
          key: `pick:${pick.season}:${pick.round}:${pick.roster_id}`,
          name: `${pick.season} round ${pick.round} pick`,
          kind: 'pick' as const,
          value: null,
        })),
    ]
    return {
      rosterId,
      teamName: names.get(rosterId) ?? `Roster ${rosterId}`,
      received: snapshotAssets.length ? snapshotAssets : rawAssets,
      marketNet: baseline?.values.parties.find((party) => party.rosterId === rosterId)?.net ?? null,
    }
  })
}

/**
 * Re-keys historical season roster IDs through stable Sleeper owner IDs before
 * feeding completed trades to the current-manager profile model.
 */
export function journalTransactionsForCurrentManagers(
  journal: JournalBundle,
  currentLeagueId: string,
): SleeperTransaction[] {
  const identity = journalIdentityMap(journal.identities)
  const currentRosterByOwner = new Map(
    journal.identities
      .filter((item) => item.leagueId === currentLeagueId && item.ownerUserId)
      .map((item) => [String(item.ownerUserId), item.rosterId]),
  )
  const remap = (leagueId: string, rosterId: number): number => {
    const ownerId = identity.get(identityKey(leagueId, rosterId))?.ownerUserId
    return ownerId ? currentRosterByOwner.get(ownerId) ?? -rosterId : -rosterId
  }
  return journal.trades.map((trade) => {
    const transaction = trade.raw
    const mapRecord = (record: Record<string, number> | null) => record
      ? Object.fromEntries(Object.entries(record).map(([assetId, rosterId]) => [assetId, remap(trade.leagueId, rosterId)]))
      : null
    return {
      ...transaction,
      roster_ids: transaction.roster_ids.map((rosterId) => remap(trade.leagueId, rosterId)),
      consenter_ids: transaction.consenter_ids.map((rosterId) => remap(trade.leagueId, rosterId)),
      adds: mapRecord(transaction.adds),
      drops: mapRecord(transaction.drops),
      draft_picks: transaction.draft_picks.map((pick) => ({
        ...pick,
        owner_id: remap(trade.leagueId, pick.owner_id),
        previous_owner_id: remap(trade.leagueId, pick.previous_owner_id),
      })),
      season: trade.season,
      leagueId: trade.leagueId,
      transactionWeek: trade.week,
    }
  })
}
