import { describe, expect, it } from 'vitest'
import { buildManagerProfiles } from './negotiation'
import type { PickValue, SleeperTransaction, Team, TradyrPlayer } from './types'

const teams = [
  { rosterId: 1, ownerName: 'A', teamName: 'Alpha' },
  { rosterId: 2, ownerName: 'B', teamName: 'Beta' },
] as Team[]

const players = [
  { sleeperId: 'rb', position: 'RB', composite: 5000 },
  { sleeperId: 'wr', position: 'WR', composite: 4500 },
] as TradyrPlayer[]

const picks = [
  { id: '2027-mid-2', name: '2027 Mid 2nd', year: '2027', round: 2, slot: 6, tier: 'mid', composite: 2200, position: 'PICK' },
] as PickValue[]

function trade(id: string): SleeperTransaction {
  return {
    transaction_id: id,
    type: 'trade',
    status: 'complete',
    created: 1,
    status_updated: 1,
    roster_ids: [1, 2],
    consenter_ids: [1, 2],
    adds: { rb: 2 },
    drops: { rb: 1 },
    draft_picks: [
      { season: '2027', round: 2, roster_id: 1, owner_id: 1, previous_owner_id: 2 },
    ],
  }
}

describe('negotiation profiles', () => {
  it('reports repeated pick acquisition without inventing an archetype', () => {
    const profiles = buildManagerProfiles(
      Array.from({ length: 8 }, (_, index) => trade(String(index))),
      teams,
      players,
      picks,
    )

    const alpha = profiles.find((profile) => profile.rosterId === 1)
    const beta = profiles.find((profile) => profile.rosterId === 2)
    expect(alpha?.archetype).toBe('Unmodeled')
    expect(beta?.archetype).toBe('Unmodeled')
    expect(alpha?.confidence).toBe('unmodeled')
    expect(alpha?.receivedPicks).toBe(8)
    expect(alpha?.evidenceNote).toContain('do not reveal rejected offers')
  })

  it('leaves negotiation outputs unavailable when no offer labels exist', () => {
    const [profile] = buildManagerProfiles([], teams, players, picks)

    expect(profile.archetype).toBe('Unmodeled')
    expect(profile.confidence).toBe('unmodeled')
    expect(profile.opening).toContain('Unavailable')
  })

  it('excludes startup-draft pick swaps from the dynasty trade profile', () => {
    const startup = trade('startup')
    startup.draft_picks[0].round = 17
    const [profile] = buildManagerProfiles([startup], teams, players, picks)
    expect(profile.tradeCount).toBe(0)
  })
})
