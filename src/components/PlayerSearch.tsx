import { Search, X } from 'lucide-react'
import { useId, useMemo, useState } from 'react'
import type { Asset, Team } from '../types'
import { AssetBadge, formatValue } from './domain-ui'

export type PlayerSearchResult = {
  player: Asset
  owner: Team
}

function normalized(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? ''
}

export function searchRosteredPlayers(teams: Team[], query: string, limit = 8): PlayerSearchResult[] {
  const term = normalized(query)
  if (!term) return []

  return teams
    .flatMap((owner) => owner.players.map((player) => ({ player, owner })))
    .filter(({ player, owner }) => [player.name, player.team, player.position, owner.ownerName, owner.teamName]
      .some((field) => normalized(field).includes(term)))
    .sort((left, right) => {
      const leftName = normalized(left.player.name)
      const rightName = normalized(right.player.name)
      const leftScore = leftName.startsWith(term) ? 0 : leftName.includes(term) ? 1 : 2
      const rightScore = rightName.startsWith(term) ? 0 : rightName.includes(term) ? 1 : 2
      return leftScore - rightScore
        || (left.player.rank ?? Number.MAX_SAFE_INTEGER) - (right.player.rank ?? Number.MAX_SAFE_INTEGER)
        || right.player.value - left.player.value
        || left.player.name.localeCompare(right.player.name)
    })
    .slice(0, Math.max(1, limit))
}

export function PlayerSearch({
  teams,
  leagueLabel,
  onOpenPlayer,
}: {
  teams: Team[]
  leagueLabel: string
  onOpenPlayer: (playerId: string) => void
}) {
  const inputId = useId()
  const listId = `${inputId}-results`
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const results = useMemo(() => searchRosteredPlayers(teams, query), [query, teams])

  const choose = (result: PlayerSearchResult) => {
    setQuery('')
    setOpen(false)
    setActiveIndex(0)
    onOpenPlayer(result.player.id)
  }

  return (
    <section className="player-search-strip" aria-label="Player search">
      <div className="player-search-shell" onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false)
      }}>
        <label htmlFor={inputId}>Find a player</label>
        <div className="player-search-control">
          <Search size={17} aria-hidden="true" />
          <input
            id={inputId}
            type="search"
            role="combobox"
            autoComplete="off"
            aria-autocomplete="list"
            aria-controls={listId}
            aria-expanded={open && Boolean(query.trim())}
            aria-activedescendant={open && results[activeIndex] ? `${listId}-${results[activeIndex].player.id}` : undefined}
            placeholder={`Search rostered players in ${leagueLabel}`}
            value={query}
            onFocus={() => setOpen(true)}
            onChange={(event) => {
              setQuery(event.target.value)
              setOpen(true)
              setActiveIndex(0)
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown' && results.length) {
                event.preventDefault()
                setOpen(true)
                setActiveIndex((index) => (index + 1) % results.length)
              } else if (event.key === 'ArrowUp' && results.length) {
                event.preventDefault()
                setOpen(true)
                setActiveIndex((index) => (index - 1 + results.length) % results.length)
              } else if (event.key === 'Enter' && open && results[activeIndex]) {
                event.preventDefault()
                choose(results[activeIndex])
              } else if (event.key === 'Escape') {
                setOpen(false)
              }
            }}
          />
          {query && <button type="button" className="player-search-clear" onClick={() => { setQuery(''); setOpen(false) }} aria-label="Clear player search"><X size={15} /></button>}
        </div>
        {open && query.trim() && (
          <div className="player-search-results" id={listId} role="listbox" aria-label="Matching rostered players">
            {results.map((result, index) => (
              <button
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                className={index === activeIndex ? 'active' : ''}
                id={`${listId}-${result.player.id}`}
                key={result.player.id}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => choose(result)}
              >
                <AssetBadge position={result.player.position} />
                <span><strong>{result.player.name}</strong><small>{result.player.team ?? 'NFL team unavailable'} · @{result.owner.ownerName}</small></span>
                <b>{formatValue(result.player.value)}</b>
              </button>
            ))}
            {!results.length && <p>No rostered players match “{query.trim()}”.</p>}
          </div>
        )}
      </div>
    </section>
  )
}
