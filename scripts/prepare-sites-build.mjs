import { cp, copyFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { build } from 'esbuild'

const serverDir = resolve('dist/server')
const hostingDir = resolve('dist/.openai')
await mkdir(serverDir, { recursive: true })
await mkdir(hostingDir, { recursive: true })

// Worker 需要连同共享数据模块和初始商品 JSON 一起打包，避免部署时遗漏依赖。
await build({
  entryPoints: [resolve('worker/index.js')],
  outfile: resolve(serverDir, 'index.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
})

// 发布包必须保留 D1/R2 逻辑绑定和迁移文件，否则线上会退回临时文档存储。
await copyFile(resolve('.openai/hosting.json'), resolve(hostingDir, 'hosting.json'))
await cp(resolve('drizzle'), resolve(hostingDir, 'drizzle'), {
  recursive: true,
  force: true,
})
