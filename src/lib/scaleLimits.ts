/** 将边界向区间内收至 14 位有效数字，避免 JSON 舍入后越界。 */
export function getSafeScaleRange(range: [number, number]): [number, number] {
  return range.map((bound, index) => {
    const direction = index === 0 ? 1 : -1
    let rounded = Number(bound.toPrecision(14))
    if ((rounded - bound) * direction < 0) {
      const step = 10 ** (Math.floor(Math.log10(Math.abs(bound))) - 13)
      rounded = Number((rounded + direction * step).toPrecision(14))
    }
    return rounded
  }) as [number, number]
}
