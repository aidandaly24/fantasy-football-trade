import { describe, expect, it } from 'vitest'
import { buildIntelSignals, matchArticlePlayers, timeAgo } from './intel'
import type { IntelFeed, NewsArticle, Team, TradyrPlayer } from './types'

const players: TradyrPlayer[] = [
  { slug: 'joe-burrow', name: 'Joe Burrow', position: 'QB', team: 'CIN', age: 29, composite: 9000, confidence: 90, rank: 10, posRank: 4, sources: { ktc: 9000, fantasycalc: 9000 }, sleeperId: '1' },
  { slug: 'tee-higgins', name: 'Tee Higgins', position: 'WR', team: 'CIN', age: 27, composite: 7000, confidence: 88, rank: 30, posRank: 15, sources: { ktc: 7000, fantasycalc: 7000 }, sleeperId: '2' },
  { slug: 'stefon-diggs', name: 'Stefon Diggs', position: 'WR', team: 'WAS', age: 32, composite: 3000, confidence: 80, rank: 100, posRank: 40, sources: { ktc: 3000, fantasycalc: 3000 }, sleeperId: '3' },
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
    expect(matchArticlePlayers(article('Lions worked out free agent CB Trevon Diggs'), players)).toEqual([])
  })

  it('joins factual headlines and trend counts without manufacturing an action score', () => {
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

    expect(burrow.direction).toBe('watch')
    expect(burrow.impactScore).toBe(0)
    expect(burrow.marketReactionScore).toBe(0)
    expect(burrow.isMine).toBe(true)
    expect(burrow.action).toBe('Watch only')
    expect(burrow.add24).toBe(40)
    expect(higgins.direction).toBe('watch')
    expect(higgins.drop24).toBe(25)
    expect(higgins.ownerTeam).toBeNull()
  })

  it('keeps raw Sleeper activity separate from an unvalidated edge estimate', () => {
    const quietFeed: IntelFeed = {
      generatedAt: '2026-08-09T12:00:00.000Z',
      articles: [article('Joe Burrow cleared and healthy')],
      trends: { adds6: [], adds24: [], drops6: [], drops24: [] },
      sources: [{ name: 'Test', ok: true }],
    }
    const reactedFeed: IntelFeed = {
      ...quietFeed,
      trends: {
        adds6: [{ playerId: '1', count: 500 }],
        adds24: [{ playerId: '1', count: 1000 }],
        drops6: [],
        drops24: [],
      },
    }
    const quiet = buildIntelSignals(quietFeed, players, [team], 7)[0]
    const reacted = buildIntelSignals(reactedFeed, players, [team], 7)[0]

    expect(reacted.add24).toBe(1000)
    expect(quiet.add24).toBe(0)
    expect(reacted.marketReactionScore).toBe(0)
    expect(reacted.edgeScore).toBe(0)
  })

  it('does not treat the word out as an injury by itself', () => {
    const feed: IntelFeed = {
      generatedAt: '2026-08-09T12:00:00.000Z',
      articles: [article('Joe Burrow out to prove critics wrong')],
      trends: { adds6: [], adds24: [], drops6: [], drops24: [] },
      sources: [{ name: 'Test', ok: true }],
    }

    expect(buildIntelSignals(feed, players, [team], 7)[0].direction).toBe('watch')
  })

  it('formats recency without future timestamps', () => {
    expect(timeAgo('2026-08-09T11:30:00.000Z', Date.parse('2026-08-09T12:00:00.000Z'))).toBe('30m ago')
  })
})
