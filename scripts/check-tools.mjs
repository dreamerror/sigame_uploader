import { spawn } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import path from 'node:path'

const tools = [
  {
    name: 'yt-dlp',
    envName: 'YT_DLP_PATH',
    fallbackCommand: 'yt-dlp',
    args: ['--version']
  },
  {
    name: 'ffmpeg',
    envName: 'FFMPEG_PATH',
    fallbackCommand: 'ffmpeg',
    args: ['-version']
  },
  {
    name: 'ffprobe',
    envName: 'FFPROBE_PATH',
    fallbackCommand: 'ffprobe',
    args: ['-version']
  }
]

function checkTool(tool) {
  const command = resolveToolCommand(tool)

  return new Promise((resolve) => {
    const child = spawn(command, tool.args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })

    let output = ''
    let errorOutput = ''

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      output += chunk
    })
    child.stderr.on('data', (chunk) => {
      errorOutput += chunk
    })

    child.on('error', (error) => {
      resolve({
        ok: false,
        tool,
        command,
        message: error.code === 'ENOENT' ? 'команда не найдена' : error.message
      })
    })

    child.on('close', (code) => {
      if (code === 0) {
        resolve({
          ok: true,
          tool,
          command,
          version: firstLine(output || errorOutput)
        })
        return
      }

      resolve({
        ok: false,
        tool,
        command,
        message: `команда завершилась с кодом ${code}`,
        details: firstLine(errorOutput || output)
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

function firstLine(value) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)
}

const results = await Promise.all(tools.map(checkTool))
let hasFailures = false

for (const result of results) {
  if (result.ok) {
    console.log(`OK: ${result.tool.name} найден (${result.command})${result.version ? `: ${result.version}` : ''}`)
    continue
  }

  hasFailures = true
  console.error(`Ошибка: ${result.tool.name} не найден или недоступен (${result.command}).`)
  console.error(`Причина: ${result.message}.`)

  if (result.details) {
    console.error(`Детали: ${result.details}`)
  }

  console.error(
    `Подсказка: установите ${result.tool.name} и добавьте его в PATH или задайте ${result.tool.envName}.`
  )
}

if (hasFailures) {
  console.error('\nНе все внешние инструменты доступны. Живой экспорт YouTube-фрагмента работать не будет.')
  process.exitCode = 1
} else {
  console.log('\nВсе внешние инструменты доступны.')
}
