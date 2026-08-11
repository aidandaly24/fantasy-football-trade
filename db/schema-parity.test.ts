import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const MIGRATION_ONLY_TABLES = new Set([
  // Historical journal schema. Identity is now stored season-correctly in
  // season_rosters; do not add another live writer without a migration plan.
  'season_users',
  // Retained in migration history for old data; the unvalidated projection
  // snapshot writer and reader have been removed from the live product.
  'edge_opportunity_snapshots',
])

function filesUnder(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry)
    return statSync(path).isDirectory() ? filesUnder(path) : [path]
  })
}

function matches(source: string, pattern: RegExp): string[] {
  return [...source.matchAll(pattern)].map((match) => match[1])
}

describe('D1 schema parity', () => {
  it('keeps Drizzle, migrations, and defensive runtime tables aligned', () => {
    const root = process.cwd()
    const schemaSource = readFileSync(join(root, 'db/schema.ts'), 'utf8')
    const schemaTables = new Set(matches(schemaSource, /sqliteTable\s*\(\s*['"]([a-z0-9_]+)['"]/g))

    const workerSource = filesUnder(join(root, 'worker'))
      .filter((path) => path.endsWith('.ts') && !path.endsWith('.test.ts'))
      .map((path) => readFileSync(path, 'utf8'))
      .join('\n')
    const runtimeTables = new Set(matches(workerSource, /CREATE TABLE IF NOT EXISTS\s+([a-z0-9_]+)/gi))

    const migrationSource = filesUnder(join(root, 'drizzle'))
      .filter((path) => path.endsWith('.sql'))
      .map((path) => readFileSync(path, 'utf8'))
      .join('\n')
    const migrationTables = new Set(matches(migrationSource, /CREATE TABLE\s+[`"]?([a-z0-9_]+)/gi))

    const expectedRuntimeTables = [...schemaTables]
      .filter((table) => !MIGRATION_ONLY_TABLES.has(table))
      .sort()

    expect([...runtimeTables].sort()).toEqual(expectedRuntimeTables)
    expect([...schemaTables].filter((table) => !migrationTables.has(table))).toEqual([])
    expect([...MIGRATION_ONLY_TABLES].filter((table) => runtimeTables.has(table))).toEqual([])
  })
})
