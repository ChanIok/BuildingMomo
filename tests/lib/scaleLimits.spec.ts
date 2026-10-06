import { describe, expect, it } from 'vitest'
import { getSafeScaleRange } from '../../src/lib/scaleLimits'

describe('getSafeScaleRange', () => {
  it('rounds Float32 bounds inward to the nearest 14-digit values', () => {
    const min = Math.fround(0.7)
    const max = Math.fround(1.3)
    const safe = getSafeScaleRange([min, max])
    expect(safe).toEqual([0.69999998807908, 1.2999999523162])
    expect(safe[0]).toBeGreaterThanOrEqual(min)
    expect(safe[1]).toBeLessThanOrEqual(max)
    expect(safe.map((value) => Number(value.toPrecision(14)))).toEqual(safe)
    expect(JSON.parse(JSON.stringify(safe))).toEqual(safe)
  })

  it('preserves exact bounds and the unscaled range', () => {
    expect(getSafeScaleRange([0.5, 2])).toEqual([0.5, 2])
    expect(getSafeScaleRange([1, 1])).toEqual([1, 1])
  })
})
