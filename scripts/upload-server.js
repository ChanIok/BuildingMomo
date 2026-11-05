#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { loadLocalEnv } from './local-env.js'

const distDir = fileURLToPath(new URL('../dist/', import.meta.url))
const WSL_DISTRO = 'Debian'
const SSH_OPTIONS = [
  '-o',
  'BatchMode=yes',
  '-o',
  'StrictHostKeyChecking=yes',
  '-o',
  'ConnectTimeout=15',
]

function getUploadConfig() {
  const server = process.env.MOMO_UPLOAD_HOST?.trim()
  const directory = process.env.MOMO_UPLOAD_DIR?.trim()
  if (!server || !directory) {
    throw new Error(
      '请在 .env.local 或环境变量中配置 MOMO_UPLOAD_HOST 和 MOMO_UPLOAD_DIR，参见 .env.example。'
    )
  }
  if (!/^(?:[\w][\w.-]*@)?[\w][\w.-]*$/.test(server)) {
    throw new Error('MOMO_UPLOAD_HOST 应为 SSH 别名、主机名或 user@host。')
  }
  if (
    !/^\/[\w./-]+$/.test(directory) ||
    directory.split('/').includes('..') ||
    path.posix.normalize(directory) === '/'
  ) {
    throw new Error('MOMO_UPLOAD_DIR 应为不含空格或 .. 的绝对目录，且不能是根目录。')
  }
  return { server, remoteDir: `${directory.replace(/\/+$/, '')}/` }
}

// 这些文件会让客户端引用新资源，必须等资源上传成功后再发布。
const ENTRY_FILES = [
  'assets/furniture-v2/manifest.json',
  'assets/data/building-momo-furniture.json',
  'assets/data/home-buildable-area.json',
  'manifest.webmanifest',
  'registerSW.js',
  'index.html',
  'en/index.html',
  'sw.js',
]

function runCommand(command, args, { input, capture = false } = {}) {
  const windows = process.platform === 'win32'
  const executable = windows ? 'wsl.exe' : command
  const commandArgs = windows ? ['--distribution', WSL_DISTRO, '--exec', command, ...args] : args
  const result = spawnSync(executable, commandArgs, {
    encoding: 'utf8',
    stdio: [input === undefined ? 'inherit' : 'pipe', capture ? 'pipe' : 'inherit', 'inherit'],
    input,
  })
  if (result.error) throw new Error(`无法启动 ${executable}：${result.error.message}`)
  if (result.status !== 0) {
    throw new Error(
      `${command} 执行失败（${result.signal || `退出码 ${result.status}`}），已停止上传。`
    )
  }
  return result.stdout || ''
}

async function confirmUpload() {
  if (!process.stdin.isTTY)
    throw new Error('上传需要交互确认，请在终端运行；仅预览可使用 --dry-run。')
  const readline = createInterface({ input: process.stdin, output: process.stdout })
  try {
    return (await readline.question('\n确认上传以上变化？[y/N] ')).trim().toLowerCase() === 'y'
  } finally {
    readline.close()
  }
}

async function upload(dryRun) {
  const { server, remoteDir } = getUploadConfig()
  for (const file of ['index.html', 'en/index.html']) {
    const filename = path.join(distDir, file)
    if (!existsSync(filename) || !statSync(filename).isFile()) {
      throw new Error(`缺少 dist/${file}，请先在仓库根目录运行 pnpm build。`)
    }
  }

  const source =
    process.platform === 'win32'
      ? runCommand('wslpath', ['-a', '-u', distDir], { capture: true }).trim()
      : path.resolve(distDir)
  runCommand('rsync', ['--version'], { capture: true })
  runCommand('ssh', [
    ...SSH_OPTIONS,
    server,
    `command -v rsync >/dev/null || { echo '服务器缺少 rsync，请先安装。' >&2; exit 1; }; ` +
      `test -d ${remoteDir} && test -w ${remoteDir} || { echo '上传目录不存在或不可写：${remoteDir}' >&2; exit 1; }`,
  ])

  const common = [
    '-rt',
    '--omit-dir-times',
    '--human-readable',
    '--itemize-changes',
    '--stats',
    '--delay-updates',
    '--partial-dir=.rsync-partial',
    '--rsh',
    `ssh ${SSH_OPTIONS.join(' ')}`,
  ]
  const sourceDir = `${source.replace(/\/$/, '')}/`
  const destination = `${server}:${remoteDir}`
  const entryFiles = ENTRY_FILES.filter((file) => existsSync(path.join(distDir, file)))
  const phases = [
    {
      label: '资源',
      args: ENTRY_FILES.map((file) => `--exclude=/${file}`),
    },
    {
      label: '入口和资源清单',
      args: ['--from0', '--files-from=-'],
      input: `${entryFiles.join('\0')}\0`,
    },
  ]

  function synchronize(preview) {
    for (const phase of phases) {
      console.log(`\n${preview ? '预览' : '上传'}：${phase.label}`)
      runCommand(
        'rsync',
        [...common, ...(preview ? ['--dry-run'] : []), ...phase.args, sourceDir, destination],
        { input: phase.input }
      )
    }
  }

  console.log(`上传目标：${destination}`)
  console.log('仅同步新增和变化文件，不删除服务器旧文件，不构建或重启服务。')
  synchronize(true)
  if (dryRun) {
    console.log('\n预览结束，未上传文件。统计体积为变化文件总大小，实际差分传输可能更小。')
    return
  }
  if (!(await confirmUpload())) {
    console.log('已取消，未上传文件。')
    return
  }
  synchronize(false)
  console.log('\n上传完成。')
}

async function main() {
  const { values } = parseArgs({
    options: { 'dry-run': { type: 'boolean' }, help: { type: 'boolean' } },
  })
  if (values.help) {
    console.log(
      '用法：pnpm upload:server [--dry-run]\n默认预览后确认上传；--dry-run 只预览。Windows 使用 WSL Debian 的 rsync 和 SSH。'
    )
    return
  }
  loadLocalEnv()
  await upload(values['dry-run'])
}

main().catch((error) => {
  console.error(`[upload-server] ${error.message}`)
  process.exitCode = 1
})
