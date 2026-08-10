import { describe, expect, it } from 'vitest'
import { buildIntelSignals, matchArticlePlayers, timeAgo } from './intel'
import type { IntelFeed, NewsArticle, Team, TradyrPlayer } from './types'

const players: TradyrPlayer[] = [
  { slug: 'joe-burrow', name: 'Joe Burrow', position: 'QB', team: 'CIN', age: 29, composite: 9000, confidence: 90, rank: 10, posRank: 4, sources: { ktc: 9000, fantasycalc: 9000 }, sleeperId: '1' },
  { slug: 'tee-higgins', name: 'Tee Higgins', position: 'WR', team: 'CIN', age: 27, composite: 7000, confidence: 88, rank: 30, posRank: 15, sources: { ktc: 7000, fantasycalc: 7000 }, sleeperId: '2' },
]

const article = (title: string): NewsArticle => ({
  id: title,
  title,
  url: 'https://example.com/story',
  source: 'Test',
  publishedAt: '2026-08-09T12:00:00.000Z',
  reliability: 0.9,
})

const team: Team = {
  rosterId: 7,
  ownerId: 'owner',
  ownerName: 'Owner',
  teamName: 'My Team',
  avatar: null,
  players: [{ id: 'player-1', name: 'Joe Burrow', kind: 'player', position: 'QB', team: 'CIN', value: 9000, confidence: 90, age: 29, rank: 10 }],
  picks: [],
  optimizedStarters: [],
  metrics: { lineupRaw: 0, coreRaw: 0, depthRaw: 0, picksRaw: 0, liquidityRaw: 0, marketRaw: 0, lineup: 0, core: 0, depth: 0, picks: 0, liquidity: 0, market: 0, overall: 0, contender: 0, future: 0 },
}

describe('intel matching', () => {
  it('matches full names and unique last names', () => {
    expect(matchArticlePlayers(article('Joe Burrow cleared to return'), players).map((p) => p.name)).toEqual(['Joe Burrow'])
    expect(matchArticlePlayers(article('Higgins impresses with first team'), players).map((p) => p.name)).toEqual(['Tee Higgins'])
  })

  it('builds league-aware actions from headlines and trends', () => {
    const feed: IntelFeed = {
      generatedAt: '2026-08-09T12:00:00.000Z',
      articles: [article('Joe Burrow cleared and healthy'), article('Higgins suffers injury setback')],
      trends: {
        adds6: [{ playerId: '1', count: 30 }],
        adds24: [{ playerId: '1', count: 40 }],
        drops6: [{ playerId: '2', count: 20 }],
        drops24: [{ playerId: '2', count: 25 }],
      },
      sources: [{ name: 'Test', ok: true }],
    }
    const signals = buildIntelSignals(feed, players, [team], 7)
    const burrow = signals.find((signal) => signal.player.name === 'Joe Burrow')!
    const higgins = signals.find((signal) => signal.player.name === 'Tee Higgins')!

    expect(burrow.direction).toBe('up')
    expect(burrow.isMine).toBe(true)
    expect(burrow.action).toContain('Hold')
    expect(higgins.direction).toBe('down')
    expect(higgins.ownerTeam).toBeNull()
  })

  it('formats recency without future timestamps', () => {
    expect(timeAgo('2026-08-09T11:30:00.000Z', Date.parse('2026-08-09T12:00:00.000Z'))).toBe('30m ago')
  })
})
