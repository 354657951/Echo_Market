import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { build } from 'esbuild'

const serverDir = resolve('dist/server')
await mkdir(serverDir, { recursive: true })

// Worker 需要连同共享数据模块和初始商品 JSON 一起打包，避免部署时遗漏依赖。
await build({
  entryPoints: [resolve('worker/index.js')],
  outfile: resolve(serverDir, 'index.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
})
