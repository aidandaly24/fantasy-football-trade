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
  it('classifies repeated pick acquisition from completed trades', () => {
    const profiles = buildManagerProfiles(
      Array.from({ length: 8 }, (_, index) => trade(String(index))),
      teams,
      players,
      picks,
    )

    const alpha = profiles.find((profile) => profile.rosterId === 1)
    expect(alpha?.archetype).toBe('Pick collector')
    expect(alpha?.confidence).toBe('medium')
    expect(alpha?.receivedPicks).toBe(8)
  })

  it('labels sparse histories as low confidence', () => {
    const [profile] = buildManagerProfiles([], teams, players, picks)

    expect(profile.archetype).toBe('Unproven market')
    expect(profile.confidence).toBe('low')
    expect(profile.evidenceNote).toContain('fewer than eight')
  })
})
