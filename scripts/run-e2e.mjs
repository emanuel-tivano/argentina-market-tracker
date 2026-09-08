import { spawn } from 'node:child_process'

const SERVER_URL = 'http://127.0.0.1:3100'
const SERVER_PORT = '3100'
const SERVER_START_TIMEOUT_MS = 120_000
const SERVER_STOP_TIMEOUT_MS = 10_000
const SSR_PANEL_FIXTURE = JSON.stringify({
  lider: [
    {
      simbolo: 'GGAL',
      descripcion: 'Grupo Financiero Galicia',
      ultimoPrecio: 4200.5,
      variacionPorcentual: 1.25,
      volumen: 120000,
    },
  ],
})

function parseArgs(argv) {
  const nextArgs = []
  let mode = 'default'

  for (const arg of argv) {
    if (arg.startsWith('--mode=')) {
      mode = arg.slice('--mode='.length)
      continue
    }

    nextArgs.push(arg)
  }

  return {
    mode,
    playwrightArgs: nextArgs,
  }
}

function spawnCommand(command, args, options = {}) {
  return spawn(command, args, {
    stdio: 'inherit',
    shell: false,
    ...options,
  })
}

function withDefinedEnv(env) {
  return Object.fromEntries(
    Object.entries(env).filter(([, value]) => value !== undefined)
  )
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)

      if (response.ok || response.status === 404) {
        return
      }
    } catch {
      // Server not ready yet.
    }

    await delay(500)
  }

  throw new Error(`Timed out waiting for ${url}`)
}

async function terminateServer(serverProcess) {
  if (serverProcess.exitCode !== null) {
    return
  }

  serverProcess.kill()

  await Promise.race([
    new Promise((resolve) => serverProcess.once('exit', resolve)),
    delay(SERVER_STOP_TIMEOUT_MS),
  ])

  if (serverProcess.exitCode !== null) {
    return
  }

  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/pid', String(serverProcess.pid), '/t', '/f'], {
      stdio: 'ignore',
      shell: false,
    })

    await new Promise((resolve) => {
      killer.once('exit', resolve)
      killer.once('error', resolve)
    })

    return
  }

  serverProcess.kill('SIGKILL')
  await new Promise((resolve) => serverProcess.once('exit', resolve))
}

async function main() {
  const nextBin = './node_modules/next/dist/bin/next'
  const playwrightCli = './node_modules/@playwright/test/cli.js'
  const { mode, playwrightArgs } = parseArgs(process.argv.slice(2))
  const isSsrMode = mode === 'ssr'
  const resolvedPlaywrightArgs =
    playwrightArgs.length > 0
      ? playwrightArgs
      : isSsrMode
        ? ['e2e/dashboard-ssr.spec.ts']
        : []
  const serverProcess = spawnCommand(
    process.execPath,
    [nextBin, 'start', '-p', SERVER_PORT],
    {
      env: withDefinedEnv({
        ...process.env,
        MARKET_DATA_SOURCE: process.env.MARKET_DATA_SOURCE ?? 'demo',
        PLAYWRIGHT_E2E_MODE: mode,
        DISABLE_SERVER_DASHBOARD_PREFETCH:
          process.env.DISABLE_SERVER_DASHBOARD_PREFETCH ??
          (isSsrMode ? '0' : '1'),
        PANEL_RESPONSE_FIXTURE_JSON:
          process.env.PANEL_RESPONSE_FIXTURE_JSON ??
          (isSsrMode ? SSR_PANEL_FIXTURE : undefined),
      }),
    }
  )

  let exitCode = 1

  const forwardSignal = (signal) => {
    if (serverProcess.exitCode === null) {
      serverProcess.kill(signal)
    }
  }

  process.on('SIGINT', forwardSignal)
  process.on('SIGTERM', forwardSignal)

  try {
    await waitForServer(SERVER_URL, SERVER_START_TIMEOUT_MS)
    console.log(
      `[run-e2e] mode=${mode} args=${
        resolvedPlaywrightArgs.length > 0
          ? resolvedPlaywrightArgs.join(' ')
          : '(default)'
      }`
    )

    exitCode = await new Promise((resolve, reject) => {
      const playwrightProcess = spawnCommand(
        process.execPath,
        [playwrightCli, 'test', ...resolvedPlaywrightArgs],
        {
          env: {
            ...process.env,
            PLAYWRIGHT_TEST_BASE_URL: SERVER_URL,
            PLAYWRIGHT_E2E_MODE: mode,
          },
        }
      )

      playwrightProcess.once('exit', (code) => resolve(code ?? 1))
      playwrightProcess.once('error', reject)
    })
  } finally {
    process.off('SIGINT', forwardSignal)
    process.off('SIGTERM', forwardSignal)
    await terminateServer(serverProcess)
  }

  process.exit(exitCode)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
