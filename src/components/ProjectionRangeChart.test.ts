import { describe, expect, it } from 'vitest'
import { projectionRangePositions } from './ProjectionRangeChart'

describe('projection range chart', () => {
  it('orders real floor, expected, and ceiling outputs on one bounded scale', () => {
    const positions = projectionRangePositions({ floorPpg: 8, expectedPpg: 12, ceilingPpg: 17 })
    expect(positions.floor).toBeLessThan(positions.expected)
    expect(positions.expected).toBeLessThan(positions.ceiling)
    expect(positions.ceiling).toBeLessThan(100)
  })
})
