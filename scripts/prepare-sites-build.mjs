import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const serverDir = resolve('dist/server')
await mkdir(serverDir, { recursive: true })
await writeFile(
  resolve(serverDir, 'index.js'),
  [
    'export default {',
    '  async fetch(request, env) {',
    '    return env.ASSETS.fetch(request)',
    '  },',
    '}',
    '',
  ].join('\n'),
)
