import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
if (args.length > 1 || (args.length === 1 && args[0] !== '--release')) {
  console.error('用法：pnpm run build:cpp [--release]')
  process.exit(1)
}

const mode = args.includes('--release') ? 'release' : 'debug'
const cwd = fileURLToPath(new URL('../desktop/', import.meta.url))

function run(args) {
  const result = spawnSync('xmake', args, { cwd, stdio: 'inherit' })
  if (result.error) {
    console.error(`无法执行 xmake：${result.error.message}`)
    process.exit(1)
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

console.log(`BuildingMomo C++：${mode} 构建`)
run(['f', '-p', 'windows', '-a', 'x64', '-m', mode])
run(['build', 'BuildingMomo'])
