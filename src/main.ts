import { createApp } from 'vue'
import { createPinia } from 'pinia'
import './index.css'
import App from './App.vue'

const SUPPRESSED_THREE_WARNING_MATCHERS = [
  (message: string) =>
    message.includes(
      'THREE.Clock: This module has been deprecated. Please use THREE.Timer instead.'
    ),
  (message: string) =>
    message.includes('THREE.GLTFLoader: Ignoring primitive type .extras') &&
    message.includes('{"targetNames": []}'),
]

function shouldSuppressWarning(args: unknown[]): boolean {
  const firstArg = args[0]
  return (
    typeof firstArg === 'string' &&
    SUPPRESSED_THREE_WARNING_MATCHERS.some((matcher) => matcher(firstArg))
  )
}

function installWarningFilter() {
  const originalWarn = console.warn.bind(console)

  console.warn = (...args: unknown[]) => {
    if (shouldSuppressWarning(args)) return
    originalWarn(...args)
  }
}

// 临时迁移：旧版本曾将 GLB 二进制存入此数据库，后续版本可移除此清理逻辑。
function deleteLegacyGLBCache(): void {
  const request = indexedDB.deleteDatabase('glb-cache')

  request.onerror = () => {
    console.warn('[Startup] Failed to delete legacy GLB cache:', request.error)
  }

  request.onblocked = () => {
    console.warn('[Startup] Legacy GLB cache deletion is blocked by another open tab')
  }
}

installWarningFilter()
deleteLegacyGLBCache()

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)
app.mount('#app')
