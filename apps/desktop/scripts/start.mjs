/** Launch Electron without inheriting another Electron host's Node-only mode. */

import { spawn } from 'node:child_process'
import electronPath from 'electron'

const environment = { ...process.env }
delete environment.ELECTRON_RUN_AS_NODE

const child = spawn(electronPath, ['.'], {
  cwd: new URL('..', import.meta.url),
  env: environment,
  stdio: 'inherit',
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => { child.kill(signal) })
}

child.once('error', (error) => { throw error })
child.once('exit', (code, signal) => {
  if (signal !== null) process.kill(process.pid, signal)
  else process.exit(code ?? 1)
})
