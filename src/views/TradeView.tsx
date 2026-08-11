import { AlertTriangle, ArrowLeftRight, Check, Info, Search, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { assetRoleLabel, evaluateTrade } from '../rankings'
import type { Asset, Team } from '../types'
import { AssetBadge, Avatar, formatValue } from '../components/domain-ui'
import type { TradeDraft } from './types'

function TradeAssetRow({
  asset,
  selected,
  onToggle,
}: {
  asset: Asset
  selected: boolean
  onToggle: (id: string) => void
}) {
  return (
    <button
      type="button"
      className={`trade-asset-row ${selected ? 'selected' : ''}`}
      onClick={() => onToggle(asset.id)}
    >
      <AssetBadge position={asset.position} />
      <span className="trade-asset-copy">
        <strong>{asset.name}</strong>
        <small>
          {asset.kind === 'player'
            ? [asset.team, assetRoleLabel(asset), asset.projectedPpg !== undefined ? `${asset.projectedPpg.toFixed(1)} ML PPG` : null, asset.rank ? `#${asset.rank} overall` : 'Unranked'].filter(Boolean).join(' · ')
            : asset.slot
              ? 'Known slot'
              : `Unresolved midpoint · ${formatValue(asset.valueLow ?? asset.value)}–${formatValue(asset.valueHigh ?? asset.value)} range`}
        </small>
      </span>
      <b>{formatValue(asset.value)}</b>
      <span className="asset-add">{selected ? <Check size={15} /> : '+'}</span>
    </button>
  )
}
function TradeSide({
  side,
  team,
  teams,
  selectedIds,
  search,
  onSearch,
  onTeamChange,
  onToggle,
}: {
  side: 'A' | 'B'
  team: Team
  teams: Team[]
  selectedIds: string[]
  search: string
  onSearch: (value: string) => void
  onTeamChange: (rosterId: number) => void
  onToggle: (id: string) => void
}) {
  const allAssets = useMemo(
    () => [...team.players, ...team.picks].sort((a, b) => b.value - a.value),
    [team],
  )
  const filtered = allAssets.filter((asset) =>
    `${asset.name} ${asset.position} ${asset.team ?? ''}`.toLowerCase().includes(search.toLowerCase()),
  )
  const selected = allAssets.filter((asset) => selectedIds.includes(asset.id))

  return (
    <section className={`trade-side side-${side.toLowerCase()} panel`}>
      <div className="side-heading">
        <span className="side-label">Side {side} gives</span>
        <span>{selected.length} selected</span>
      </div>
      <label className="team-select-wrap">
        <Avatar team={team} size="sm" />
        <span>
          <small>Trading team</small>
          <select value={team.rosterId} onChange={(event) => onTeamChange(Number(event.target.value))}>
            {teams.map((option) => (
              <option key={option.rosterId} value={option.rosterId}>{option.teamName}</option>
            ))}
          </select>
        </span>
      </label>

      <div className="selected-assets">
        {selected.length ? (
          selected.map((asset) => (
            <button type="button" key={asset.id} onClick={() => onToggle(asset.id)}>
              <AssetBadge position={asset.position} />
              <span>{asset.shortName ?? asset.name}</span>
              <X size={14} />
            </button>
          ))
        ) : (
          <div className="empty-selection">
            <ArrowLeftRight size={18} />
            Choose what {team.teamName} sends
          </div>
        )}
      </div>

      <label className="asset-search">
        <Search size={17} />
        <input
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          placeholder="Search roster or picks"
        />
      </label>
      <div className="trade-asset-list">
        {filtered.map((asset) => (
          <TradeAssetRow
            key={asset.id}
            asset={asset}
            selected={selectedIds.includes(asset.id)}
            onToggle={onToggle}
          />
        ))}
        {!filtered.length && <p className="no-results">No assets match that search.</p>}
      </div>
    </section>
  )
}

function TradeVerdict({
  teamA,
  teamB,
  sideA,
  sideB,
  rosterPositions,
}: {
  teamA: Team
  teamB: Team
  sideA: Asset[]
  sideB: Asset[]
  rosterPositions: string[]
}) {
  const result = evaluateTrade(sideA, sideB, { teamA, teamB, rosterPositions })
  const lead = result.winner === 'A' ? 'a' : result.winner === 'B' ? 'b' : 'even'
  const ready = sideA.length > 0 && sideB.length > 0
  const compactVerdict = result.verdict
    .replace(teamA.teamName, 'Side A')
    .replace(teamB.teamName, 'Side B')
  return (
    <section className="trade-verdict panel">
      <div className={`verdict-orb verdict-${lead}`}>
        <Info size={23} />
        <span>{compactVerdict}</span>
      </div>
      <div className="value-versus">
        <span><small>{teamA.teamName} sends</small><strong>{formatValue(result.valueA)}</strong></span>
        <b>vs</b>
        <span><small>{teamB.teamName} sends</small><strong>{formatValue(result.valueB)}</strong></span>
      </div>
      <p className="verdict-copy">
        {!ready
          ? 'Select at least one asset on each side to compare the current provider values.'
          : `${result.difference.toFixed(1)}% separates the current composite totals. This is a price comparison, not a trade grade or prediction.`}
      </p>
      {ready && (
        <div className="trade-lenses">
          <span><small>Side A current-price net</small><b className={result.marketNetA > 0 ? 'positive' : result.marketNetA < 0 ? 'negative' : ''}>{result.marketNetA > 0 ? '+' : ''}{formatValue(result.marketNetA)}</b></span>
          <span><small>Production coverage</small><b>{result.projectionCoverage}%</b></span>
          <span><small>Side A modeled lineup</small><b>{result.lineupImpactA === null ? 'Not available' : `${result.lineupImpactA >= 0 ? '+' : ''}${result.lineupImpactA.toFixed(1)}`}</b></span>
        </div>
      )}
      {ready && (result.riskNotesA.length > 0 || result.riskNotesB.length > 0) && (
        <div className="trade-risk-list">
          {result.riskNotesA.slice(0, 2).map((note) => <p key={`a-${note}`}><AlertTriangle size={14} /><span><strong>Side A:</strong> {note}</span></p>)}
          {result.riskNotesB.slice(0, 2).map((note) => <p key={`b-${note}`}><AlertTriangle size={14} /><span><strong>Side B:</strong> {note}</span></p>)}
        </div>
      )}
      {ready && (result.projectionNotesA.length > 0 || result.projectionNotesB.length > 0) && (
        <div className="trade-risk-list trade-projection-list">
          {result.projectionNotesA.slice(0, 2).map((note) => <p key={`pa-${note}`}><Info size={14} /><span><strong>Side A receives:</strong> {note}</span></p>)}
          {result.projectionNotesB.slice(0, 2).map((note) => <p key={`pb-${note}`}><Info size={14} /><span><strong>Side B receives:</strong> {note}</span></p>)}
        </div>
      )}
      <div className="model-note">
        <Info size={16} />
        <span>ML production is expected generic PPR per team week, so missed games count. League-specific bonuses are not modeled. Uncovered players remain uncovered; market value is never converted into fake fantasy points.</span>
      </div>
    </section>
  )
}

function RosterImpact({
  teamA,
  teamB,
  sideA,
  sideB,
  rosterPositions,
}: {
  teamA: Team
  teamB: Team
  sideA: Asset[]
  sideB: Asset[]
  rosterPositions: string[]
}) {
  const value = evaluateTrade(sideA, sideB, { teamA, teamB, rosterPositions })
  const netA = value.marketNetA
  const netB = -value.marketNetA
  const topA = [...sideA].sort((a, b) => b.value - a.value)[0]
  const topB = [...sideB].sort((a, b) => b.value - a.value)[0]
  const spotsA = sideA.length - sideB.length

  const rows = [
    { label: 'Current market value', a: netA, b: netB, suffix: '', decimals: false },
    { label: 'Projected lineup PPG', a: value.lineupImpactA ?? 0, b: value.lineupImpactB ?? 0, suffix: '', decimals: true },
    { label: 'Roster spots opened', a: spotsA, b: -spotsA, suffix: '', decimals: false },
  ]

  return (
    <section className="impact-panel panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Deal context</span>
          <h2>What changes after the trade</h2>
        </div>
        <span className="method-note">Price, production, and role separated</span>
      </div>
      <div className="impact-grid">
        <div className="impact-team-name"><Avatar team={teamA} size="sm" /><span><small>Side A</small><strong>{teamA.teamName}</strong></span></div>
        <span className="impact-spacer" />
        <div className="impact-team-name align-right"><span><small>Side B</small><strong>{teamB.teamName}</strong></span><Avatar team={teamB} size="sm" /></div>
        {rows.map((row) => (
          <div className="impact-row" key={row.label}>
            <b className={row.a > 0 ? 'positive' : row.a < 0 ? 'negative' : ''}>{row.a > 0 ? '+' : ''}{row.decimals ? row.a.toFixed(1) : formatValue(row.a)}{row.suffix}</b>
            <span>{row.label}</span>
            <b className={row.b > 0 ? 'positive' : row.b < 0 ? 'negative' : ''}>{row.b > 0 ? '+' : ''}{row.decimals ? row.b.toFixed(1) : formatValue(row.b)}{row.suffix}</b>
          </div>
        ))}
        {(value.rangeA.worst !== value.rangeA.best || value.rangeB.worst !== value.rangeB.best) && (
          <div className="impact-row impact-range-row">
            <b>{formatValue(value.rangeA.worst)} to {formatValue(value.rangeA.best)}</b>
            <span>Pick scenario range</span>
            <b>{formatValue(value.rangeB.worst)} to {formatValue(value.rangeB.best)}</b>
          </div>
        )}
        <div className="impact-row">
          <b>{topB?.name ?? '—'}</b>
          <span>Best asset received</span>
          <b>{topA?.name ?? '—'}</b>
        </div>
      </div>
    </section>
  )
}

export function TradeView({ teams, rosterPositions, initialDraft }: { teams: Team[]; rosterPositions: string[]; initialDraft?: TradeDraft | null }) {
  const [teamAId, setTeamAId] = useState(initialDraft?.teamAId ?? teams[0].rosterId)
  const [teamBId, setTeamBId] = useState(initialDraft?.teamBId ?? teams[1]?.rosterId ?? teams[0].rosterId)
  const [selectedA, setSelectedA] = useState<string[]>(initialDraft?.selectedA ?? [])
  const [selectedB, setSelectedB] = useState<string[]>(initialDraft?.selectedB ?? [])
  const [searchA, setSearchA] = useState('')
  const [searchB, setSearchB] = useState('')
  const teamA = teams.find((team) => team.rosterId === teamAId) ?? teams[0]
  const teamB = teams.find((team) => team.rosterId === teamBId) ?? teams[1] ?? teams[0]
  const assetsA = [...teamA.players, ...teamA.picks].filter((asset) => selectedA.includes(asset.id))
  const assetsB = [...teamB.players, ...teamB.picks].filter((asset) => selectedB.includes(asset.id))

  const toggle = (ids: string[], setIds: (value: string[]) => void, id: string) => {
    setIds(ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id])
  }

  return (
    <main className="page-shell trade-page">
      <section className="page-intro trade-intro">
        <div>
          <span className="eyebrow accent-eyebrow">Trade laboratory</span>
          <h1>Compare the evidence.<br />Make your own call.</h1>
          <p>Current provider prices and covered production forecasts stay separate. RosterLab no longer manufactures a grade, winner, acceptance chance, or future resale value.</p>
        </div>
        <div className="live-value-chip"><span /> Daily market values</div>
      </section>

      <section className="trade-builder">
        <TradeSide
          side="A"
          team={teamA}
          teams={teams.filter((team) => team.rosterId !== teamBId)}
          selectedIds={selectedA}
          search={searchA}
          onSearch={setSearchA}
          onTeamChange={(id) => { setTeamAId(id); setSelectedA([]) }}
          onToggle={(id) => toggle(selectedA, setSelectedA, id)}
        />
        <TradeVerdict teamA={teamA} teamB={teamB} sideA={assetsA} sideB={assetsB} rosterPositions={rosterPositions} />
        <TradeSide
          side="B"
          team={teamB}
          teams={teams.filter((team) => team.rosterId !== teamAId)}
          selectedIds={selectedB}
          search={searchB}
          onSearch={setSearchB}
          onTeamChange={(id) => { setTeamBId(id); setSelectedB([]) }}
          onToggle={(id) => toggle(selectedB, setSelectedB, id)}
        />
      </section>

      <RosterImpact teamA={teamA} teamB={teamB} sideA={assetsA} sideB={assetsB} rosterPositions={rosterPositions} />
    </main>
  )
}
