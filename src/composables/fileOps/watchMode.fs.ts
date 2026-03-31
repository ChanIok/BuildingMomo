// 匹配游戏存档文件名，格式：BUILD_SAVEDATA_<uid>.json 或 WORLDBUILD_SAVEDATA_<uid>.json
const SAVE_DATA_FILENAME_REGEX = /^(BUILD|WORLDBUILD)_SAVEDATA_(\d+)\.json$/
// 匹配游戏 BuildRecord 文件名，格式：<数字>.record
const BUILD_RECORD_FILENAME_REGEX = /^\d+\.record$/

export type LatestFileResult = {
  file: File
  handle: FileSystemFileHandle
}

export { SAVE_DATA_FILENAME_REGEX }

export async function findX6GameDirectory(
  dirHandle: FileSystemDirectoryHandle
): Promise<FileSystemDirectoryHandle | null> {
  if (dirHandle.name === 'X6Game') {
    return dirHandle
  }

  try {
    return await dirHandle.getDirectoryHandle('X6Game')
  } catch {
    return null
  }
}

/** 从存档文件名中提取 UID（例如 "BUILD_SAVEDATA_123.json" → "123"） */
export function extractUidFromSaveDataFilename(filename: string): string | null {
  const match = filename.match(SAVE_DATA_FILENAME_REGEX)
  return match?.[2] ?? null
}

/** 判断文件名是否为游戏存档文件 */
export function isBuildSaveDataFile(name: string): boolean {
  return SAVE_DATA_FILENAME_REGEX.test(name)
}

/** 判断文件名是否为 BuildRecord 文件 */
export function isBuildRecordFile(name: string): boolean {
  return BUILD_RECORD_FILENAME_REGEX.test(name)
}

/**
 * 从起始目录句柄出发，依次进入 pathParts 指定的子目录。
 * 任何一层不存在则返回 null。
 */
async function resolvePath(
  startHandle: FileSystemDirectoryHandle,
  pathParts: string[]
): Promise<FileSystemDirectoryHandle | null> {
  let currentHandle = startHandle
  for (const part of pathParts) {
    try {
      currentHandle = await currentHandle.getDirectoryHandle(part)
    } catch {
      return null
    }
  }
  return currentHandle
}

/**
 * 在用户选择的目录中定位目标子目录（BuildData 或 BuildRecord）。
 *
 * 支持多种目录结构，依次尝试：
 *   1. 用户直接选择的就是目标目录
 *   2. 目标目录直接位于选择目录下
 *   3. 游戏安装路径下的常见相对路径：
 *      - X6Game/Saved/SavedData/<target>
 *      - Saved/SavedData/<target>
 *      - SavedData/<target>
 */
async function findGameSubDirectory(
  dirHandle: FileSystemDirectoryHandle,
  targetDirectoryName: 'BuildData' | 'BuildRecord'
): Promise<FileSystemDirectoryHandle | null> {
  if (dirHandle.name === targetDirectoryName) {
    return dirHandle
  }

  try {
    return await dirHandle.getDirectoryHandle(targetDirectoryName)
  } catch {
    // continue
  }

  const candidatePaths: Array<{ root: string; parts: string[] }> = [
    { root: 'X6Game', parts: ['Saved', 'SavedData', targetDirectoryName] },
    { root: 'Saved', parts: ['SavedData', targetDirectoryName] },
    { root: 'SavedData', parts: [targetDirectoryName] },
  ]

  for (const { root, parts } of candidatePaths) {
    try {
      const rootHandle = await dirHandle.getDirectoryHandle(root)
      const resolved = await resolvePath(rootHandle, parts)
      if (resolved) return resolved
    } catch {
      // continue
    }
  }

  return null
}

/** 在用户选择目录中定位 BuildData 目录（存放 SAVEDATA JSON 文件） */
export async function findBuildDataDirectory(
  dirHandle: FileSystemDirectoryHandle
): Promise<FileSystemDirectoryHandle | null> {
  return findGameSubDirectory(dirHandle, 'BuildData')
}

/** 在用户选择目录中定位 BuildRecord 目录（存放 .record 文件） */
export async function findBuildRecordDirectory(
  dirHandle: FileSystemDirectoryHandle
): Promise<FileSystemDirectoryHandle | null> {
  return findGameSubDirectory(dirHandle, 'BuildRecord')
}

/**
 * 扫描目录下所有符合 matcher 条件的文件，返回 lastModified 最新的一个。
 * label 仅用于错误日志标识。
 */
async function findLatestFile(
  dirHandle: FileSystemDirectoryHandle,
  matcher: (name: string) => boolean,
  label: string
): Promise<LatestFileResult | null> {
  let latest: LatestFileResult | null = null

  try {
    for await (const entry of (dirHandle as any).values()) {
      if (entry.kind !== 'file' || !matcher(entry.name)) continue

      const handle = entry as FileSystemFileHandle
      const file = await handle.getFile()

      if (!latest || file.lastModified > latest.file.lastModified) {
        latest = { file, handle }
      }
    }
  } catch (error) {
    console.error(`Failed to scan ${label} directory:`, error)
    return null
  }

  return latest
}

/** 在 BuildData 目录中找到最新修改的存档文件 */
export async function findLatestBuildSaveData(
  buildDataDir: FileSystemDirectoryHandle
): Promise<LatestFileResult | null> {
  return findLatestFile(buildDataDir, isBuildSaveDataFile, 'BuildData')
}

/** 在 BuildRecord 目录中找到最新修改的 .record 文件 */
export async function findLatestBuildRecord(
  buildRecordDir: FileSystemDirectoryHandle
): Promise<LatestFileResult | null> {
  return findLatestFile(buildRecordDir, isBuildRecordFile, 'BuildRecord')
}
