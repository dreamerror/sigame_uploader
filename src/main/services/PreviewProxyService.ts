import { randomUUID } from 'node:crypto'
import http, { type IncomingMessage, type OutgoingHttpHeaders, type ServerResponse } from 'node:http'
import https from 'node:https'

interface PreviewProxyTarget {
  mediaUrl: string
  httpHeaders: Record<string, string>
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

  async registerTarget(target: PreviewProxyTarget): Promise<string> {
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

  private buildUpstreamHeaders(
    request: IncomingMessage,
    target: PreviewProxyTarget,
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

      if (value) {
        headers[name] = value
      }
    }

    headers.host = upstreamUrl.host

    return headers
  }
}
