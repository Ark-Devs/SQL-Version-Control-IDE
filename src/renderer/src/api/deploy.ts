import { post } from './client'

export interface DeployStep {
  path: string
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
  steps: DeployStep[] | null
  warnings: string[] | null
}

export interface DeployStepResult {
  path: string
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
  plan: (ref: string, paths: string[], targetConnId: string) =>
    post<DeployPlan>('/deploy/plan', { ref, paths, targetConnId }),
  execute: (planId: string) => post<DeployResult>(`/deploy/${encodeURIComponent(planId)}/execute`)
}
