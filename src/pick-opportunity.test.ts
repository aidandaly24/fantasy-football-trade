import { describe, expect, it } from 'vitest'
import rookieArtifact from '../worker/generated/rookie-board.json'
import futureArtifact from '../worker/generated/future-rookie-status.json'
import { buildPickOpportunityRead } from './pick-opportunity'
import type { RookieBoardBundle } from './rookies'
import type { Asset } from './types'

function pick(year: string, slot?: number): Asset {
  return { id: `${year}-${slot ?? 'mid'}`, name: `${year} pick`, kind: 'pick', position: 'PICK', team: null, value: 500, valueLow: 400, valueHigh: 650, confidence: 0.5, age: null, rank: null, year, round: 1, slot }
}

const bundle = { ...rookieArtifact, futureClassOpportunity: futureArtifact } as RookieBoardBundle

describe('pick opportunity read', () => {
  it('shows real advisory candidates for a known 2026 slot without promoting it', () => {
    const read = buildPickOpportunityRead(pick('2026', 12), bundle)!
    expect(read.status).toBe('current-class-advisory')
    expect(read.candidates.length).toBeGreaterThan(0)
    expect(read.boundary.join(' ')).toContain('No exact slot is promoted')
  })

  it('does not name prospects for unresolved or blocked future picks', () => {
    expect(buildPickOpportunityRead(pick('2026'), bundle)?.candidates).toEqual([])
    const future = buildPickOpportunityRead(pick('2027'), bundle)!
    expect(future.status).toBe('future-class-blocked')
    expect(future.candidates).toEqual([])
    expect(future.evidence.join(' ')).toContain('No version-pinned 2026 roster snapshot')
  })
})
