import type { Asset, Team } from '../types'
import type { ResearchGate } from '../research'

function initials(name: string): string {
  return name
    .split(/\\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}
export function Avatar({ team, size = 'md' }: { team: Team; size?: 'sm' | 'md' | 'lg' }) {
  if (team.avatar) {
    return <img className={`avatar avatar-${size}`} src={team.avatar} alt="" />
  }
  return <span className={`avatar avatar-${size} avatar-fallback`}>{initials(team.teamName)}</span>
}

export function AssetBadge({ position }: { position: Asset['position'] }) {
  return <span className={`position-badge pos-${position.toLowerCase()}`}>{position}</span>
}

export function formatResearchGate(gate: ResearchGate): string {
  const actual = gate.format === 'percent'
    ? `${(gate.actual * 100).toFixed(1)}%`
    : gate.format === 'decimal'
      ? gate.actual.toFixed(3)
      : Math.round(gate.actual).toLocaleString()
  return `${actual} / ${gate.requirement}`
}

export function formatValue(value: number): string {
  const rounded = Math.round(value)
  return new Intl.NumberFormat('en-US').format(Object.is(rounded, -0) ? 0 : rounded)
}

export function signedPercent(value: number): string {
  return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(1)}%`
}

export function MetricBar({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric-row">
      <div className="metric-label">
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
    </div>
  )
}
