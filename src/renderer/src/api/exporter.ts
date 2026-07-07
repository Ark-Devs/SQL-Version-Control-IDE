import { post } from './client'

export interface ExportFile {
  path: string
  status: 'added' | 'updated' | 'unchanged'
}

export interface ExportResult {
  files: ExportFile[] | null
  skippedEncrypted: string[] | null
  warnings: string[] | null
}

/** Script procs/functions/views from a live database into a `sql/` folder inside an application project. */
export const exporterApi = {
  export: (folder: string, connId: string, databases: string[]) =>
    post<ExportResult>('/export', { folder, connId, databases })
}
