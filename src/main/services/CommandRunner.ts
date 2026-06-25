import { spawn } from 'node:child_process'

export interface CommandResult {
  stdout: string
  stderr: string
}

export interface CommandFailure extends Error {
  code?: string | number
  stdout?: string
  stderr?: string
}

export function runCommand(
  command: string,
  args: string[],
  timeoutMs = 120_000
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let stdout = ''
    let stderr = ''

    const timer = setTimeout(() => {
      child.kill()
      const error = new Error(`${command} timed out`) as CommandFailure
      error.code = 'ETIMEDOUT'
      error.stdout = stdout
      error.stderr = stderr
      reject(error)
    }, timeoutMs)

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })

    child.on('error', (error: CommandFailure) => {
      clearTimeout(timer)
      error.stdout = stdout
      error.stderr = stderr
      reject(error)
    })

    child.on('close', (code) => {
      clearTimeout(timer)

      if (code === 0) {
        resolve({ stdout, stderr })
        return
      }

      const error = new Error(`${command} exited with code ${code}`) as CommandFailure
      error.code = code ?? 'UNKNOWN'
      error.stdout = stdout
      error.stderr = stderr
      reject(error)
    })
  })
}

