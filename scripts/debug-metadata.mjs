import { spawn } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import path from 'node:path'

const url = process.argv[2]

if (!url) {
  console.error('Укажите ссылку YouTube:')
  console.error('npm run debug:metadata -- "https://www.youtube.com/watch?v=..."')
  process.exit(1)
}

const ytDlpPath = resolveToolCommand({
  envName: 'YT_DLP_PATH',
  fallbackCommand: 'yt-dlp'
})

const args = [
  '--dump-single-json',
  '--no-playlist',
  '--skip-download',
  '--no-warnings',
  '--force-ipv4',
  '--socket-timeout',
  '30',
  url
]

console.log(`yt-dlp: ${ytDlpPath}`)
console.log(`URL: ${url}`)
console.log('Получаю метаданные...')

const startedAt = Date.now()
const result = await runCommand(ytDlpPath, args, 120_000)
const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(1)

if (!result.ok) {
  console.error(`Ошибка за ${elapsedSeconds} сек.`)
  console.error(result.message)

  if (result.stderr) {
    console.error('\nstderr:')
    console.error(result.stderr.trim())
  }

  if (result.stdout) {
    console.error('\nstdout:')
    console.error(result.stdout.trim())
  }

  process.exit(1)
}

const payload = JSON.parse(result.stdout)

console.log(`OK за ${elapsedSeconds} сек.`)
console.log(`Название: ${payload.title || 'без названия'}`)
console.log(`Длительность: ${payload.duration ?? 'неизвестно'} сек.`)
console.log(`Thumbnail: ${payload.thumbnail || 'нет'}`)

function runCommand(command, args, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })

    let stdout = ''
    let stderr = ''

    const timer = setTimeout(() => {
      child.kill()
      resolve({
        ok: false,
        stdout,
        stderr,
        message: `Команда остановлена по таймауту ${Math.round(timeoutMs / 1000)} секунд.`
      })
    }, timeoutMs)

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })

    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({
        ok: false,
        stdout,
        stderr,
        message: error.message
      })
    })

    child.on('close', (code) => {
      clearTimeout(timer)

      if (code === 0) {
        resolve({ ok: true, stdout, stderr })
        return
      }

      resolve({
        ok: false,
        stdout,
        stderr,
        message: `yt-dlp завершился с кодом ${code}.`
      })
    })
  })
}

function resolveToolCommand(tool) {
  if (process.env[tool.envName]) {
    return normalizeExistingPath(process.env[tool.envName])
  }

  const wingetLinkPath = process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links', `${tool.fallbackCommand}.exe`)
    : undefined

  if (wingetLinkPath && existsSync(wingetLinkPath)) {
    return normalizeExistingPath(wingetLinkPath)
  }

  return tool.fallbackCommand
}

function normalizeExistingPath(toolPath) {
  if (!existsSync(toolPath)) {
    return toolPath
  }

  try {
    return realpathSync.native(toolPath)
  } catch {
    return toolPath
  }
}
