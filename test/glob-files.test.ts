import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parse } from 'acorn'
import { resolveConfig } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { globFiles, Resolve } from '../src'

let root: string
let resolve: Resolve

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'dynamic-import-glob-'))
  for (const file of [
    'views/alpha.js', 'views/beta.ts', 'views/page.js', 'views/page/index.js',
    'views/nested/deep.js', 'views/.hidden.js', 'views/.private/secret.js',
    'views/ignored.txt',
  ]) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    fs.writeFileSync(path.join(root, file), 'export default 1')
  }
  fs.symlinkSync(path.join(root, 'views/page'), path.join(root, 'views/linked'), 'junction')
  resolve = new Resolve(await resolveConfig({
    configFile: false,
    root,
    resolve: { alias: { '@': root } },
  }, 'build'))
})

afterAll(() => fs.rmSync(root, { recursive: true, force: true }))

async function files(expression: string, loose = true, sorted = true) {
  const ast = parse(expression, { sourceType: 'module', ecmaVersion: 2020 }) as any
  const result = await globFiles({
    importeeNode: ast.body[0].expression.source,
    importExpression: expression,
    importer: path.join(root, 'main.js'),
    resolve,
    extensions: ['.js', '.ts'],
    loose,
  })
  return sorted ? result?.files?.sort() : result?.files
}

describe('globFiles', () => {
  const all = [
    './views/alpha.js', './views/beta.ts', './views/linked/index.js',
    './views/nested/deep.js', './views/page.js', './views/page/index.js',
  ]

  it('expands extension braces, nested paths and directory indexes without duplicates', async () => {
    expect(await files('import(`./views/${name}`)')).toEqual(all)
  })

  it('preserves strict matching and follows directory symlinks', async () => {
    expect(await files('import(`./views/${name}`)', false)).toEqual([
      './views/alpha.js', './views/beta.ts',
      './views/linked/index.js', './views/page.js', './views/page/index.js',
    ])
  })

  it('resolves aliases before searching relative to the importer', async () => {
    expect(await files('import(`@/views/${name}`)')).toEqual(all)
  })

  it('honors explicit extensions and excludes hidden files and directories', async () => {
    expect(await files('import(`./views/${name}.js`)')).toEqual(all.filter(file => file.endsWith('.js')))
  })

  it('returns no matches for missing modules', async () => {
    expect(await files('import(`./missing/${name}`)')).toEqual([])
  })

  it('keeps a module ahead of a directory index with the same import name', async () => {
    const result = await files('import(`./views/${name}`)', true, false)
    expect(result!.indexOf('./views/page.js')).toBeLessThan(result!.indexOf('./views/page/index.js'))
  })
})
