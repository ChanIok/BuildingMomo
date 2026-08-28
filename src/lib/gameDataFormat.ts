import type { GameColorMap, GameItem } from '@/types/editor'

export interface ParsedGameData {
  items: GameItem[]
  name?: string
  needRestore?: boolean
}

type JsonObject = Record<string, unknown>
type GameItemWithUnknownFields = GameItem & Record<string, unknown>

interface BuildSnapshot {
  bIsAdd: false
  instanceID: number
  furnitureInfo: {
    group_id: number
    trans: {
      rotation: { y: number; x: number; z: number }
      position: { y: number; x: number; z: number }
      scale: { y: number; x: number; z: number }
    }
    colors: number[]
    cfg_item_id: number
    attach_id: number
  }
  extra: JsonObject
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOwn(value: JsonObject, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

/** 将任意 JSON 值转换为有限数字，转换失败时使用 fallback。 */
function toFiniteNumber(value: unknown, fallback: number): number {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

/** 复制并规范化游戏中的颜色映射，兼容对象和数组两种形式。 */
function normalizeColorMap(value: unknown): GameColorMap | undefined {
  if (Array.isArray(value)) {
    return value.map((entry) => {
      if (entry === null) return null
      const number = Number(entry)
      return Number.isFinite(number) ? number : null
    })
  }

  if (isJsonObject(value)) {
    const result: Record<string, number> = {}
    for (const [key, entry] of Object.entries(value)) {
      const number = Number(entry)
      if (Number.isFinite(number)) {
        result[key] = number
      }
    }
    return result
  }

  return undefined
}

/** 取出内部 ColorMap 中的颜色编码，兼容旧对象和新数组。 */
function colorMapToColors(value: GameColorMap | undefined): number[] {
  const entries = Array.isArray(value) ? value : value ? Object.values(value) : []

  return entries.filter(
    (entry): entry is number => typeof entry === 'number' && entry > 0 && entry % 10 !== 0
  )
}

/** 新版游戏无有效染色时统一写入 [0]，避免写出对象格式或默认编码。 */
function serializeGameColors(value: GameColorMap | undefined): number[] {
  const colors = colorMapToColors(value)
  return colors.length > 0 ? colors : [0]
}

function createGameItem(fields: {
  itemId: unknown
  instanceId: unknown
  groupId: unknown
  attachId: unknown
  location: JsonObject
  rotation: JsonObject
  scale: JsonObject
  colorMap?: GameColorMap
  extras: JsonObject
}): GameItem | null {
  const itemId = toFiniteNumber(fields.itemId, Number.NaN)
  const instanceId = toFiniteNumber(fields.instanceId, Number.NaN)
  if (!Number.isFinite(itemId) || !Number.isFinite(instanceId)) {
    return null
  }

  const item: GameItemWithUnknownFields = {
    ...fields.extras,
    ItemID: itemId,
    InstanceID: instanceId,
    Location: {
      X: toFiniteNumber(fields.location.X, 0),
      Y: toFiniteNumber(fields.location.Y, 0),
      Z: toFiniteNumber(fields.location.Z, 0),
    },
    Rotation: {
      Pitch: toFiniteNumber(fields.rotation.Pitch, 0),
      Yaw: toFiniteNumber(fields.rotation.Yaw, 0),
      Roll: toFiniteNumber(fields.rotation.Roll, 0),
    },
    Scale: {
      X: toFiniteNumber(fields.scale.X, 1),
      Y: toFiniteNumber(fields.scale.Y, 1),
      Z: toFiniteNumber(fields.scale.Z, 1),
    },
    GroupID: toFiniteNumber(fields.groupId, 0),
    AttachID: toFiniteNumber(fields.attachId, 0),
  }

  if (fields.colorMap !== undefined) {
    item.ColorMap = fields.colorMap
  }

  return item
}

/** 将旧版扁平家具条目规范化为内部统一的 GameItem。 */
function normalizeLegacyItem(value: unknown): GameItem | null {
  if (!isJsonObject(value)) return null

  const {
    ItemID: itemId,
    InstanceID: instanceId,
    Location: location,
    Rotation: rotation,
    Scale: scale,
    GroupID: groupId,
    AttachID: attachId,
    ColorMap: colorMap,
    ...extras
  } = value

  return createGameItem({
    itemId,
    instanceId,
    groupId,
    attachId,
    location: isJsonObject(location) ? location : {},
    rotation: isJsonObject(rotation) ? rotation : {},
    scale: isJsonObject(scale) ? scale : {},
    colorMap: normalizeColorMap(colorMap),
    extras,
  })
}

/** 将新版 BuildData/BuildRecord 中的嵌套家具条目规范化。 */
function normalizeBuildSnapshot(value: unknown): GameItem | null {
  if (!isJsonObject(value)) return null

  const furnitureInfo = isJsonObject(value.furnitureInfo) ? value.furnitureInfo : null
  if (!furnitureInfo) return null

  const trans = isJsonObject(furnitureInfo.trans) ? furnitureInfo.trans : {}
  const position = isJsonObject(trans.position) ? trans.position : {}
  const rotation = isJsonObject(trans.rotation) ? trans.rotation : {}
  const scale = isJsonObject(trans.scale) ? trans.scale : {}
  const extras = isJsonObject(value.extra) ? { ...value.extra } : {}

  // 新格式的 rotation 是游戏的 Pitch/Yaw/Roll 语义：x=Pitch、y=Yaw、z=Roll。
  return createGameItem({
    itemId: furnitureInfo.cfg_item_id,
    instanceId: value.instanceID,
    groupId: furnitureInfo.group_id,
    attachId: furnitureInfo.attach_id,
    location: {
      X: position.x,
      Y: position.y,
      Z: position.z,
    },
    rotation: {
      Pitch: rotation.x,
      Yaw: rotation.y,
      Roll: rotation.z,
    },
    scale: {
      X: scale.x,
      Y: scale.y,
      Z: scale.z,
    },
    colorMap: normalizeColorMap(furnitureInfo.colors),
    extras,
  })
}

function normalizeItems(
  value: unknown,
  fieldName: string,
  normalizeItem: (value: unknown) => GameItem | null
): GameItem[] {
  if (Array.isArray(value)) {
    const items = value.map(normalizeItem).filter((item): item is GameItem => item !== null)
    if (fieldName === 'record' && value.length > 0 && items.length === 0) {
      throw new Error('Invalid record format: no valid snapshots')
    }
    return items
  }

  // 游戏在没有该类建造数据时会写出空对象，例如 Snapshots: {}。
  if (isJsonObject(value)) {
    return []
  }

  throw new Error(`Invalid game data format: ${fieldName} must be an array or object`)
}

/**
 * 解析游戏建造数据。
 *
 * 自动识别旧版 PlaceInfo JSON、新版 Snapshots JSON 和新版 BuildRecord 根数组。
 */
export function parseGameDataContent(content: string): ParsedGameData {
  let raw: unknown
  try {
    raw = JSON.parse(content)
  } catch {
    throw new Error('Invalid JSON format: unable to parse content')
  }

  if (Array.isArray(raw)) {
    return {
      items: normalizeItems(raw, 'record', normalizeBuildSnapshot),
    }
  }

  if (!isJsonObject(raw)) {
    throw new Error('Invalid game data format: root is not an object')
  }

  if (hasOwn(raw, 'Snapshots')) {
    return {
      items: normalizeItems(raw.Snapshots, 'Snapshots', normalizeBuildSnapshot),
      name: typeof raw.Name === 'string' && raw.Name.trim() ? raw.Name.trim() : undefined,
      needRestore: typeof raw.NeedRestore === 'boolean' ? raw.NeedRestore : undefined,
    }
  }

  if (hasOwn(raw, 'PlaceInfo')) {
    return {
      items: normalizeItems(raw.PlaceInfo, 'PlaceInfo', normalizeLegacyItem),
      name: typeof raw.Name === 'string' && raw.Name.trim() ? raw.Name.trim() : undefined,
      needRestore: typeof raw.NeedRestore === 'boolean' ? raw.NeedRestore : undefined,
    }
  }

  throw new Error('Invalid game data format: Snapshots or PlaceInfo field not found')
}

function toBuildSnapshot(item: GameItem): BuildSnapshot {
  const source = item as GameItemWithUnknownFields
  const { ItemID, InstanceID, GroupID, AttachID, Location, Rotation, Scale, ColorMap, ...extra } =
    source

  return {
    bIsAdd: false,
    instanceID: InstanceID,
    furnitureInfo: {
      group_id: GroupID,
      trans: {
        rotation: {
          y: Rotation.Yaw,
          x: Rotation.Pitch,
          z: Rotation.Roll,
        },
        position: {
          y: Location.Y,
          x: Location.X,
          z: Location.Z,
        },
        scale: {
          y: Scale.Y,
          x: Scale.X,
          z: Scale.Z,
        },
      },
      colors: serializeGameColors(ColorMap),
      cfg_item_id: ItemID,
      attach_id: AttachID,
    },
    extra,
  }
}

/** 序列化为游戏新的 BuildData JSON 根结构。 */
export function serializeBuildData(gameItems: GameItem[]): string {
  return JSON.stringify({
    NeedRestore: true,
    Snapshots: gameItems.map(toBuildSnapshot),
  })
}

/** 序列化为游戏新的 BuildRecord 根数组结构。 */
export function serializeBuildRecord(gameItems: GameItem[]): string {
  return JSON.stringify(gameItems.map(toBuildSnapshot))
}
