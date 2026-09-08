import path from 'node:path'
import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      'server-only': path.resolve(__dirname, 'src/test/server-only.ts'),
    },
  },
  test: {
    coverage: {
      exclude: [
        'src/test/**',
        '**/*.test.{ts,tsx}',
        '**/*.d.ts',
      ],
      include: ['src/**/*.{ts,tsx}'],
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      thresholds: {
        branches: 70,
        functions: 75,
        lines: 80,
        statements: 80,
        'src/features/dashboard/favorites/useFavoritePanel.ts': {
          branches: 85,
          functions: 80,
          lines: 90,
          statements: 90,
        },
        'src/features/dashboard/stock-detail/useStockHistory.ts': {
          branches: 80,
          functions: 95,
          lines: 95,
          statements: 95,
        },
        'src/lib/server/core/env.ts': {
          branches: 65,
          functions: 85,
          lines: 90,
          statements: 90,
        },
        'src/lib/server/core/rateLimit.ts': {
          branches: 85,
          functions: 95,
          lines: 90,
          statements: 90,
        },
        'src/lib/server/core/serverUrl.ts': {
          branches: 90,
          functions: 100,
          lines: 90,
          statements: 90,
        },
        'src/lib/server/history/historyCache.ts': {
          branches: 80,
          functions: 100,
          lines: 90,
          statements: 90,
        },
        'src/lib/server/quote/quoteCache.ts': {
          branches: 80,
          functions: 80,
          lines: 85,
          statements: 85,
        },
        'src/lib/server/upstream/iol.ts': {
          branches: 55,
          functions: 85,
          lines: 75,
          statements: 75,
        },
        'src/lib/server/upstream/quoteCache.ts': {
          branches: 90,
          functions: 100,
          lines: 95,
          statements: 95,
        },
      },
    },
    environment: 'node',
    exclude: [...configDefaults.exclude, 'e2e/**'],
    maxWorkers: 2,
    minWorkers: 1,
  },
})
