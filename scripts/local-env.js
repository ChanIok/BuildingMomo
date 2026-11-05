import { existsSync } from 'node:fs'
import { loadEnvFile } from 'node:process'
import { fileURLToPath } from 'node:url'

export function loadLocalEnv() {
  const filename = fileURLToPath(new URL('../.env.local', import.meta.url))
  if (existsSync(filename)) loadEnvFile(filename)
}
