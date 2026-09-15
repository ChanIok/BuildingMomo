// 使用仓库已有的 TypeScript 和 Node 内置断言，无需安装测试运行器。
// 运行：node scripts/test-translation-snap.cjs
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')
const ts = require('typescript')
const { Vector3, Matrix3, Matrix4, Quaternion, Euler, Object3D, Box3, OrthographicCamera } = require('three')

function createLoader(mocks = {}) {
  const cache = new Map()
  function load(filename) {
    filename = path.resolve(__dirname, '..', filename)
    if (cache.has(filename)) return cache.get(filename).exports
    const module = { exports: {} }
    cache.set(filename, module)
    const code = ts.transpileModule(readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText
    const localRequire = (id) => {
      if (Object.hasOwn(mocks, id)) return mocks[id]
      if (id.startsWith('@/') || id.startsWith('.')) {
        let resolved = id.startsWith('@/')
          ? path.resolve(__dirname, '../src', id.slice(2))
          : path.resolve(path.dirname(filename), id)
        if (!path.extname(resolved)) resolved += '.ts'
        return load(resolved)
      }
      return require(id)
    }
    new Function('require', 'module', 'exports', code)(localRequire, module, module.exports)
    return module.exports
  }
  return load
}

const load = createLoader()
const { OBB, intersectsOBBAfterTranslation } = load('src/lib/collision.ts')
const { createTranslationSnapBody: body, solveTranslationSnap: solve } = load('src/lib/translationSnap.ts')
const axes = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)]
function box(id, center, half = [50, 50, 5], basis = axes) {
  return body(id, new OBB(new Vector3(...center), new Vector3(...half), basis))
}
function snap(moving, targets, options = {}) {
  return solve({ moving, targets, movementAxes: [axes[0]], threshold: 20, ...options })
}
function near(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} != ${expected}`)
}
function floors(prefix, columns, xStart) {
  return Array.from({ length: columns * 10 }, (_, i) =>
    box(`${prefix}${i}`, [xStart + Math.floor(i / 10) * 100, 50 + (i % 10) * 100, 5]))
}

test('2×10 接 4×10，选区整体修正 10，数量和遍历顺序不影响位移', () => {
  const moving = floors('m', 2, -160)
  const targets = floors('t', 4, 50)
  const before = JSON.stringify({ moving, targets })
  near(snap(moving, targets).offset.x, 10)
  near(snap([...moving].reverse(), [...targets].reverse()).offset.x, 10)
  assert.equal(JSON.stringify({ moving, targets }), before)
})

test('45° 法线与世界 X 拖动一次消除全部缝隙', () => {
  const rotation = new Matrix4().makeRotationZ(Math.PI / 4)
  const basis = axes.map((a) => a.clone().applyMatrix4(rotation))
  const moving = box('m', basis[0].clone().multiplyScalar(-160).toArray(), [100, 500, 5], basis)
  const target = box('t', [0, 0, 0], [50, 500, 5], basis)
  const result = snap([moving], [target])
  near(result.offset.x, 10 * Math.SQRT2)
  near(result.offset.y, 0)
  assert.ok(intersectsOBBAfterTranslation(moving.obb, target.obb, result.offset))
  // 阈值按沿拖动轴的实际位移判断，法线间隙 10 不代表只需移动 10。
  assert.equal(snap([moving], [target], { threshold: 12 }), null)
})

test('旋转地砖的角接触另一块地砖的边，交换移动物后修正方向相反', () => {
  const rotation = new Matrix4().makeRotationZ(Math.PI / 4)
  const basis = axes.map((a) => a.clone().applyMatrix4(rotation))
  const b = box('b', [0, 0, 0])
  for (const gap of [10, 0.05, 0, -0.05, -10]) {
    const a = box('a', [50 + 50 * Math.SQRT2 + gap, 0, 0], [50, 50, 5], basis)
    for (const direction of [axes[0], axes[0].clone().negate()]) {
      const options = { movementAxes: [direction] }
      const forward = snap([a], [b], options)
      const reverse = snap([b], [a], options)
      assert.ok(forward && reverse)
      near(forward.offset.x, -gap)
      near(reverse.offset.x, gap)
      near(forward.offset.clone().add(reverse.offset).length(), 0)
    }
  }
})

test('移动物自身的面形成接触边界时，也能保持目标并按原始位移释放', () => {
  const rotation = new Matrix4().makeRotationZ(Math.PI / 4)
  const basis = axes.map((a) => a.clone().applyMatrix4(rotation))
  const target = box('a', [60 + 50 * Math.SQRT2, 0, 0], [50, 50, 5], basis)
  const first = snap([box('b', [0, 0, 0])], [target])
  assert.ok(first)
  const options = { preferredContact: first.contact, releaseThreshold: 30 }
  near(snap([box('b', [-15, 0, 0])], [target], options).offset.x, 25)
  near(snap([box('b', [15, 0, 0])], [target], options).offset.x, -5)
  assert.equal(snap([box('b', [-21, 0, 0])], [target], options), null)
})

test('不同三维旋转下双方交换保持对称，包括边对边形成的接触', () => {
  let seed = 4213
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 2 ** 32
  }
  const randomBody = (id) => {
    const q = new Quaternion().setFromEuler(new Euler(random() * 6, random() * 6, random() * 6))
    return box(id,
      [random() * 180, random() * 180, random() * 180],
      [10 + random() * 70, 10 + random() * 70, 10 + random() * 70],
      axes.map((axis) => axis.clone().applyQuaternion(q)))
  }
  let contacts = 0
  let edgeContacts = 0
  for (let i = 0; i < 300; i++) {
    const a = randomBody('a')
    const b = randomBody('b')
    const direction = new Vector3(random() - 0.5, random() - 0.5, random() - 0.5).normalize()
    const options = { movementAxes: [direction], threshold: 60 }
    const forward = snap([a], [b], options)
    const reverse = snap([b], [a], options)
    assert.equal(!!forward, !!reverse)
    if (!forward) continue
    contacts++
    if (forward.contact.axis >= 6) edgeContacts++
    near(forward.offset.clone().add(reverse.offset).length(), 0)
    assert.ok(intersectsOBBAfterTranslation(a.obb, b.obb, forward.offset))
    const beforeIntersects = intersectsOBBAfterTranslation(a.obb, b.obb, new Vector3())
    // 检查边界两侧确实一侧分离、一侧相交，而非仅找到一个穿透位置。
    const beyond = forward.offset.clone().addScaledVector(forward.offset.clone().normalize(), 0.001)
    const before = forward.offset.clone().addScaledVector(forward.offset.clone().normalize(), -0.001)
    assert.equal(intersectsOBBAfterTranslation(a.obb, b.obb, beyond), !beforeIntersects)
    assert.equal(intersectsOBBAfterTranslation(a.obb, b.obb, before), beforeIntersects)
  }
  assert.ok(contacts > 50)
  assert.ok(edgeContacts > 10)
})

test('旋转长条多选不使用膨胀的整体包围盒作为接触面', () => {
  const rotation = new Matrix4().makeRotationZ(Math.PI / 4)
  const basis = axes.map((a) => a.clone().applyMatrix4(rotation))
  const rotate = (b) => body(b.id, new OBB(
    b.obb.center.clone().applyMatrix4(rotation), b.obb.halfExtents, basis
  ))
  const result = snap(floors('m', 2, -160).map(rotate), floors('t', 4, 50).map(rotate))
  near(result.offset.x, 10 * Math.SQRT2)
})

test('自定义三维工作轴遵守世界空间方向', () => {
  const rotation = new Quaternion().setFromEuler(new Euler(0.3, -0.4, 0.7, 'ZYX'))
  const basis = axes.map((a) => a.clone().applyQuaternion(rotation))
  const moving = box('m', basis[0].clone().multiplyScalar(-110).toArray(), [50, 50, 5], basis)
  const target = box('t', [0, 0, 0], [50, 50, 5], basis)
  const result = snap([moving], [target], { movementAxes: [basis[0]] })
  near(result.offset.distanceTo(basis[0].clone().multiplyScalar(10)), 0)
})

test('侧面错开的干扰物不能把选区向反方向拉', () => {
  const moving = floors('m', 2, -160)
  const distractor = box('distractor', [-261, 1080, 5])
  near(snap(moving, [distractor, ...floors('t', 4, 50)]).offset.x, 10)
  assert.equal(snap(moving, [distractor]), null)
})

test('不可达面不产生候选，也不会抢走另一个真实可达目标', () => {
  const moving = box('m', [-60, -51, 0])
  const unreachable = box('u', [50, 50, 0])
  const reachable = box('r', [50, -51, 0])
  const result = snap([moving], [unreachable, reachable])
  near(result.offset.x, 10)
  assert.equal(result.contact.targetId, 'r')
})

test('L 形与分散多选的空白区域不产生虚假吸附', () => {
  const moving = [box('a', [-60, 0, 0]), box('b', [-60, 400, 0]), box('c', [-160, 0, 0])]
  assert.equal(snap(moving, [box('t', [50, 200, 0])]), null)
})

test('从接缝两侧、轻微穿透和亚 0.1 间隙均能精确接触', () => {
  for (const gap of [10, 0.05, 0, -0.05, -1, -10]) {
    near(snap([box('m', [-100 - gap, 0, 0])], [box('t', [0, 0, 0])]).offset.x, gap)
    near(snap([box('m', [100 + gap, 0, 0])], [box('t', [0, 0, 0])]).offset.x, -gap)
  }
})

test('平面拖动返回一个实际接触的完整向量', () => {
  const moving = box('m', [-110, 0, 0])
  const targets = [box('x', [0, 0, 0]), box('y', [-110, 112, 0])]
  const result = snap([moving], targets, { movementAxes: [axes[0], axes[1]] })
  near(result.offset.x, 10)
  near(result.offset.y, 0)
  const target = targets.find((b) => b.id === result.contact.targetId)
  assert.ok(intersectsOBBAfterTranslation(moving.obb, target.obb, result.offset))
})

test('保持当前目标，越过接缝仍保持，超过脱离距离后释放', () => {
  const targets = [box('a', [0, 0, 0])]
  const first = snap([box('m', [-110, 0, 0])], targets)
  const options = { preferredContact: first.contact, releaseThreshold: 30 }
  near(snap([box('m', [-125, 0, 0])], targets, options).offset.x, 25)
  near(snap([box('m', [-95, 0, 0])], targets, options).offset.x, -5)
  assert.equal(snap([box('m', [-131, 0, 0])], targets, options), null)
  assert.equal(snap([box('m', [-125, 0, 0])], targets), null)
  const competitor = box('b', [-5, 0, 0])
  assert.equal(snap([box('m', [-110, 0, 0])], [competitor, ...targets], options).contact.targetId, 'a')
})

test('目标不再有侧面重叠时立即释放', () => {
  const targets = [box('a', [0, 0, 0])]
  const first = snap([box('m', [-110, 0, 0])], targets)
  assert.equal(snap([box('m', [-110, 120, 0])], targets, {
    preferredContact: first.contact, releaseThreshold: 30,
  }), null)
})

test('无活动轴或阈值为零不吸附', () => {
  const moving = [box('m', [-110, 0, 0])]
  const targets = [box('t', [0, 0, 0])]
  assert.equal(snap(moving, targets, { movementAxes: [] }), null)
  assert.equal(snap(moving, targets, { threshold: 0 }), null)
  assert.equal(snap(moving, targets, { movementAxes: [axes[1]] }), null)
})

function item(id, x, y = 0, gameId = 1) {
  return {
    internalId: id, gameId, instanceId: 1, x, y, z: 0,
    rotation: { x: 0, y: 0, z: 0 }, groupId: 0,
    extra: { Scale: { X: 1, Y: 1, Z: 1 }, AttachID: 0 },
  }
}

function engineFixture(mode = 'box', modelBox = null) {
  const gameDataStore = {
    getFurnitureSize: () => [100, 100, 10],
    getFurnitureModelConfig: () => modelBox ? { meshes: [{}] } : null,
  }
  const modelManager = { getModelBoundingBox: () => modelBox }
  const loader = createLoader({
    '@/stores/gameDataStore': { useGameDataStore: () => gameDataStore },
    '@/composables/useThreeModelManager': { getThreeModelManager: () => modelManager },
  })
  const { matrixTransform } = loader('src/lib/matrixTransform.ts')
  const { createGizmoSnapEngine } = loader('src/composables/transformGizmo/gizmoSnapEngine.ts')
  const items = [item('m', -160), item('m2', -160, 100), item('t', 0), item('t2', 0, 100)]
  const scheme = { items: { value: items }, selectedItemIds: { value: new Set(['m', 'm2']) } }
  const editorStore = { gizmoMode: 'translate' }
  const settingsStore = { settings: { threeDisplayMode: mode, enableSurfaceSnap: true, surfaceSnapThreshold: 20 } }
  let disabled = false
  const pivot = new Object3D()
  const controls = { axis: 'X' }
  const engine = createGizmoSnapEngine({
    editorStore, settingsStore, gameDataStore,
    pivotRef: { value: pivot }, transformRef: { value: { instance: controls } },
    isSnapTemporarilyDisabled: () => disabled,
  })
  const prepare = () => {
    const start = new Map(items.filter((i) => scheme.selectedItemIds.value.has(i.internalId))
      .map((i) => [i.internalId, matrixTransform.buildWorldMatrixFromItem(i, !!modelBox)]))
    engine.prepareCollisionData(scheme, start)
    return start
  }
  const start = prepare()
  const translate = (x) => new Map([...start].map(([id, matrix]) => [
    id, new Matrix4().makeTranslation(x, 0, 0).multiply(matrix),
  ]))
  return { engine, start, translate, items, scheme, prepare, controls, settingsStore,
    disable: (value) => { disabled = value } }
}

test('引擎对所有选中矩阵施加同一位移，不修改输入和存档', () => {
  const f = engineFixture()
  const original = JSON.stringify(f.items)
  const raw = f.translate(50)
  const before = JSON.stringify([...raw])
  const result = f.engine.applyCollisionSnap(raw)
  near(result.get('m').elements[12], -100)
  near(result.get('m2').elements[12], -100)
  near(result.get('m2').elements[13] - result.get('m').elements[13], -100)
  assert.equal(JSON.stringify([...raw]), before)
  assert.equal(JSON.stringify(f.items), original)
  // 重复以同一个原始拖拽位置求解不会累积；后续拖动能释放。
  near(f.engine.applyCollisionSnap(raw).get('m').elements[12], -100)
  const far = f.translate(10)
  assert.equal(f.engine.applyCollisionSnap(far), far)
})

test('Ctrl 临时禁用清除保持状态，松开后只按进入阈值重新捕获', () => {
  const f = engineFixture()
  f.engine.applyCollisionSnap(f.translate(50))
  near(f.engine.applyCollisionSnap(f.translate(35)).get('m').elements[12], -100)
  f.disable(true)
  const raw = f.translate(35)
  assert.equal(f.engine.applyCollisionSnap(raw), raw)
  f.disable(false)
  assert.equal(f.engine.applyCollisionSnap(raw), raw)
})

test('模型包围盒偏心、模型回退和普通盒子采用一致的动静边界', () => {
  for (const [mode, modelBox] of [
    ['box', null], ['model', null],
    ['model', new Box3(new Vector3(-30, -50, 7), new Vector3(70, 50, 17))],
  ]) {
    const f = engineFixture(mode, modelBox)
    near(f.engine.applyCollisionSnap(f.translate(50)).get('m').elements[12], -100)
  }
})

test('重新准备选择及清理会话不沿用旧 ID 或目标', () => {
  const f = engineFixture()
  f.engine.applyCollisionSnap(f.translate(50))
  f.scheme.selectedItemIds.value = new Set(['t', 't2'])
  const start = f.prepare()
  const raw = new Map([...start].map(([id, matrix]) => [id,
    new Matrix4().makeTranslation(-50, 0, 0).multiply(matrix)]))
  near(f.engine.applyCollisionSnap(raw).get('t').elements[12], -60)
  f.engine.clearCollisionData()
  assert.equal(f.engine.applyCollisionSnap(raw), raw)
})

test('完整 SAT 与 Three.js OBB 实现在不同三维旋转下保持一致', async () => {
  const { OBB: ThreeOBB } = await import('three/addons/math/OBB.js')
  let seed = 8127
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 2 ** 32
  }
  const randomOBB = () => {
    const q = new Quaternion().setFromEuler(new Euler(random() * 6, random() * 6, random() * 6))
    return new OBB(
      new Vector3(random() * 200, random() * 200, random() * 200),
      new Vector3(5 + random() * 100, 5 + random() * 100, 5 + random() * 100),
      axes.map((a) => a.clone().applyQuaternion(q))
    )
  }
  const convert = (obb, offset) => new ThreeOBB(
    obb.center.clone().add(offset), obb.halfExtents.clone(),
    new Matrix3().setFromMatrix4(new Matrix4().makeBasis(...obb.axes))
  )
  for (let i = 0; i < 300; i++) {
    const moving = randomOBB()
    const target = randomOBB()
    const offset = new Vector3(random() * 20, random() * 20, random() * 20)
    assert.equal(intersectsOBBAfterTranslation(moving, target, offset),
      convert(moving, offset).intersectsOBB(convert(target, new Vector3())))
  }
})

function gizmoFixture() {
  const vue = require('vue')
  const items = [item('m', -160), item('t', 0)]
  const scheme = {
    items: { value: items }, selectedItemIds: { value: new Set(['m']) },
    groupOrigins: { value: new Map() },
  }
  const editorStore = {
    activeScheme: scheme, gizmoMode: 'translate',
    itemsMap: new Map(items.map((i) => [i.internalId, i])),
  }
  const gameDataStore = {
    getFurnitureSize: () => [100, 100, 10], getFurnitureModelConfig: () => null,
  }
  const settingsStore = { settings: {
    threeDisplayMode: 'box', enableSurfaceSnap: true, surfaceSnapThreshold: 20, translationSnap: 0,
  } }
  const keys = { Alt: { value: false }, Control: { value: false }, Meta: { value: false } }
  const commits = []
  const loader = createLoader({
    vue: { ...vue, watch: () => {}, watchEffect: () => {}, onUnmounted: () => {} },
    '@vueuse/core': { useMagicKeys: () => keys },
    '@/stores/editorStore': { useEditorStore: () => editorStore },
    '@/stores/gameDataStore': { useGameDataStore: () => gameDataStore },
    '@/stores/settingsStore': { useSettingsStore: () => settingsStore },
    '@/stores/uiStore': { useUIStore: () => ({
      activeSlidePathPoint: null,
      editorContainerRect: { left: 0, top: 0, width: 1000, height: 1000 },
    }) },
    '@/composables/useThreeModelManager': { getThreeModelManager: () => ({ getModelBoundingBox: () => null }) },
    '@/composables/useClipboard': { useClipboard: () => ({}) },
    '@/composables/editor/useEditorManipulation': { useEditorManipulation: () => ({
      commitBatchedTransform: (updates, options) => commits.push({ updates, options }),
    }) },
    '@/composables/editor/useEditorHistory': { useEditorHistory: () => ({}) },
    '@/composables/transformGizmo/gizmoAppearance': { createGizmoAppearanceManager: () => () => {} },
    '@/lib/slidePath': {},
  })
  const { useThreeTransformGizmo } = loader('src/composables/useThreeTransformGizmo.ts')
  const pivot = new Object3D()
  pivot.position.set(-160, 0, 0)
  const camera = new OrthographicCamera(-500, 500, 500, -500, 1, 2000)
  camera.position.set(0, 0, 1000)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld(true)
  const controls = { axis: 'X' }
  const previews = []
  const gizmo = useThreeTransformGizmo(
    { value: pivot }, (matrices, preview) => previews.push({ matrices, preview }),
    vue.ref(false), undefined, { value: camera }, { value: { instance: controls } }
  )
  return { gizmo, pivot, controls, keys, items, previews, commits }
}

test('鼠标与实际触控投影共用吸附预览，松手只提交最后一帧且只提交位置', async () => {
  const originalWindow = global.window
  try {
    for (const touch of [false, true]) {
      global.window = { matchMedia: () => ({ matches: touch }) }
      const f = gizmoFixture()
      const event = (clientX) => ({ pointerType: 'touch', pointerId: 1, clientX, clientY: 500 })
      f.gizmo.handleGizmoMouseDown(touch ? event(340) : undefined)
      if (!touch) f.pivot.position.x = -110
      await f.gizmo.handleGizmoChange(touch ? event(390) : undefined)
      near(f.previews.at(-1).matrices.get('m').elements[12], -100)
      near(f.items[0].x, -160)
      // 松手时轴已清除或修饰键变化，都不能把最终位置重新算一遍。
      f.controls.axis = null
      f.keys.Control.value = true
      f.gizmo.handleGizmoMouseUp()
      assert.equal(f.commits.length, 1)
      assert.deepEqual(f.commits[0], {
        updates: [{ id: 'm', x: -100, y: -0, z: 0 }], options: { recordHistory: true },
      })
      assert.equal(f.previews.at(-1).preview, false)
      near(f.previews.at(-1).matrices.get('m').elements[12], -100)
    }
  } finally {
    if (originalWindow === undefined) delete global.window
    else global.window = originalWindow
  }
})

test('点击不移动、拖回起点均不提交空历史事务', async () => {
  const f = gizmoFixture()
  f.gizmo.handleGizmoMouseDown()
  f.gizmo.handleGizmoMouseUp()
  assert.equal(f.commits.length, 0)
  f.gizmo.handleGizmoMouseDown()
  f.pivot.position.x = -130
  await f.gizmo.handleGizmoChange()
  f.pivot.position.x = -160
  await f.gizmo.handleGizmoChange()
  f.gizmo.handleGizmoMouseUp()
  assert.equal(f.commits.length, 0)
})
