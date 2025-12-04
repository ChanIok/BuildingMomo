import * as Comlink from 'comlink'
import type { WorkspaceWorkerApi } from './workspace.worker'
import Worker from './workspace.worker?worker'

const worker = new Worker()
export const workerApi = Comlink.wrap<WorkspaceWorkerApi>(worker)

// Listen for messages from worker (e.g., save completion)
worker.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SAVE_COMPLETE') {
    console.log(
      '[Persistence] Snapshot saved (Worker)',
      new Date(event.data.timestamp).toLocaleTimeString()
    )
  }
})
