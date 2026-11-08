import { useEditorStore } from '@/stores/editorStore'
import { toRaw } from 'vue'
import { useEditorHistory } from './useEditorHistory'
import { createPlacedItem } from './useEditorItemAdd'
import { reconcileGroupOrigins, setSchemeItems } from '@/lib/groupState'
import { matrixTransform } from '@/lib/matrixTransform'
import {
  dataScaleToVisualScale,
  scaleItemsAroundPivot,
  visualScaleToDataScale,
} from '@/lib/selectionScaleTransform'
import { createSelectionTransformFrame, translateItems } from '@/lib/selectionTransform'
import { rotateItemsInWorkingCoordinate } from '@/lib/rotationTransform'
import { remapColorMapGroupIds } from '@/lib/colorMap'
import { SceneAnalysisError, type AnalysisVector3 } from '@/lib/sceneAnalysis/types'
import {
  invalidInput,
  readObject,
  readString,
  readStrings,
  readVector,
} from '@/lib/sceneAnalysis/validation'
import type { AppItem, HomeScheme } from '@/types/editor'
import type { FurnitureItem } from '@/types/furniture'

/** AI DTO 使用世界厘米（Z 向上）、视觉角度与视觉轴，与 api.items() 完全一致。 */
export interface SceneItemPatch {
  itemId: string
  position?: AnalysisVector3
  rotation?: AnalysisVector3
  scale?: AnalysisVector3
  gameId?: number
  groupId?: number
}

export interface SceneItemPlacement {
  gameId: number
  position: AnalysisVector3
  rotation?: AnalysisVector3
  scale?: AnalysisVector3
  groupId?: number
}

export interface SceneRotateCommand {
  kind: 'rotate'
  itemIds: string[]
  delta: AnalysisVector3
  pivot: AnalysisVector3
}

export interface SceneTranslateCommand {
  kind: 'translate'
  itemIds: string[]
  delta: AnalysisVector3
}

export interface SceneScaleCommand {
  kind: 'scale'
  itemIds: string[]
  factors: AnalysisVector3
  pivot: AnalysisVector3
}

export interface SceneDuplicateCommand {
  kind: 'duplicate'
  itemIds: string[]
  offsets: AnalysisVector3[]
}

export type SceneEditCommand =
  | { kind: 'edit'; items: SceneItemPatch[] }
  | { kind: 'place'; items: SceneItemPlacement[] }
  | { kind: 'remove'; itemIds: string[] }
  | SceneRotateCommand
  | SceneTranslateCommand
  | SceneScaleCommand
  | SceneDuplicateCommand

export interface SceneEditResult {
  kind: SceneEditCommand['kind']
  itemIds: string[]
  itemIdGroups?: string[][]
  count: number
  transactionId?: string
}

interface EditFields {
  position?: AnalysisVector3
  rotation?: AnalysisVector3
  scale?: AnalysisVector3
  gameId?: number
  groupId?: number
}

const editKeys = ['itemId', 'gameId', 'position', 'rotation', 'scale', 'groupId'] as const
const placeKeys = ['gameId', 'position', 'rotation', 'scale', 'groupId'] as const

function readFields(spec: Record<string, unknown>): EditFields {
  const fields: EditFields = {}
  if (spec.position !== undefined) fields.position = readVector(spec.position)
  if (spec.rotation !== undefined) fields.rotation = readVector(spec.rotation)
  if (spec.scale !== undefined) fields.scale = readVector(spec.scale)
  if (spec.gameId !== undefined) {
    if (!Number.isSafeInteger(spec.gameId) || (spec.gameId as number) <= 0)
      invalidInput('gameId must be a positive integer')
    fields.gameId = spec.gameId as number
  }
  if (spec.groupId !== undefined) {
    if (!Number.isSafeInteger(spec.groupId)) invalidInput('groupId must be an integer')
    fields.groupId = spec.groupId as number
  }
  return fields
}

/** 校验输入形状；宿主提供目录时同时校验家具存在、旋转权限和缩放范围。 */
export function readSceneEditCommand(value: unknown): SceneEditCommand {
  const raw = readObject(value, [
    'kind',
    'items',
    'itemIds',
    'delta',
    'factors',
    'pivot',
    'offsets',
  ])
  if (raw.kind === 'remove') {
    const itemIds = readStrings(raw.itemIds, 'item IDs')
    if (!itemIds.length) invalidInput('remove expects a nonempty itemIds array')
    return { kind: 'remove', itemIds }
  }
  if (raw.kind !== 'edit' && raw.kind !== 'place') {
    if (raw.kind === 'duplicate') {
      const itemIds = readStrings(raw.itemIds, 'item IDs')
      if (!itemIds.length) invalidInput('duplicate expects a nonempty itemIds array')
      if (!Array.isArray(raw.offsets) || !raw.offsets.length)
        invalidInput('duplicate expects a nonempty offsets array')
      if (raw.offsets.length > 100) invalidInput('duplicate accepts at most 100 offsets')
      const offsets = raw.offsets.map((offset, index) => {
        try {
          return readVector(offset)
        } catch (error) {
          invalidInput(
            `offsets[${index}]: ${error instanceof Error ? error.message : String(error)}`
          )
        }
      })
      return { kind: 'duplicate', itemIds, offsets }
    }
    if (raw.kind === 'rotate' || raw.kind === 'translate' || raw.kind === 'scale') {
      const itemIds = readStrings(raw.itemIds, 'item IDs')
      if (!itemIds.length) invalidInput(`${raw.kind} expects a nonempty itemIds array`)
      if (raw.kind === 'translate')
        return { kind: 'translate', itemIds, delta: readVector(raw.delta) }
      const pivot = readVector(raw.pivot)
      if (raw.kind === 'rotate')
        return { kind: 'rotate', itemIds, delta: readVector(raw.delta), pivot }
      const factors = readVector(raw.factors)
      if ([factors.x, factors.y, factors.z].some((value) => value <= 0))
        invalidInput('scale factors must be positive')
      return { kind: 'scale', itemIds, factors, pivot }
    }
    invalidInput('kind must be edit, place, remove, rotate, translate or scale')
  }
  if (!Array.isArray(raw.items) || !raw.items.length)
    invalidInput(`${raw.kind} expects a nonempty items array`)
  const entries = raw.items as unknown[]

  if (raw.kind === 'place') {
    const items: SceneItemPlacement[] = entries.map((entry, index) => {
      try {
        const fields = readFields(readObject(entry, placeKeys))
        if (fields.gameId === undefined) invalidInput('gameId is required')
        if (fields.position === undefined) invalidInput('position is required')
        return { ...fields, gameId: fields.gameId, position: fields.position }
      } catch (error) {
        invalidInput(`items[${index}]: ${error instanceof Error ? error.message : String(error)}`)
      }
    })
    return { kind: 'place', items }
  }

  const items: SceneItemPatch[] = entries.map((entry, index) => {
    try {
      const spec = readObject(entry, editKeys)
      return { itemId: readString(spec.itemId, 'itemId'), ...readFields(spec) }
    } catch (error) {
      invalidInput(`items[${index}]: ${error instanceof Error ? error.message : String(error)}`)
    }
  })
  if (new Set(items.map((item) => item.itemId)).size !== items.length)
    invalidInput('Duplicate item IDs in one edit')
  return { kind: 'edit', items }
}

export interface SceneEditRules {
  isReady: () => boolean
  getFurniture: (gameId: number) => FurnitureItem | null
  getScaleRange: (gameId: number) => [number, number] | null
}

const ROTATION_EPSILON = 1e-6

function validateRotation(gameId: number, rotation: AnalysisVector3, furniture: FurnitureItem) {
  const allowed = furniture.rotationAllowed
  if (!allowed.x && Math.abs(rotation.x) > ROTATION_EPSILON)
    invalidInput(`Furniture ${gameId} does not allow visual X rotation`)
  if (!allowed.y && Math.abs(rotation.y) > ROTATION_EPSILON)
    invalidInput(`Furniture ${gameId} does not allow visual Y rotation`)
  if (!allowed.z && Math.abs(rotation.z) > ROTATION_EPSILON)
    invalidInput(`Furniture ${gameId} does not allow visual Z rotation`)
}

function validateScale(gameId: number, scale: AnalysisVector3, rules: SceneEditRules) {
  const range = rules.getScaleRange(gameId)
  if (!range) return
  if ([scale.x, scale.y, scale.z].some((value) => value < range[0] || value > range[1]))
    invalidInput(`Furniture ${gameId} scale must stay within ${range[0]}..${range[1]}`)
}

function sameVector(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number }
) {
  return a.x === b.x && a.y === b.y && a.z === b.z
}

/** 不可变写回：只有真正变化的层级生成新引用，未变化的家具保留原引用。 */
function applyPatch(item: AppItem, patch: SceneItemPatch): AppItem {
  const position = patch.position
    ? matrixTransform.worldPositionToData(patch.position)
    : { x: item.x, y: item.y, z: item.z }
  const rotation = patch.rotation
    ? matrixTransform.visualRotationToData(patch.rotation)
    : item.rotation
  const currentScale = item.extra.Scale ?? { X: 1, Y: 1, Z: 1 }
  const scale = patch.scale ? visualScaleToDataScale(patch.scale) : currentScale
  const gameId = patch.gameId ?? item.gameId
  const groupId = patch.groupId ?? item.groupId
  const positionChanged = !sameVector(position, item)
  const rotationChanged = !sameVector(rotation, item.rotation)
  const scaleChanged =
    scale.X !== currentScale.X || scale.Y !== currentScale.Y || scale.Z !== currentScale.Z
  if (
    !positionChanged &&
    !rotationChanged &&
    !scaleChanged &&
    gameId === item.gameId &&
    groupId === item.groupId
  )
    return item

  return {
    ...item,
    x: position.x,
    y: position.y,
    z: position.z,
    rotation: rotationChanged ? { ...rotation } : item.rotation,
    gameId,
    groupId,
    extra: scaleChanged ? { ...item.extra, Scale: { ...scale } } : item.extra,
  }
}

/** 编辑前后按明确成员 ID 比对状态，供崩溃后判断结果是否仍然成立。 */
export function sceneEditPostcondition(scheme: HomeScheme, itemIds: string[]) {
  const byId = new Map(scheme.items.value.map((item) => [item.internalId, item]))
  const state = itemIds.map((id) => {
    const item = byId.get(id)
    if (!item) return [id, null]
    const scale = item.extra.Scale ?? { X: 1, Y: 1, Z: 1 }
    return [
      id,
      item.gameId,
      item.x,
      item.y,
      item.z,
      item.rotation.x,
      item.rotation.y,
      item.rotation.z,
      scale.X,
      scale.Y,
      scale.Z,
      item.groupId,
    ]
  })
  return JSON.stringify({ kind: 'scene', itemIds, state })
}

export function verifySceneEdit(scheme: HomeScheme | null | undefined, postcondition: string) {
  if (!scheme) return false
  try {
    const saved = JSON.parse(postcondition)
    if (saved.kind !== 'scene' || !Array.isArray(saved.itemIds)) return false
    return sceneEditPostcondition(scheme, saved.itemIds) === postcondition
  } catch {
    return false
  }
}

/** Explicit member IDs, never the changing UI selection. One call, one history entry. */
export function useEditorSceneEdit(rules: SceneEditRules) {
  const editor = useEditorStore()
  const { recordTransaction } = useEditorHistory()

  function furnitureRule(gameId: number) {
    if (!rules.isReady()) throw new SceneAnalysisError('unavailable', 'Furniture data is not ready')
    const furniture = rules.getFurniture(gameId)
    if (!furniture) invalidInput(`Unknown furniture gameId: ${gameId}`)
    return furniture
  }

  function validateItem(item: AppItem) {
    const furniture = furnitureRule(item.gameId)
    validateRotation(item.gameId, matrixTransform.dataRotationToVisual(item.rotation), furniture)
    validateScale(item.gameId, dataScaleToVisualScale(item.extra.Scale), rules)
  }

  function worldDeltaToData(delta: AnalysisVector3) {
    const origin = matrixTransform.worldPositionToData({ x: 0, y: 0, z: 0 })
    const target = matrixTransform.worldPositionToData(delta)
    return { x: target.x - origin.x, y: target.y - origin.y, z: target.z - origin.z }
  }

  function apply(
    parameters: unknown,
    expected: { schemeId: string; sceneVersion: number }
  ): SceneEditResult {
    const scheme = editor.getSchemeById(expected.schemeId)
    function assertCurrent() {
      if (
        !scheme ||
        editor.getSchemeById(expected.schemeId) !== scheme ||
        scheme.id !== expected.schemeId ||
        editor.sceneVersion !== expected.sceneVersion
      ) {
        throw new SceneAnalysisError('stale_snapshot', 'Scene changed before editing items')
      }
    }
    assertCurrent()
    if (!scheme) throw new SceneAnalysisError('unavailable', 'No such scheme')
    const command = readSceneEditCommand(parameters)
    const editable = editor.getEditableItemIds(scheme)
    const touched =
      command.kind === 'remove' ||
      command.kind === 'rotate' ||
      command.kind === 'translate' ||
      command.kind === 'scale' ||
      command.kind === 'duplicate'
        ? command.itemIds
        : command.kind === 'edit'
          ? command.items.map((item) => item.itemId)
          : []
    if (touched.some((id) => !editable.has(id)))
      throw new SceneAnalysisError('out_of_scope', 'Scope contains missing, hidden or locked items')

    // All fallible input/structure calculations precede the synchronous commit.
    const previous = scheme.items.value
    const structureChanged =
      command.kind === 'place' ||
      command.kind === 'remove' ||
      command.kind === 'duplicate' ||
      (command.kind === 'edit' && command.items.some((item) => item.groupId !== undefined))
    let nextItems: AppItem[]
    let maxInstanceId = scheme.maxInstanceId.value
    let maxGroupId = scheme.maxGroupId.value
    let itemIds: string[] = []
    let nextGroupOrigins = scheme.groupOrigins.value
    let nextCollectionTree = scheme.collectionTree.value

    let itemIdGroups: string[][] | undefined
    if (command.kind === 'place') {
      const prepared = command.items.map((spec) => {
        const furniture = furnitureRule(spec.gameId)
        const rotation = spec.rotation ?? { x: 0, y: 0, z: 0 }
        const scale = spec.scale ?? { x: 1, y: 1, z: 1 }
        if (furniture) {
          validateRotation(spec.gameId, rotation, furniture)
          validateScale(spec.gameId, scale, rules)
          if (
            furniture.combination?.length &&
            (rotation.x !== 0 ||
              rotation.y !== 0 ||
              rotation.z !== 0 ||
              scale.x !== 1 ||
              scale.y !== 1 ||
              scale.z !== 1)
          )
            invalidInput(
              `Combination furniture ${spec.gameId} only accepts default rotation and scale`
            )
        }
        return { spec, furniture }
      })
      const itemCount = prepared.reduce(
        (count, { furniture }) => count + (furniture?.combination?.length || 1),
        0
      )
      if (!Number.isSafeInteger(maxInstanceId + itemCount))
        invalidInput('Instance ID allocator exhausted')
      const created: AppItem[] = []
      for (const { spec, furniture } of prepared) {
        if (spec.groupId !== undefined) maxGroupId = Math.max(maxGroupId, spec.groupId)
        const position = matrixTransform.worldPositionToData(spec.position)
        if (furniture?.combination?.length) {
          const groupId = spec.groupId ?? ++maxGroupId
          for (const member of furniture.combination)
            created.push(
              createPlacedItem(member.itemId, ++maxInstanceId, {
                position: {
                  x: position.x + member.position[0],
                  y: position.y + member.position[1],
                  z: position.z + member.position[2],
                },
                rotation: {
                  x: member.rotation[0],
                  y: member.rotation[1],
                  z: member.rotation[2],
                },
                scale: { X: member.scale[0], Y: member.scale[1], Z: member.scale[2] },
                groupId,
              })
            )
        } else {
          created.push(
            createPlacedItem(spec.gameId, ++maxInstanceId, {
              position,
              rotation: spec.rotation
                ? matrixTransform.visualRotationToData(spec.rotation)
                : undefined,
              scale: spec.scale ? visualScaleToDataScale(spec.scale) : undefined,
              groupId: spec.groupId,
            })
          )
        }
      }
      itemIds = created.map((item) => item.internalId)
      nextItems = [...previous, ...created]
    } else if (command.kind === 'duplicate') {
      const source = previous.filter((item) => command.itemIds.includes(item.internalId))
      const groupIds = new Set(source.map((item) => item.groupId).filter((id) => id > 0))
      const groupOriginById = new Map(scheme.groupOrigins.value)
      const sourceGroups = new Map(
        scheme.collectionTree.value.groups.map((group) => [group.groupId, group])
      )
      const nextGroups = [...scheme.collectionTree.value.groups]
      const created: AppItem[] = []
      itemIdGroups = []
      const total = source.length * command.offsets.length
      if (!Number.isSafeInteger(maxInstanceId + total))
        invalidInput('Instance ID allocator exhausted')
      if (!Number.isSafeInteger(maxGroupId + groupIds.size * command.offsets.length))
        invalidInput('Group ID allocator exhausted')

      for (const offset of command.offsets) {
        const dataOffset = worldDeltaToData(offset)
        const groupMap = new Map<number, number>()
        for (const oldGroupId of groupIds) groupMap.set(oldGroupId, ++maxGroupId)
        const idMap = new Map<string, string>()
        const copyIds: string[] = []
        for (const item of source) {
          const clone = structuredClone(toRaw(item)) as AppItem
          const newId = crypto.randomUUID()
          idMap.set(item.internalId, newId)
          clone.internalId = newId
          clone.instanceId = ++maxInstanceId
          clone.x += dataOffset.x
          clone.y += dataOffset.y
          clone.z += dataOffset.z
          clone.groupId = groupMap.get(item.groupId) ?? 0
          clone.extra.ColorMap = remapColorMapGroupIds(clone.extra.ColorMap, groupMap)
          created.push(clone)
          copyIds.push(newId)
        }
        for (const [oldGroupId, newGroupId] of groupMap) {
          const origin = groupOriginById.get(oldGroupId)
          const sourceGroup = sourceGroups.get(oldGroupId)
          const newOrigin = origin ? idMap.get(origin) : undefined
          if (newOrigin) groupOriginById.set(newGroupId, newOrigin)
          if (sourceGroup)
            nextGroups.push({
              ...sourceGroup,
              groupId: newGroupId,
              order:
                Math.max(
                  -1,
                  ...nextGroups
                    .filter((group) => group.collectionId === sourceGroup.collectionId)
                    .map((group) => group.order)
                ) + 1,
            })
        }
        itemIdGroups.push(copyIds)
      }
      itemIds = created.map((item) => item.internalId)
      nextItems = [...previous, ...created]
      if (nextGroups.length !== scheme.collectionTree.value.groups.length)
        nextCollectionTree = { ...scheme.collectionTree.value, groups: nextGroups }
      if (groupOriginById.size !== scheme.groupOrigins.value.size)
        nextGroupOrigins = groupOriginById
    } else if (command.kind === 'remove') {
      const removed = new Set(command.itemIds)
      itemIds = command.itemIds
      nextItems = previous.filter((item) => !removed.has(item.internalId))
    } else if (command.kind === 'edit') {
      const patches = new Map(command.items.map((item) => [item.itemId, item]))
      itemIds = command.items.map((item) => item.itemId)
      for (const patch of command.items) {
        const current = previous.find((item) => item.internalId === patch.itemId)!
        const gameId = patch.gameId ?? current.gameId
        const furniture = furnitureRule(gameId)
        if (furniture.combination?.length && patch.gameId !== undefined)
          invalidInput(`Cannot edit an item into combination furniture ${gameId}; place it instead`)
        validateRotation(
          gameId,
          patch.rotation ?? matrixTransform.dataRotationToVisual(current.rotation),
          furniture
        )
        validateScale(gameId, patch.scale ?? dataScaleToVisualScale(current.extra.Scale), rules)
      }
      nextItems = previous.map((item) => {
        const patch = patches.get(item.internalId)
        return patch ? applyPatch(item, patch) : item
      })
    } else {
      itemIds = command.itemIds
      const selected = previous.filter((item) => command.itemIds.includes(item.internalId))
      let transformed: AppItem[]
      if (command.kind === 'translate') {
        transformed = translateItems(selected, worldDeltaToData(command.delta))
      } else {
        const pivotData = matrixTransform.worldPositionToData(command.pivot)
        if (command.kind === 'rotate') {
          transformed = rotateItemsInWorkingCoordinate(
            selected,
            command.delta,
            pivotData,
            { x: 0, y: 0, z: 0 },
            false
          )
        } else {
          if (command.factors.x === 1 && command.factors.y === 1 && command.factors.z === 1) {
            transformed = selected
          } else {
            const frame = createSelectionTransformFrame(pivotData, { x: 0, y: 0, z: 0 })
            transformed = scaleItemsAroundPivot(
              selected,
              frame.pivotWorldPosition,
              frame.pivotWorldQuaternion,
              command.factors
            )
          }
        }
      }
      nextItems = previous.map((item) => {
        const index = itemIds.indexOf(item.internalId)
        return index >= 0 ? transformed[selected.indexOf(item)]! : item
      })
    }

    for (const id of itemIds) {
      const item = nextItems.find((candidate) => candidate.internalId === id)
      if (item) validateItem(item)
    }

    const origins = structureChanged
      ? reconcileGroupOrigins(nextGroupOrigins, nextItems)
      : nextGroupOrigins
    assertCurrent()
    recordTransaction(
      `items.ai_${command.kind}`,
      () => {
        if (structureChanged) setSchemeItems(scheme, nextItems)
        else scheme.items.value = nextItems
        if (nextCollectionTree !== scheme.collectionTree.value)
          scheme.collectionTree.value = nextCollectionTree
        if (origins !== scheme.groupOrigins.value) scheme.groupOrigins.value = origins
        if (command.kind === 'place' || command.kind === 'duplicate') {
          scheme.maxInstanceId.value = maxInstanceId
          scheme.maxGroupId.value = maxGroupId
        }
        editor.triggerSceneUpdate(scheme)
      },
      scheme
    )
    const entries = scheme.history.value?.transactionUndoStack
    return {
      kind: command.kind,
      itemIds,
      count: itemIds.length,
      ...(itemIdGroups ? { itemIdGroups } : {}),
      transactionId: entries?.[entries.length - 1]?.transaction.id,
    }
  }

  return { apply }
}
