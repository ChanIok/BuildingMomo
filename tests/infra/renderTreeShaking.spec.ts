import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { loadConfigFromFile, normalizePath } from 'vite'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const entryPath = normalizePath(fileURLToPath(import.meta.resolve('@nuan5-pro/render/furniture')))

describe('render entry tree shaking', () => {
  it('keeps the side-effect-free assumption limited to a re-export-only entry', () => {
    const source = ts.createSourceFile(
      entryPath,
      readFileSync(entryPath, 'utf8'),
      ts.ScriptTarget.Latest,
      true
    )
    expect(source.statements.length).toBeGreaterThan(0)
    // If an upgrade adds executable initialization, review moduleSideEffects before shipping.
    expect(
      source.statements.every(
        (statement) => ts.isExportDeclaration(statement) && statement.moduleSpecifier !== undefined
      )
    ).toBe(true)
  })

  it('marks only the furniture entry as side-effect-free, preserving defaults for other modules', async () => {
    const loaded = await loadConfigFromFile({ command: 'build', mode: 'secure' })
    const treeshake = loaded?.config.build?.rollupOptions?.treeshake
    if (!treeshake || treeshake === true || typeof treeshake.moduleSideEffects !== 'function') {
      throw new Error('Expected the scoped render-entry moduleSideEffects rule')
    }
    const rule = treeshake.moduleSideEffects
    expect(rule(entryPath, false)).toBe(false)
    expect(rule(entryPath.replaceAll('/', '\\'), false)).toBe(false)
    for (const file of [
      entryPath.replace('/furniture/index.ts', '/furniture/layer.ts'),
      entryPath.replace('/furniture/index.ts', '/index.ts'),
      entryPath.replace('/@nuan5-pro/render/', '/another-library/'),
      '/app/src/furniture/index.ts',
      '/app/src/App.vue',
    ]) {
      expect(rule(file, false)).toBeUndefined()
    }
  })
})
