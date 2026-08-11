import type { D1Database } from './user-store'

export interface AssetsBinding {
  fetch(request: Request): Promise<Response>
}
export interface Env {
  ASSETS: AssetsBinding
  DB?: D1Database
}
