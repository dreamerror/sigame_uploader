import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import http, { type IncomingMessage, type OutgoingHttpHeaders, type ServerResponse } from 'node:http'
import https from 'node:https'
import path from 'node:path'

type PreviewProxyTarget =
  | {
      type: 'remote'
      mediaUrl: string
      httpHeaders: Record<string, string>
    }
  | {
      type: 'local'
      filePath: string
      contentType: string
    }

const PROXY_HOST = '127.0.0.1'
const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'content-length',
  'host',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade'
])

export class PreviewProxyService {
  private readonly targets = new Map<string, PreviewProxyTarget>()
  private server?: http.Server
  private port?: number

  async registerTarget(target: Omit<Extract<PreviewProxyTarget, { type: 'remote' }>, 'type'>): Promise<string> {
    return this.registerProxyTarget({
      type: 'remote',
      ...target
    })
  }

  async registerLocalFile(filePath: string): Promise<string> {
    const stats = await fsp.stat(filePath)

    if (!stats.isFile()) {
      throw new Error('Preview media path is not a file.')
    }

    return this.registerProxyTarget({
      type: 'local',
      filePath,
      contentType: contentTypeForFile(filePath)
    })
  }

  private async registerProxyTarget(target: PreviewProxyTarget): Promise<string> {
    await this.ensureServer()

    const id = randomUUID()
    this.targets.set(id, target)

    return `http://${PROXY_HOST}:${this.port}/preview/${id}`
  }

  close(): void {
    this.targets.clear()
    this.server?.close()
    this.server = undefined
    this.port = undefined
  }

  private async ensureServer(): Promise<void> {
    if (this.server && this.port) {
      return
    }

    this.server = http.createServer((request, response) => {
      this.handleRequest(request, response)
    })

    await new Promise<void>((resolve, reject) => {
      this.server?.once('error', reject)
      this.server?.listen(0, PROXY_HOST, () => {
        const address = this.server?.address()

        if (typeof address === 'object' && address?.port) {
          this.port = address.port
          resolve()
          return
        }

        reject(new Error('Не удалось запустить локальный preview proxy.'))
      })
    })
  }

  private handleRequest(request: IncomingMessage, response: ServerResponse): void {
    response.setHeader('Access-Control-Allow-Origin', '*')
    response.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS')
    response.setHeader('Access-Control-Allow-Headers', 'Range, If-Range, Accept, Accept-Language')
    response.setHeader('Access-Control-Expose-Headers', 'Accept-Ranges, Content-Length, Content-Range, Content-Type')

    if (request.method === 'OPTIONS') {
      response.writeHead(204)
      response.end()
      return
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405)
      response.end('Method Not Allowed')
      return
    }

    const target = this.resolveTarget(request.url)

    if (!target) {
      response.writeHead(404)
      response.end('Preview target not found')
      return
    }

    if (target.type === 'local') {
      this.streamLocalFile(request, response, target)
      return
    }

    this.proxyRequest(request, response, target)
  }

  private resolveTarget(requestUrl: string | undefined): PreviewProxyTarget | undefined {
    if (!requestUrl) {
      return undefined
    }

    const url = new URL(requestUrl, `http://${PROXY_HOST}`)
    const [, route, id] = url.pathname.split('/')

    if (route !== 'preview' || !id) {
      return undefined
    }

    return this.targets.get(id)
  }

  private proxyRequest(request: IncomingMessage, response: ServerResponse, target: PreviewProxyTarget): void {
    if (target.type !== 'remote') {
      return
    }

    const upstreamUrl = new URL(target.mediaUrl)
    const client = upstreamUrl.protocol === 'https:' ? https : http
    const upstreamRequest = client.request(
      upstreamUrl,
      {
        method: request.method,
        headers: this.buildUpstreamHeaders(request, target, upstreamUrl)
      },
      (upstreamResponse) => {
        const headers = {
          ...upstreamResponse.headers,
          'access-control-allow-origin': '*',
          'access-control-expose-headers': 'Accept-Ranges, Content-Length, Content-Range, Content-Type'
        }

        response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.statusMessage, headers)

        if (request.method === 'HEAD') {
          upstreamResponse.resume()
          response.end()
          return
        }

        upstreamResponse.pipe(response)
      }
    )

    upstreamRequest.on('error', (error) => {
      if (response.headersSent) {
        response.destroy(error)
        return
      }

      response.writeHead(502)
      response.end('Preview proxy upstream error')
    })

    response.on('close', () => {
      if (!response.writableEnded) {
        upstreamRequest.destroy()
      }
    })

    upstreamRequest.end()
  }

  private streamLocalFile(
    request: IncomingMessage,
    response: ServerResponse,
    target: Extract<PreviewProxyTarget, { type: 'local' }>
  ): void {
    fs.stat(target.filePath, (error, stats) => {
      if (error || !stats.isFile()) {
        response.writeHead(404)
        response.end('Local preview file not found')
        return
      }

      const range = request.headers.range
      const headers: OutgoingHttpHeaders = {
        'Accept-Ranges': 'bytes',
        'Content-Type': target.contentType
      }

      if (!range) {
        headers['Content-Length'] = stats.size
        response.writeHead(200, headers)

        if (request.method === 'HEAD') {
          response.end()
          return
        }

        fs.createReadStream(target.filePath).pipe(response)
        return
      }

      const match = range.match(/bytes=(\d*)-(\d*)/)
      const start = match?.[1] ? Number(match[1]) : 0
      const end = match?.[2] ? Number(match[2]) : stats.size - 1
      const safeStart = Math.min(Math.max(start, 0), stats.size - 1)
      const safeEnd = Math.min(Math.max(end, safeStart), stats.size - 1)

      headers['Content-Length'] = safeEnd - safeStart + 1
      headers['Content-Range'] = `bytes ${safeStart}-${safeEnd}/${stats.size}`
      response.writeHead(206, headers)

      if (request.method === 'HEAD') {
        response.end()
        return
      }

      fs.createReadStream(target.filePath, { start: safeStart, end: safeEnd }).pipe(response)
    })
  }

  private buildUpstreamHeaders(
    request: IncomingMessage,
    target: Extract<PreviewProxyTarget, { type: 'remote' }>,
    upstreamUrl: URL
  ): OutgoingHttpHeaders {
    const headers: OutgoingHttpHeaders = {}

    for (const [name, value] of Object.entries(target.httpHeaders)) {
      const normalizedName = name.toLowerCase()

      if (!HOP_BY_HOP_HEADERS.has(normalizedName) && value) {
        headers[name] = value
      }
    }

    for (const name of ['range', 'if-range', 'accept', 'accept-language', 'cache-control', 'pragma']) {
      const value = request.headers[name]

      if (typeof value === 'string' || Array.isArray(value)) {
        headers[name] = value
      }
    }

    headers.host = upstreamUrl.host

    return headers
  }
}

function contentTypeForFile(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase()

  if (extension === '.mp3') return 'audio/mpeg'
  if (extension === '.wav') return 'audio/wav'
  if (extension === '.ogg') return 'audio/ogg'
  if (extension === '.m4a') return 'audio/mp4'
  if (extension === '.mp4') return 'video/mp4'
  if (extension === '.webm') return 'video/webm'
  if (extension === '.mov') return 'video/quicktime'
  if (extension === '.png') return 'image/png'
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg'
  if (extension === '.webp') return 'image/webp'
  if (extension === '.gif') return 'image/gif'
  if (extension === '.html' || extension === '.htm') return 'text/html'

  return 'application/octet-stream'
}
