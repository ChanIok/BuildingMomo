import { createApp } from 'vue'
import { createPinia } from 'pinia'
import './index.css'
import App from './App.vue'

const SUPPRESSED_THREE_WARNINGS = [
  'THREE.Clock: This module has been deprecated. Please use THREE.Timer instead.',
  'PCFSoftShadowMap has been deprecated. Using PCFShadowMap instead.',
]

function installWarningFilter() {
  const originalWarn = console.warn.bind(console)

  console.warn = (...args: unknown[]) => {
    const firstArg = args[0]
    const shouldSuppress =
      typeof firstArg === 'string' &&
      SUPPRESSED_THREE_WARNINGS.some((pattern) => firstArg.includes(pattern))

    if (shouldSuppress) return
    originalWarn(...args)
  }
}

installWarningFilter()

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)
app.mount('#app')
