import { post } from './client'

export interface DeployStep {
  path: string
  /** repo-side source identity; shown alongside database when they differ */
  alias: string
  database: string
  schema: string
  name: string
  type: string
  sql: string
}

export interface DeployPlan {
  id: string
  ref: string
  targetConnId: string
  /** alias → connection id, when steps deploy to each source's own server
   *  rather than one explicit target */
  targets?: Record<string, string>
  steps: DeployStep[] | null
  warnings: string[] | null
}

export interface DeployStepResult {
  path: string
  alias: string
  database: string
  object: string
  ok: boolean
  error?: string
}

export interface DeployResult {
  committed: boolean
  steps: DeployStepResult[] | null
  error?: string
  elapsedMs: number
}

export const deployApi = {
  /** One explicit target for every step (e.g. "deploy this branch to staging"). */
  plan: (ref: string, paths: string[], targetConnId: string) =>
    post<DeployPlan>('/deploy/plan', { ref, paths, targetConnId }),
  /** Each step deploys to its own source's bound connection (alias → connId) —
   *  used to apply a branch's changes back to the databases it came from. */
  planForSources: (ref: string, paths: string[], targets: Record<string, string>) =>
    post<DeployPlan>('/deploy/plan', { ref, paths, targets }),
  execute: (planId: string) => post<DeployResult>(`/deploy/${encodeURIComponent(planId)}/execute`)
}
