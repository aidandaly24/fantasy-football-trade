import { describe, expect, it } from 'vitest'
import {
  canonicalEventIdentity,
  canonicalizeIntelEvents,
  getRefreshStatus,
  materializeWatchlistAlerts,
  matchConfidentPlayer,
  stableEventFingerprint,
  type IntelEventInput,
} from './alerts-store'

const base: IntelEventInput = {
  playerId: '11625',
  title: 'Joe Burrow cleared for full practice',
  source: { name: 'ESPN', url: 'https://example.com/espn/burrow' },
  publishedAt: '2026-08-10T12:00:00.000Z',
  expiresAt: '2026-08-13T12:00:00.000Z',
  eventType: 'injury',
  direction: 'up',
  impactWeight: 0.82,
}

describe('private alert helpers', () => {
  it('uses a stable fingerprint for the same canonical event', async () => {
    const copy = { ...base, source: { name: 'CBS', url: 'https://example.com/cbs/burrow' } }
    expect(canonicalEventIdentity(base)).toBe(canonicalEventIdentity(copy))
    await expect(stableEventFingerprint(base)).resolves.toBe(await stableEventFingerprint(copy))
  })

  it('collapses corroborating reports and retains source evidence', async () => {
    const events = await canonicalizeIntelEvents([
      base,
      { ...base, title: 'Report: Joe Burrow cleared for full practice', source: { name: 'CBS', url: 'https://example.com/cbs/burrow' } },
    ], '2026-08-10T12:30:00.000Z')
    expect(events).toHaveLength(1)
    expect(events[0].corroborationCount).toBe(2)
    expect(events[0].corroboratingSources.map((source) => source.name)).toEqual(['ESPN', 'CBS'])
  })

  it('does not merge distinct players or classifications', async () => {
    const events = await canonicalizeIntelEvents([
      base,
      { ...base, playerId: '9226' },
      { ...base, direction: 'down' },
    ])
    expect(events).toHaveLength(3)
  })

  it('matches only an unambiguous exact player name or alias', () => {
    const candidates = [
      { playerId: '1', name: 'Joe Burrow', aliases: ['Joseph Burrow'] },
      { playerId: '2', name: 'Joe Mixon' },
    ]
    expect(matchConfidentPlayer('Joe Burrow returns to practice', candidates)?.playerId).toBe('1')
    expect(matchConfidentPlayer('Joseph Burrow returns to practice', candidates)?.playerId).toBe('1')
    expect(matchConfidentPlayer('Joe Burrow and Joe Mixon return to practice', candidates)).toBeNull()
    expect(matchConfidentPlayer('Burrow returns to practice', candidates)).toBeNull()
  })

  it('materializes only active events for the user and league watchlist', async () => {
    const events = await canonicalizeIntelEvents([
      base,
      { ...base, playerId: '9226', title: 'Tee Higgins cleared for full practice' },
      { ...base, playerId: '333', title: 'Expired Player cleared for full practice', expiresAt: '2026-08-10T11:00:00.000Z' },
    ])
    expect(materializeWatchlistAlerts(events, {
      userId: 'user-a', leagueId: '1336087922847289344', watchlist: ['11625', '333'],
    }, '2026-08-10T12:30:00.000Z')).toEqual([expect.objectContaining({ playerId: '11625', userId: 'user-a' })])
  })

  it('reports refresh due and stale states separately', () => {
    const fresh = getRefreshStatus({ lastSuccessAt: '2026-08-10T12:00:00.000Z' }, new Date('2026-08-10T12:04:00.000Z'))
    expect(fresh).toMatchObject({ due: false, stale: false, nextEligibleAt: '2026-08-10T12:05:00.000Z' })
    const due = getRefreshStatus({ lastSuccessAt: '2026-08-10T12:00:00.000Z', errorMessage: 'RSS unavailable' }, new Date('2026-08-10T12:06:00.000Z'))
    expect(due).toMatchObject({ due: true, stale: false, errorMessage: 'RSS unavailable' })
    expect(getRefreshStatus(null, new Date('2026-08-10T12:00:00.000Z'))).toMatchObject({ due: true, stale: true })
  })
})
