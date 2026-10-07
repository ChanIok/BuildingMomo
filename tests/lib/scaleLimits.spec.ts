import { describe, expect, it } from 'vitest'
import { getSafeScaleRange, nextFloat64 } from '../../src/lib/scaleLimits'

describe('getSafeScaleRange', () => {
  it('matches the observed server cutoffs at 0.7 and 1.3', () => {
    const [min, max] = getSafeScaleRange([0.699999988079071, 1.2999999523162842])

    expect(0.699999958276).toBeLessThan(min)
    expect(0.699999958277).toBeGreaterThanOrEqual(min)
    expect(1.30000001192).toBeLessThanOrEqual(max)
    expect(1.300000011921).toBeGreaterThan(max)
    expect(0.7).toBeGreaterThanOrEqual(min)
    expect(1.3).toBeLessThanOrEqual(max)
  })

  it('excludes odd-bound midpoints and includes even-bound midpoints', () => {
    const oddMinMidpoint = 0.6999999582767486572265625
    const evenMaxMidpoint = 1.300000011920928955078125
    const [min, max] = getSafeScaleRange([Math.fround(0.7), Math.fround(1.3)])

    expect(min).toBe(nextFloat64(oddMinMidpoint, 1))
    expect(Math.fround(oddMinMidpoint)).toBeLessThan(Math.fround(0.7))
    expect(max).toBe(evenMaxMidpoint)
    expect(Math.fround(max)).toBe(Math.fround(1.3))
  })

  it('includes both asymmetric midpoints around 1', () => {
    const [min, max] = getSafeScaleRange([1, 1])
    expect(min).toBe(0.9999999701976776123046875)
    expect(max).toBe(1.000000059604644775390625)
    expect(max - 1).toBe(2 * (1 - min))
    expect(0.999999970197).toBeLessThan(min)
    expect(0.999999970198).toBeGreaterThanOrEqual(min)
    expect(1.000000059604).toBeLessThanOrEqual(max)
    expect(1.000000059605).toBeGreaterThan(max)
  })

  it('returns the full float64 interval mapping to each float32, across exponents and signs', () => {
    const bits = new DataView(new ArrayBuffer(4))
    for (let exponent = 0; exponent < 255; exponent++) {
      for (const mantissa of [0, 1, 2, 0x333333, 0x666666, 0x7fffff]) {
        bits.setUint32(0, exponent * 2 ** 23 + mantissa)
        for (const sign of [-1, 1]) {
          const value = sign * bits.getFloat32(0)
          const safe = getSafeScaleRange([value, value])
          const [min, max] = safe

          expect(Math.fround(min) === value).toBe(true)
          expect(Math.fround(max) === value).toBe(true)
          expect(Math.fround(nextFloat64(min, -1))).toBeLessThan(value)
          expect(Math.fround(nextFloat64(max, 1))).toBeGreaterThan(value)
          expect(JSON.parse(JSON.stringify(safe))).toEqual(safe)
        }
      }
    }
  })
})

describe('nextFloat64', () => {
  it('steps correctly across signs, zero, powers of two and infinities', () => {
    expect(nextFloat64(1, 1)).toBe(1 + Number.EPSILON)
    expect(nextFloat64(1, -1)).toBe(1 - Number.EPSILON / 2)
    expect(nextFloat64(-1, 1)).toBe(-1 + Number.EPSILON / 2)
    expect(nextFloat64(-1, -1)).toBe(-1 - Number.EPSILON)
    expect(nextFloat64(0, 1)).toBe(Number.MIN_VALUE)
    expect(nextFloat64(0, -1)).toBe(-Number.MIN_VALUE)
    expect(nextFloat64(Infinity, -1)).toBe(Number.MAX_VALUE)
    expect(nextFloat64(-Infinity, 1)).toBe(-Number.MAX_VALUE)
    expect(nextFloat64(Infinity, 1)).toBe(Infinity)
    expect(nextFloat64(-Infinity, -1)).toBe(-Infinity)
  })
})
