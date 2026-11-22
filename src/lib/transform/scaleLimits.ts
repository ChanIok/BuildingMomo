const bits = new DataView(new ArrayBuffer(8))

/** 沿指定方向移动一个 float64 值，用于排除舍入中点或修正倍率运算误差。 */
export function nextFloat64(value: number, direction: -1 | 1): number {
  if (Number.isNaN(value) || value === direction * Infinity) return value
  if (value === 0) return direction * Number.MIN_VALUE

  bits.setFloat64(0, value)
  const step = value > 0 === direction > 0 ? 1n : -1n
  bits.setBigUint64(0, bits.getBigUint64(0) + step)
  return bits.getFloat64(0)
}

function getScaleBoundary(value: number, direction: -1 | 1): number {
  const bound = Math.fround(value)
  if (!Number.isFinite(bound)) return bound

  let adjacent: number
  if (bound === 0) {
    adjacent = direction * 2 ** -149
  } else {
    bits.setFloat32(0, bound)
    const step = bound > 0 === direction > 0 ? 1 : -1
    bits.setUint32(0, bits.getUint32(0) + step)
    adjacent = bits.getFloat32(0)
    // 最大有限 float32 的外侧舍入分界使用下一指数的值。
    if (!Number.isFinite(adjacent)) adjacent = direction * 2 ** 128
  }

  const midpoint = (bound + adjacent) / 2
  // fround 直接决定中点取偶的归属；不属于 bound 时向区间内移动一个 float64。
  return Math.fround(midpoint) === bound
    ? midpoint
    : nextFloat64(midpoint, direction === 1 ? -1 : 1)
}

/** 服务端先转 float32 再比较；返回等价的、两端均可取到的 JS number 区间。 */
export function getSafeScaleRange(range: [number, number]): [number, number] {
  return [getScaleBoundary(range[0], -1), getScaleBoundary(range[1], 1)]
}
