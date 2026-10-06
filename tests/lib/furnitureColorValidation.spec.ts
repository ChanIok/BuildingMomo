import { describe, expect, it } from 'vitest'
import { checkFurnitureColors, cleanFurnitureColors } from '../../src/lib/furnitureColorValidation'

describe('checkFurnitureColors', () => {
  it('accepts one configured scheme per area in arrays and objects', () => {
    const expected = { invalidColor: false, conflictingColor: false }
    expect(checkFurnitureColors([11, 22], [11, 12, 22])).toEqual(expected)
    expect(checkFurnitureColors({ 1: 11, 2: 22 }, [11, 12, 22])).toEqual(expected)
  })

  it('ignores empty entries and default colors, matching export', () => {
    expect(checkFurnitureColors([null, 0, 10, 20], [])).toEqual({
      invalidColor: false,
      conflictingColor: false,
    })
    expect(checkFurnitureColors(undefined, [])).toEqual({
      invalidColor: false,
      conflictingColor: false,
    })
  })

  it('reports schemes absent from furniture configuration', () => {
    expect(checkFurnitureColors([13], [11, 12])).toEqual({
      invalidColor: true,
      conflictingColor: false,
    })
    expect(checkFurnitureColors([1], [])).toEqual({
      invalidColor: true,
      conflictingColor: false,
    })
  })

  it('reports multiple schemes or repeated schemes in the same area', () => {
    expect(checkFurnitureColors([11, 12], [11, 12]).conflictingColor).toBe(true)
    expect(checkFurnitureColors([11, 11], [11]).conflictingColor).toBe(true)
    expect(checkFurnitureColors({ 1: 11, 2: 12 }, [11, 12]).conflictingColor).toBe(true)
  })

  it('derives the area from the scheme rather than object keys and preserves input', () => {
    const colors = { 0: 11, 1: 12 }
    expect(checkFurnitureColors(colors, [11, 12]).conflictingColor).toBe(true)
    expect(colors).toEqual({ 0: 11, 1: 12 })
  })

  it('cleans unsupported schemes and keeps the last valid scheme per area without mutating input', () => {
    const entry = { idx: 1, cfg: [] }
    const config = { 1: { 1: entry, 2: entry }, 2: { 1: entry } }
    const colors = [11, 12, 13, 21, 0, null]
    const cleaned = cleanFurnitureColors(colors, config)
    expect(cleaned).toEqual({ 1: 12, 2: 21 })
    expect(checkFurnitureColors(cleaned, [11, 12, 21])).toEqual({
      invalidColor: false,
      conflictingColor: false,
    })
    expect(colors).toEqual([11, 12, 13, 21, 0, null])
    expect(cleanFurnitureColors({ 0: 11, 1: 12, 2: 13 }, config)).toEqual({ 1: 12 })
    expect(cleanFurnitureColors([1], undefined)).toEqual({})
  })
})
