import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref, watch, type EffectScope } from 'vue'
import { PerspectiveCamera } from 'three'
import { invalidateScene, setSceneInvalidate } from '@/composables/useSceneInvalidate'

// Execute the actual look-at watcher with real Vue scheduling without loading
// the viewport's unrelated rendering dependencies.
const source = readFileSync(
  new URL('../../src/components/ThreeEditor.vue', import.meta.url),
  'utf8'
)
const script = source.slice(source.indexOf('>') + 1, source.indexOf('</script>'))
const ast = ts.createSourceFile('ThreeEditor.ts', script, ts.ScriptTarget.Latest, true)
const lookAtWatcher = ast.statements.find(
  (statement) =>
    ts.isExpressionStatement(statement) &&
    ts.isCallExpression(statement.expression) &&
    statement.expression.expression.getText(ast) === 'watch' &&
    statement.expression.arguments[0]?.getText(ast) === 'cameraLookAt'
)

const scopes: EffectScope[] = []
afterEach(() => {
  for (const scope of scopes.splice(0)) scope.stop()
  setSceneInvalidate(null)
})

function setup() {
  const cameraLookAt = ref<[number, number, number]>([0, 1, 0])
  const camera = new PerspectiveCamera()
  camera.up.set(0, 0, 1)
  camera.lookAt(...cameraLookAt.value)
  const redraw = vi.fn()
  setSceneInvalidate(redraw)
  const scope = effectScope()
  scopes.push(scope)
  scope.run(() => {
    if (!lookAtWatcher) throw new Error('ThreeEditor must invalidate look-at changes')
    runInNewContext(lookAtWatcher.getText(ast), { watch, cameraLookAt, invalidateScene })
    // Model Tres' property patch in the update queue. A redraw must only be
    // requested after this binding has applied the new orientation.
    watch(cameraLookAt, (target) => camera.lookAt(...target))
  })
  return { cameraLookAt, camera, redraw, scope }
}

describe('ThreeEditor look-at invalidation', () => {
  it('redraws every turn with no hover changes, then stays idle when turning stops', async () => {
    const { cameraLookAt, camera, redraw } = setup()
    expect(redraw).not.toHaveBeenCalled()
    for (const target of [
      [1, 1, 0],
      [2, 1, 1],
      [3, 1, 2],
    ] as [number, number, number][]) {
      const previousOrientation = camera.quaternion.clone()
      cameraLookAt.value = target
      await nextTick()
      expect(camera.quaternion.equals(previousOrientation)).toBe(false)
    }
    expect(redraw).toHaveBeenCalledTimes(3)
    expect(redraw).toHaveBeenLastCalledWith(false) // Camera turns do not dirty shadows.
    await nextTick()
    await nextTick()
    expect(redraw).toHaveBeenCalledTimes(3)
  })

  it('coalesces updates and requests redraw after the latest look-at binding is applied', async () => {
    const { cameraLookAt, camera, redraw } = setup()
    const expected = new PerspectiveCamera()
    expected.up.copy(camera.up)
    expected.lookAt(2, 1, 1)
    redraw.mockImplementation(() => {
      expect(camera.quaternion.equals(expected.quaternion)).toBe(true)
    })
    cameraLookAt.value = [1, 1, 0]
    cameraLookAt.value = [2, 1, 1]
    expect(redraw).not.toHaveBeenCalled()
    await nextTick()
    expect(redraw).toHaveBeenCalledOnce()
  })

  it('stops requesting redraw when the component scope is disposed', async () => {
    const { cameraLookAt, redraw, scope } = setup()
    scope.stop()
    cameraLookAt.value = [1, 1, 0]
    await nextTick()
    expect(redraw).not.toHaveBeenCalled()
  })
})
