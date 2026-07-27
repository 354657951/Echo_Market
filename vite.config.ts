import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const isGitHubPagesBuild = mode === 'github-pages'

  return {
    // GitHub Pages 项目站点位于仓库子路径下，其他环境仍使用根路径。
    base: isGitHubPagesBuild ? '/Echo_Market/' : '/',
    plugins: [react()],
    build: {
      outDir: isGitHubPagesBuild ? 'dist/pages' : 'dist/client',
    },
    server: {
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:8787',
          changeOrigin: true,
        },
      },
    },
  }
})
