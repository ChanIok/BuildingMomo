import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline/promises'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const DEFAULT_ROOT = path.resolve(__dirname, '../public/assets/furniture-v2')
const ASSET_DIRS = ['models-full', 'models-lite', 'textures']

function parseArgs(argv) {
  let targetDir = null
  let yes = false
  let dryRun = false
  let help = false

  for (const arg of argv) {
    if (arg === '-y' || arg === '--yes') {
      yes = true
    } else if (arg === '--dry-run') {
      dryRun = true
    } else if (arg === '-h' || arg === '--help') {
      help = true
    } else if (arg.startsWith('-')) {
      throw new Error(`未知参数: ${arg}`)
    } else if (!targetDir) {
      targetDir = arg
    } else {
      throw new Error(`多余的位置参数: ${arg}`)
    }
  }

  return {
    root: path.resolve(targetDir ?? DEFAULT_ROOT),
    yes,
    dryRun,
    help,
  }
}

function collectReferencedPaths(manifest) {
  if (!manifest || typeof manifest !== 'object') {
    throw new Error('manifest.json 格式无效')
  }
  if (!manifest.bundles || typeof manifest.bundles !== 'object') {
    throw new Error('manifest.json 缺少有效的 bundles 字段')
  }
  if (!Array.isArray(manifest.furniture)) {
    throw new Error('manifest.json 缺少有效的 furniture 数组')
  }

  const referenced = new Set(Object.keys(manifest.bundles).map((name) => `textures/${name}.bin`))

  for (const furniture of manifest.furniture) {
    for (const mesh of furniture.meshes ?? []) {
      for (const asset of Object.values(mesh.models ?? {})) {
        if (asset?.path) referenced.add(asset.path)
      }
    }
    for (const asset of Object.values(furniture.prepared ?? {})) {
      if (asset?.path) referenced.add(asset.path)
    }
  }

  return referenced
}

function collectFilesRecursively(dir) {
  if (!fs.existsSync(dir)) return []

  const files = []
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...collectFilesRecursively(fullPath))
    } else if (entry.isFile()) {
      files.push(fullPath)
    }
  }
  return files
}

function toPosixRelative(root, target) {
  return path.relative(root, target).split(path.sep).join('/')
}

function findUnusedAssets(root, referenced) {
  const unused = []

  for (const dir of ASSET_DIRS) {
    const files = collectFilesRecursively(path.join(root, dir)).sort((a, b) => a.localeCompare(b))
    for (const filePath of files) {
      if (!referenced.has(toPosixRelative(root, filePath))) {
        unused.push({
          dir,
          filePath,
          size: fs.statSync(filePath).size,
        })
      }
    }
  }

  return unused
}

function formatMB(bytes) {
  return (bytes / (1024 * 1024)).toFixed(2)
}

function printSummary(unused) {
  const byDir = new Map()
  let totalBytes = 0

  for (const item of unused) {
    const current = byDir.get(item.dir) ?? { count: 0, bytes: 0 }
    current.count += 1
    current.bytes += item.size
    byDir.set(item.dir, current)
    totalBytes += item.size
  }

  for (const [dir, stats] of byDir) {
    console.log(`  - ${dir}: ${stats.count} 个 (${formatMB(stats.bytes)} MB)`)
  }
  console.log(`共计 ${unused.length} 个未引用文件，约 ${formatMB(totalBytes)} MB`)
}

async function confirmDeletion(count) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })
  try {
    const answer = await rl.question(`删除以上 ${count} 个文件？[y/N] `)
    return answer.trim().toLowerCase() === 'y'
  } finally {
    rl.close()
  }
}

async function main() {
  const { root, yes, dryRun, help } = parseArgs(process.argv.slice(2))

  if (help) {
    console.log('用法: node scripts/purge-old-assets.js [资产目录] [--dry-run] [-y|--yes]')
    console.log(`默认目录: ${DEFAULT_ROOT}`)
    return
  }

  const manifestPath = path.join(root, 'manifest.json')
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`未找到 manifest.json: ${manifestPath}`)
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  const referenced = collectReferencedPaths(manifest)
  if (referenced.size === 0) {
    throw new Error('manifest.json 未解析出任何引用资产，已中止以防误删')
  }

  const unused = findUnusedAssets(root, referenced)
  if (unused.length === 0) {
    console.log('没有多余的资产文件')
    return
  }

  for (const item of unused) {
    console.log(item.filePath)
  }

  console.log()
  printSummary(unused)

  if (dryRun) {
    console.log('dry-run 模式：未删除任何文件')
    return
  }

  if (!yes) {
    const confirmed = await confirmDeletion(unused.length)
    if (!confirmed) {
      console.log('操作已取消')
      return
    }
  }

  let freedBytes = 0
  for (const item of unused) {
    fs.unlinkSync(item.filePath)
    freedBytes += item.size
  }

  console.log(`已删除 ${unused.length} 个文件，释放 ${formatMB(freedBytes)} MB`)
}

main().catch((error) => {
  console.error(`[purge-old-assets] ${error.message}`)
  process.exit(1)
})
