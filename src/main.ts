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
    message.includes('PCFSoftShadowMap has been deprecated. Using PCFShadowMap instead.'),
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

installWarningFilter()

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)
app.mount('#app')
