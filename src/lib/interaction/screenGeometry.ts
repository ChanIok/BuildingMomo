export interface ScreenPoint {
  x: number
  y: number
}

export interface ScreenRect {
  x: number
  y: number
  width: number
  height: number
}

export interface ScreenBounds {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

const EPSILON = 1e-6

export function computeBounds(points: ScreenPoint[]): ScreenBounds {
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity

  for (const point of points) {
    if (point.x < minX) minX = point.x
    if (point.x > maxX) maxX = point.x
    if (point.y < minY) minY = point.y
    if (point.y > maxY) maxY = point.y
  }

  return {
    minX,
    maxX,
    minY,
    maxY,
  }
}

export function isPointInPolygon(point: ScreenPoint, polygon: ScreenPoint[]): boolean {
  if (polygon.length === 0) return false

  let inside = false

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const start = polygon[i]
    const end = polygon[j]
    if (!start || !end) continue

    if (isPointOnSegment(point, start, end)) {
      return true
    }

    const intersects =
      start.y > point.y !== end.y > point.y &&
      point.x < ((end.x - start.x) * (point.y - start.y)) / (end.y - start.y) + start.x

    if (intersects) {
      inside = !inside
    }
  }

  return inside
}

function isPointOnSegment(point: ScreenPoint, start: ScreenPoint, end: ScreenPoint): boolean {
  const area = cross(start, end, point)
  if (Math.abs(area) > EPSILON) return false

  return (
    point.x >= Math.min(start.x, end.x) - EPSILON &&
    point.x <= Math.max(start.x, end.x) + EPSILON &&
    point.y >= Math.min(start.y, end.y) - EPSILON &&
    point.y <= Math.max(start.y, end.y) + EPSILON
  )
}

function cross(origin: ScreenPoint, a: ScreenPoint, b: ScreenPoint): number {
  return (a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x)
}
