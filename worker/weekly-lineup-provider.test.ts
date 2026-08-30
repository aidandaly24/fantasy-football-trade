import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchWeeklyProjectionBundle, parseCsv, resetWeeklyLineupProviderCacheForTest } from './weekly-lineup-provider'

const weekly = `"page","scrape_date","fantasypros_id","player_name","team","rank","ecr","sd","best","worst","player_opponent","tag","pos_rank","start_sit_grade","r2p_pts"
"qb",2026-09-03,"17298","Josh Allen","BUF",1,1.2,0.5,1,3,"vs. NE","start","QB1","A+","22.5"
"ppr-wr",2026-09-03,"999","Doe, John","JAC",2,2.1,1.2,1,5,"at TEN","start","WR1","A","17.25"
"dst",2026-09-03,"team-dal","Dallas Cowboys","DAL",1,1,0,1,1,"vs. NYG","start","DST1","A","8"
`

const ids = `fantasypros_id,sleeper_id,name
17298,4984,Josh Allen
999,12345,"Doe, John"
`

const schedule = `season,game_type,week,gameday,gametime,away_team,home_team
2026,REG,1,2026-09-09,20:20,NE,SEA
2026,REG,1,2026-09-13,13:00,BUF,NYJ
2026,REG,1,2026-09-13,16:25,JAX,TEN
2026,REG,1,2026-09-13,20:20,NYG,DAL
`

function sourceFetch(weeklyBody = weekly) {
  return vi.fn()
    .mockResolvedValueOnce(new Response(weeklyBody))
    .mockResolvedValueOnce(new Response(ids))
    .mockResolvedValueOnce(new Response(schedule))
}

describe('weekly lineup provider', () => {
  beforeEach(() => resetWeeklyLineupProviderCacheForTest())

  it('parses quoted commas and joins projections to stable Sleeper IDs', async () => {
    expect(parseCsv('name,note\n"Doe, John","He said ""go"""\n')).toEqual([
      ['name', 'note'], ['Doe, John', 'He said "go"'],
    ])
    const fetcher = sourceFetch()
    const result = await fetchWeeklyProjectionBundle(2026, 1, fetcher as typeof fetch)

    expect(result.status).toBe('partial')
    expect(result.projections['4984']).toMatchObject({ name: 'Josh Allen', points: 22.5, position: 'QB' })
    expect(result.projections['12345']).toMatchObject({ name: 'Doe, John', team: 'JAX', points: 17.25 })
    expect(result.projections['DEF:DAL']).toMatchObject({ position: 'DEF', points: 8 })
    expect(result.games.BUF).toMatchObject({ opponent: 'NYJ', home: false, kickoffOrder: '2026-09-13T13:00' })
    expect(fetcher).toHaveBeenCalledTimes(3)
  })

  it('does not pass last season weekly ranks off as current projections', async () => {
    const stale = weekly.replaceAll('2026-09-03', '2025-12-30')
    const result = await fetchWeeklyProjectionBundle(2026, 1, sourceFetch(stale) as typeof fetch)

    expect(result).toMatchObject({ status: 'not-published', sourceDate: '2025-12-30', projections: {} })
    expect(result.warnings[0]).toContain('has not been published')
  })

  it('rejects an old board from the same calendar year when it does not match the requested week', async () => {
    const stale = weekly.replaceAll('2026-09-03', '2026-01-02')
    const result = await fetchWeeklyProjectionBundle(2026, 1, sourceFetch(stale) as typeof fetch)

    expect(result).toMatchObject({ status: 'not-published', sourceDate: '2026-01-02', projections: {} })
  })

  it('reuses the bounded source fetch within the refresh window', async () => {
    const fetcher = sourceFetch()
    await fetchWeeklyProjectionBundle(2026, 1, fetcher as typeof fetch)
    await fetchWeeklyProjectionBundle(2026, 2, fetcher as typeof fetch)
    expect(fetcher).toHaveBeenCalledTimes(3)
  })
})
