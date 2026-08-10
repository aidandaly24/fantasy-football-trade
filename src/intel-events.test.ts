import { describe, expect, it } from 'vitest'
import {
  CLASSIFIER_FIXTURES,
  classifierFixtureAccuracy,
  classifyHeadline,
  headlineSimilarity,
  normalizeHeadline,
} from './intel-events'

describe('normalized intel events', () => {
  it('clears the minimum labeled classification gate', () => {
    const misses = CLASSIFIER_FIXTURES.filter((fixture) => {
      const result = classifyHeadline(fixture.title)
      return result.eventType !== fixture.eventType || result.direction !== fixture.direction
    })
    expect(CLASSIFIER_FIXTURES.length).toBeGreaterThanOrEqual(20)
    expect(misses).toEqual([])
    expect(classifierFixtureAccuracy()).toBeGreaterThanOrEqual(0.85)
  })

  it('classifies role and injury direction separately', () => {
    expect(classifyHeadline('J.J. McCarthy named starter after practice')).toMatchObject({
      eventType: 'role',
      direction: 'up',
    })
    expect(classifyHeadline('J.J. McCarthy ruled out after knee injury')).toMatchObject({
      eventType: 'injury',
      direction: 'down',
    })
  })

  it('normalizes and detects near-duplicate headlines', () => {
    expect(normalizeHeadline('BREAKING: Joe Burrow Injury Update')).toBe('joe burrow injury')
    expect(headlineSimilarity(
      'Joe Burrow cleared for full practice Friday',
      'Update: Joe Burrow cleared for full practice',
    )).toBeGreaterThanOrEqual(0.82)
  })
})
