import { isSupportedLeagueId } from './league-context'
import type { Asset, Team } from './types'

export type TeamAddress = {
  leagueId: string
  rosterId: number
}

export type TeamValueAllocation = {
  label: string
  value: number
  count: number
}

export function parseTeamAddress(search: string): TeamAddress | null {
  const query = new URLSearchParams(search)
  const leagueId = query.get('league')
  const rosterId = Number(query.get('team'))
  if (!isSupportedLeagueId(leagueId) || !Number.isInteger(rosterId) || rosterId < 1 || rosterId > 100) return null
  return { leagueId, rosterId }
}

export function teamAddress(search: string, leagueId: string, rosterId: number | null): string {
  const query = new URLSearchParams(search)
  query.set('league', leagueId)
  query.delete('player')
  if (rosterId) query.set('team', String(rosterId))
  else query.delete('team')
  const encoded = query.toString()
  return encoded ? `?${encoded}` : ''
}

export function teamValueAllocation(team: Team): TeamValueAllocation[] {
  const buckets = new Map<string, { value: number; count: number }>()
  const add = (label: string, assets: Asset[]) => {
    buckets.set(label, {
      value: assets.reduce((sum, asset) => sum + asset.value, 0),
      count: assets.length,
    })
  }
  ;(['QB', 'RB', 'WR', 'TE'] as const).forEach((position) => add(position, team.players.filter((asset) => asset.position === position)))
  add('Other', team.players.filter((asset) => !['QB', 'RB', 'WR', 'TE'].includes(asset.position)))
  add('Picks', team.picks)
  return [...buckets.entries()]
    .map(([label, bucket]) => ({ label, ...bucket }))
    .filter((bucket) => bucket.count > 0)
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label))
}
