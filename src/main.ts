import { createApp } from 'vue'
import { createPinia } from 'pinia'
import './index.css'
import App from './App.vue'

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

deleteLegacyGLBCache()

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)
app.mount('#app')
