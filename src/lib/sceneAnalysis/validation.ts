import { SceneAnalysisError, type AnalysisBox, type AnalysisVector3 } from './types'

export function invalidInput(message: string): never {
  throw new SceneAnalysisError('invalid_input', message)
}

export function readObject(value: unknown, keys?: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    invalidInput('Expected an object')
  if (keys && Object.keys(value).some((key) => !keys.includes(key)))
    invalidInput('Unknown parameter')
  return value as Record<string, unknown>
}

export function readString(value: unknown, label: string, maxLength?: number): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    (maxLength !== undefined && value.length > maxLength)
  ) {
    invalidInput(`Invalid ${label}`)
  }
  return value
}

export function readStrings(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) invalidInput(`${label} must be an array`)
  const values = value.map((entry) => readString(entry, label))
  if (new Set(values).size !== values.length) invalidInput(`Duplicate ${label}`)
  return values
}

export function readIntegers(value: unknown, label: string): number[] {
  if (!Array.isArray(value) || !value.every((n) => Number.isSafeInteger(n))) {
    invalidInput(`${label} must contain integers`)
  }
  if (new Set(value).size !== value.length) invalidInput(`Duplicate ${label}`)
  return value
}

export function readVector(value: unknown): AnalysisVector3 {
  const v = readObject(value, ['x', 'y', 'z'])
  if (![v.x, v.y, v.z].every((n) => typeof n === 'number' && Number.isFinite(n))) {
    invalidInput('Coordinates must be finite numbers')
  }
  // JSON has one zero representation; normalize -0 without rounding coordinates.
  return { x: (v.x as number) || 0, y: (v.y as number) || 0, z: (v.z as number) || 0 }
}

export function readBox(value: unknown): AnalysisBox {
  const box = readObject(value, ['min', 'max'])
  const min = readVector(box.min),
    max = readVector(box.max)
  if (min.x > max.x || min.y > max.y || min.z > max.z) invalidInput('Inverted bounds')
  return { min, max }
}

/** Only called on newly constructed JSON DTOs; never freezes editor/store objects. */
export function freezeAnalysisValue<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeAnalysisValue(child)
    Object.freeze(value)
  }
  return value
}
