import {
  convertPositionGlobalToWorking,
  convertPositionWorkingToGlobal,
} from '../coordinateTransform'
import type { AnalysisItem, AnalysisVector3 } from '../sceneAnalysis/types'

export const computeApi = {
  groupBy<T>(values: T[], key: (value: T) => string | number) {
    const result: Record<string, T[]> = Object.create(null)
    for (const value of values) (result[String(key(value))] ??= []).push(value)
    return result
  },
  distribution(values: number[], precision = 1) {
    if (!Number.isFinite(precision) || precision <= 0) throw new Error('precision must be positive')
    if (values.some((value) => !Number.isFinite(value)))
      throw new Error('distribution values must be finite')
    const counts = new Map<number, number>()
    for (const value of values) {
      const key = Math.round(value / precision) * precision
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return [...counts].sort(([a], [b]) => a - b).map(([value, count]) => ({ value, count }))
  },
  dominantFrame(items: AnalysisItem[]) {
    if (!items.length) throw new Error('Cannot frame an empty set')
    const bins = new Map<number, number[]>()
    for (const i of items) {
      const angle = ((i.rotation.z % 90) + 90) % 90
      const key = Math.round(angle) % 90
      const bin = bins.get(key) ?? []
      bin.push(angle)
      bins.set(key, bin)
    }
    const support = [...bins.values()].sort((a, b) => b.length - a.length)[0]!
    const radians = support.map((angle) => (angle * Math.PI) / 45)
    const sine = radians.reduce((sum, angle) => sum + Math.sin(angle), 0)
    const cosine = radians.reduce((sum, angle) => sum + Math.cos(angle), 0)
    const yaw = ((Math.atan2(sine, cosine) * 45) / Math.PI + 90) % 90
    const min = { x: Infinity, y: Infinity },
      max = { x: -Infinity, y: -Infinity }
    for (const i of items)
      for (const axis of ['x', 'y'] as const) {
        min[axis] = Math.min(min[axis], i.position[axis])
        max[axis] = Math.max(max[axis], i.position[axis])
      }
    return {
      yaw,
      support: support.length,
      origin: { x: (min.x + max.x) / 2, y: (min.y + max.y) / 2, z: 0 },
    }
  },
  toFrame(position: AnalysisVector3, frame: { yaw: number; origin: AnalysisVector3 }) {
    return convertPositionGlobalToWorking(
      {
        x: position.x - frame.origin.x,
        y: position.y - frame.origin.y,
        z: position.z - frame.origin.z,
      },
      { x: 0, y: 0, z: frame.yaw }
    )
  },
  fromFrame(position: AnalysisVector3, frame: { yaw: number; origin: AnalysisVector3 }) {
    const p = convertPositionWorkingToGlobal(position, { x: 0, y: 0, z: frame.yaw })
    return { x: p.x + frame.origin.x, y: p.y + frame.origin.y, z: p.z + frame.origin.z }
  },
  gap(a: AnalysisItem['bounds'], b: AnalysisItem['bounds']) {
    if (!a || !b) return null
    return Math.hypot(
      ...(['x', 'y', 'z'] as const).map((axis) =>
        Math.max(0, a.min[axis] - b.max[axis], b.min[axis] - a.max[axis])
      )
    )
  },
}
export interface Publication {
  kind: 'set' | 'report' | 'table' | 'plan'
  label: string
  value: unknown
}

/** A computation API, NOT a security sandbox. Executed only inside a disposable Worker. */
export function evaluateComputation(code: string, input: Record<string, unknown>): Publication[] {
  if (typeof code !== 'string') throw new Error('Code must be a string')
  const outputs: Publication[] = []
  const publish = Object.fromEntries(
    ['set', 'report', 'table', 'plan'].map((kind) => [
      kind,
      (label: string, value: unknown) => {
        if (typeof label !== 'string' || !label.trim())
          throw new Error(
            `publish.${kind}(label, value): label 必须是非空字符串，请传名称和数据两个参数。`
          )
        if (value === undefined)
          throw new Error(
            `publish.${kind}(label, value): 缺少可序列化的数据 value，请传名称和数据两个参数。`
          )
        if (kind === 'set') {
          if (!Array.isArray(value))
            throw new Error('A set must contain instanceIds or input items')
          value = value.map((item) => (typeof item === 'number' ? item : item?.instanceId))
        }
        const serialized = JSON.stringify(value)
        if (serialized === undefined) throw new Error('Publication must be JSON')
        outputs.push({ kind, label, value: JSON.parse(serialized) } as Publication)
      },
    ])
  )
  new Function('input', 'api', 'publish', `"use strict";\n${code}`)(input, computeApi, publish)
  return outputs
}
