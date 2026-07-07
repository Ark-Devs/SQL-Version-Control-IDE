import { get } from './client'

export interface SearchHit {
  database: string
  schema: string
  name: string
  type: 'table' | 'view' | 'proc' | 'tvf' | 'scalar' | 'trigger'
  match: 'name' | 'definition'
  snippet: string
}

export interface SearchResult {
  results: SearchHit[] | null
  truncated: boolean
  errors: string[] | null
}

export const searchApi = {
  search: (connId: string, q: string, db?: string) =>
    get<SearchResult>(
      `/search/${encodeURIComponent(connId)}?q=${encodeURIComponent(q)}${db ? `&db=${encodeURIComponent(db)}` : ''}`
    )
}
