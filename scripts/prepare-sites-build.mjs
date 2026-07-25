import { copyFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const serverDir = resolve('dist/server')
await mkdir(serverDir, { recursive: true })
await copyFile(resolve('worker/index.js'), resolve(serverDir, 'index.js'))
