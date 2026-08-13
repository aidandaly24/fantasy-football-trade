import type { PlayerProjection } from '../types'

function percent(value: number, maximum: number): number {
  return Math.max(0, Math.min(100, (value / maximum) * 100))
}

export function projectionRangePositions(projection: Pick<PlayerProjection, 'floorPpg' | 'expectedPpg' | 'ceilingPpg'>) {
  const maximum = Math.max(1, projection.ceilingPpg * 1.12)
  return {
    maximum,
    floor: percent(projection.floorPpg, maximum),
    expected: percent(projection.expectedPpg, maximum),
    ceiling: percent(projection.ceilingPpg, maximum),
  }
}

export function ProjectionRangeChart({ projection }: { projection: PlayerProjection }) {
  const positions = projectionRangePositions(projection)
  const rangeStart = Math.min(positions.floor, positions.ceiling)
  const rangeWidth = Math.max(1, Math.abs(positions.ceiling - positions.floor))

  return (
    <figure className="projection-range-chart" aria-label={`Projected PPR points per game: floor ${projection.floorPpg.toFixed(1)}, expected ${projection.expectedPpg.toFixed(1)}, ceiling ${projection.ceilingPpg.toFixed(1)}`}>
      <figcaption><strong>Projected PPG range</strong><span>Calibrated interval—not a weekly trend line</span></figcaption>
      <div className="projection-chart-plot" aria-hidden="true">
        <span className="projection-axis" />
        <span className="projection-range" style={{ left: `${rangeStart}%`, width: `${rangeWidth}%` }} />
        <span className="projection-marker floor" style={{ left: `${positions.floor}%` }}><i>Floor</i></span>
        <span className="projection-marker expected" style={{ left: `${positions.expected}%` }}><i>Expected</i></span>
        <span className="projection-marker ceiling" style={{ left: `${positions.ceiling}%` }}><i>Ceiling</i></span>
      </div>
      <div className="projection-chart-values">
        <span><small>Floor</small><b>{projection.floorPpg.toFixed(1)}</b></span>
        <span><small>Expected</small><b>{projection.expectedPpg.toFixed(1)}</b></span>
        <span><small>Ceiling</small><b>{projection.ceilingPpg.toFixed(1)}</b></span>
      </div>
    </figure>
  )
}
