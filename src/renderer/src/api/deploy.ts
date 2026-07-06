import { post } from './client'

export interface DeployStep {
  path: string
  schema: string
  name: string
  type: string
  sql: string
}

export interface DeployPlan {
  id: string
  ref: string
  targetConnId: string
  targetDb: string
  steps: DeployStep[] | null
  warnings: string[] | null
}

export interface DeployStepResult {
  path: string
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
  plan: (ref: string, paths: string[], targetConnId: string, targetDb: string) =>
    post<DeployPlan>('/deploy/plan', { ref, paths, targetConnId, targetDb }),
  execute: (planId: string) => post<DeployResult>(`/deploy/${encodeURIComponent(planId)}/execute`)
}
