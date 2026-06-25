import { existsSync, realpathSync } from 'node:fs'
import path from 'node:path'

export function resolveToolPath(envName: string, commandName: string): string {
  const configuredPath = process.env[envName]

  if (configuredPath) {
    return normalizeExistingPath(configuredPath)
  }

  const wingetLinkPath = process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links', `${commandName}.exe`)
    : undefined

  if (wingetLinkPath && existsSync(wingetLinkPath)) {
    return normalizeExistingPath(wingetLinkPath)
  }

  return commandName
}

function normalizeExistingPath(toolPath: string): string {
  if (!existsSync(toolPath)) {
    return toolPath
  }

  try {
    return realpathSync.native(toolPath)
  } catch {
    return toolPath
  }
}
