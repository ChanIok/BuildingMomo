import { Box3, Euler, MathUtils, Matrix4, Quaternion, Vector3 } from 'three'
import type { AppItem } from '@/types/editor'

// 飞花道在游戏中的 gameId，用于识别和特殊处理
export const SLIDE_PATH_GAME_ID = 1170000618
// 道路截面尺寸（游戏单位），用于 segment mesh 的 scale
export const SLIDE_PATH_WIDTH = 200
export const SLIDE_PATH_THICKNESS = 27.1
// 标准 renderer 中飞花道的回退尺寸，渲染为几乎不可见的小方块
export const SLIDE_PATH_FALLBACK_SIZE: [number, number, number] = [10, 10, 10]
const MIN_SEGMENT_LENGTH = 0.001
// segment 方向计算的参考上方向（世界 Z 轴朝上）
const UP_AXIS = new Vector3(0, 0, 1)

// 以下 scratch 对象在 buildSlidePathSegmentLocalMatrix 中复用，避免热路径反复 new
const _tangent = new Vector3()
const _side = new Vector3()
const _normal = new Vector3()
const _basis = new Matrix4()
const _quaternion = new Quaternion()
const _center = new Vector3()
const _scale = new Vector3()

export type SlidePathPoint = [number, number, number]
export type SlidePathAxis = 0 | 1 | 2

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function normalizePoint(raw: unknown): SlidePathPoint | null {
  if (!Array.isArray(raw) || raw.length < 3) return null

  const x = raw[0]
  const y = raw[1]
  const z = raw[2]
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(z)) {
    return null
  }

  return [x, y, z]
}

// 从游戏存档的 extra.TempInfo.points 读取原始点位数组，逐个校验后返回
export function getSlidePathPoints(item: AppItem): SlidePathPoint[] {
  const rawPoints = item.extra.TempInfo?.points
  if (!Array.isArray(rawPoints)) return []

  const points: SlidePathPoint[] = []
  for (const rawPoint of rawPoints) {
    const point = normalizePoint(rawPoint)
    if (point) points.push(point)
  }

  return points
}

// 游戏坐标系 → 飞花道局部坐标系：X↔Y 互换并取反 X，使局部坐标以道路延伸方向为 X 轴
export function dataPointToSlideLocal(point: SlidePathPoint): SlidePathPoint {
  return [point[1], -point[0], point[2]]
}

// dataPointToSlideLocal 的逆变换
export function slideLocalPointToData(point: SlidePathPoint): SlidePathPoint {
  return [-point[1], point[0], point[2]]
}

export function getSlidePathLocalPoints(item: AppItem): SlidePathPoint[] {
  return getSlidePathPoints(item).map(dataPointToSlideLocal)
}

export function isSlidePathItem(item: AppItem | null | undefined): item is AppItem {
  return !!item && item.gameId === SLIDE_PATH_GAME_ID
}

export function hasEditableSlidePath(item: AppItem | null | undefined): item is AppItem {
  return isSlidePathItem(item) && getSlidePathPoints(item).length > 0
}

export function shouldRenderAsSlidePath(item: AppItem): boolean {
  return isSlidePathItem(item) && getSlidePathPoints(item).length >= 2
}

export function resolveFurnitureSize(
  gameId: number,
  fallback: [number, number, number]
): [number, number, number] {
  return gameId === SLIDE_PATH_GAME_ID ? SLIDE_PATH_FALLBACK_SIZE : fallback
}

// 物品旋转 → 场景四元数：Roll/Pitch 取反以抵消父级 Y 轴镜像，与标准 renderer 一致
export function getSlidePathSceneQuaternion(item: AppItem): Quaternion {
  const euler = new Euler(
    MathUtils.degToRad(-item.rotation.x),
    MathUtils.degToRad(-item.rotation.y),
    MathUtils.degToRad(item.rotation.z),
    'ZYX'
  )
  return new Quaternion().setFromEuler(euler)
}

export function getSlidePathLocalVector(point: SlidePathPoint): Vector3 {
  const localPoint = dataPointToSlideLocal(point)
  return new Vector3(localPoint[0], localPoint[1], localPoint[2])
}

// 将飞花道的原始点位转换为场景空间坐标：局部坐标 → 乘以物品旋转 → 加上物品位置
export function getSlidePathScenePoints(item: AppItem): Vector3[] {
  const rotation = getSlidePathSceneQuaternion(item)
  const origin = new Vector3(item.x, item.y, item.z)
  return getSlidePathPoints(item).map((point) =>
    getSlidePathLocalVector(point).applyQuaternion(rotation).add(origin)
  )
}

// 场景空间 → 世界空间：Y 轴取反，与标准 renderer 的 Scale(1,-1,1) 父级翻转一致
export function slidePathScenePointToWorld(point: { x: number; y: number; z: number }): Vector3 {
  return new Vector3(point.x, -point.y, point.z)
}

export function slidePathWorldPointToScene(point: { x: number; y: number; z: number }): Vector3 {
  return new Vector3(point.x, -point.y, point.z)
}

export function getSlidePathWorldPoints(item: AppItem): Vector3[] {
  return getSlidePathScenePoints(item).map(slidePathScenePointToWorld)
}

export function getSlidePathWorldPoint(item: AppItem, pointIndex: number): Vector3 | null {
  const point = getSlidePathScenePoints(item)[pointIndex]
  return point ? slidePathScenePointToWorld(point) : null
}

// 世界坐标 → 游戏数据坐标：反向执行 world→scene→local→data 全链路，用于 Gizmo 拖拽写回
export function worldPointToSlidePathDataPoint(
  item: AppItem,
  worldPoint: { x: number; y: number; z: number }
): SlidePathPoint {
  const scenePoint = slidePathWorldPointToScene(worldPoint)
  const localVector = scenePoint.sub(new Vector3(item.x, item.y, item.z))
  localVector.applyQuaternion(getSlidePathSceneQuaternion(item).invert())
  return slideLocalPointToData([localVector.x, localVector.y, localVector.z])
}

export function withSlidePathWorldPoint(
  item: AppItem,
  pointIndex: number,
  worldPoint: { x: number; y: number; z: number }
): AppItem | null {
  const points = getSlidePathPoints(item)
  if (!points[pointIndex]) return null

  const nextPoint = worldPointToSlidePathDataPoint(item, worldPoint)
  const nextPoints = points.map((point, index) => (index === pointIndex ? nextPoint : point))
  return withSlidePathPoints(item, nextPoints)
}

// 用两个端点构建 segment 的局部变换矩阵：方向→四元数，长度→scale X，宽度/厚度→scale Y/Z
// 返回 null 表示两端点重合，无需渲染
export function buildSlidePathSegmentLocalMatrix(
  start: Vector3,
  end: Vector3,
  target = new Matrix4()
): Matrix4 | null {
  _tangent.copy(end).sub(start)
  const length = _tangent.length()
  if (length < MIN_SEGMENT_LENGTH) return null

  _tangent.multiplyScalar(1 / length)
  _side.crossVectors(UP_AXIS, _tangent)
  if (_side.lengthSq() < 1e-8) {
    _side.set(1, 0, 0)
  } else {
    _side.normalize()
  }
  _normal.crossVectors(_tangent, _side).normalize()
  _basis.makeBasis(_tangent, _side, _normal)
  _quaternion.setFromRotationMatrix(_basis)
  _center.copy(start).add(end).multiplyScalar(0.5)
  _scale.set(length, SLIDE_PATH_WIDTH, SLIDE_PATH_THICKNESS)

  target.compose(_center, _quaternion, _scale)
  return target
}

// 计算飞花道所有节点的包围盒，再向外扩展半截面尺寸，用于选区和相机 framing
export function getSlidePathWorldBox(item: AppItem): Box3 | null {
  const points = getSlidePathWorldPoints(item)
  if (points.length === 0) return null

  const box = new Box3()
  for (const point of points) {
    box.expandByPoint(point)
  }
  box.expandByScalar(Math.max(SLIDE_PATH_WIDTH, SLIDE_PATH_THICKNESS) / 2)
  return box
}

// 不可变更新：将游戏数据坐标系的点位写入 item.extra.TempInfo.points，返回新 item 引用
export function withSlidePathPoints(item: AppItem, points: SlidePathPoint[]): AppItem {
  return {
    ...item,
    extra: {
      ...item.extra,
      TempInfo: {
        ...(item.extra.TempInfo ?? {}),
        points: points.map((point) => [...point]),
      },
    },
  }
}

// 局部坐标系的点位 → 数据坐标系后写入 item，供侧边栏编辑器使用
export function withSlidePathLocalPoints(item: AppItem, points: SlidePathPoint[]): AppItem {
  return withSlidePathPoints(item, points.map(slideLocalPointToData))
}

export function withSlidePathLocalPointValue(
  item: AppItem,
  pointIndex: number,
  axis: SlidePathAxis,
  value: number
): AppItem | null {
  if (!Number.isFinite(value)) return null

  const points = getSlidePathLocalPoints(item)
  const point = points[pointIndex]
  if (!point) return null

  const nextPoint: SlidePathPoint = [...point]
  nextPoint[axis] = value
  const nextPoints = points.map((current, index) => (index === pointIndex ? nextPoint : current))

  return withSlidePathLocalPoints(item, nextPoints)
}
