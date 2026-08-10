import type { JournalBundle, JournalIdentity, JournalTrade, SleeperTransaction } from './types'

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

