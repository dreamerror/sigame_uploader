import fs from 'node:fs/promises'
import { inflateRawSync } from 'node:zlib'

interface ZipEntry {
  path: string
  data: Buffer
}

interface CentralDirectoryEntry {
  pathBuffer: Buffer
  data: Buffer
  crc: number
  localHeaderOffset: number
}

const UTF8_FLAG = 0x0800
const VERSION_NEEDED = 20
const VERSION_MADE_BY = 20

const CRC_TABLE = new Uint32Array(256)

for (let index = 0; index < CRC_TABLE.length; index += 1) {
  let value = index

  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  }

  CRC_TABLE[index] = value >>> 0
}

export class ZipArchiveService {
  async readArchive(inputPath: string): Promise<ZipEntry[]> {
    const archive = await fs.readFile(inputPath)
    return this.readEntries(archive)
  }

  async writeArchive(outputPath: string, entries: ZipEntry[]): Promise<void> {
    const archive = this.createArchive(entries)
    await fs.writeFile(outputPath, archive)
  }

  private readEntries(archive: Buffer): ZipEntry[] {
    const endRecordOffset = this.findEndRecordOffset(archive)
    const entryCount = archive.readUInt16LE(endRecordOffset + 10)
    const centralOffset = archive.readUInt32LE(endRecordOffset + 16)
    const result: ZipEntry[] = []
    let offset = centralOffset

    for (let index = 0; index < entryCount; index += 1) {
      if (archive.readUInt32LE(offset) !== 0x02014b50) {
        throw new Error('ZIP central directory повреждён.')
      }

      const compressionMethod = archive.readUInt16LE(offset + 10)
      const compressedSize = archive.readUInt32LE(offset + 20)
      const fileNameLength = archive.readUInt16LE(offset + 28)
      const extraLength = archive.readUInt16LE(offset + 30)
      const commentLength = archive.readUInt16LE(offset + 32)
      const localHeaderOffset = archive.readUInt32LE(offset + 42)
      const pathBuffer = archive.subarray(offset + 46, offset + 46 + fileNameLength)
      const entryPath = pathBuffer.toString('utf8')
      const localFileNameLength = archive.readUInt16LE(localHeaderOffset + 26)
      const localExtraLength = archive.readUInt16LE(localHeaderOffset + 28)
      const dataOffset = localHeaderOffset + 30 + localFileNameLength + localExtraLength
      const compressedData = archive.subarray(dataOffset, dataOffset + compressedSize)

      if (!entryPath.endsWith('/')) {
        result.push({
          path: entryPath,
          data: this.decompressEntry(compressedData, compressionMethod)
        })
      }

      offset += 46 + fileNameLength + extraLength + commentLength
    }

    return result
  }

  private decompressEntry(data: Buffer, compressionMethod: number): Buffer {
    if (compressionMethod === 0) {
      return data
    }

    if (compressionMethod === 8) {
      return inflateRawSync(data)
    }

    throw new Error(`ZIP compression method ${compressionMethod} не поддерживается.`)
  }

  private findEndRecordOffset(archive: Buffer): number {
    const minOffset = Math.max(0, archive.length - 0xffff - 22)

    for (let offset = archive.length - 22; offset >= minOffset; offset -= 1) {
      if (archive.readUInt32LE(offset) === 0x06054b50) {
        return offset
      }
    }

    throw new Error('Не найден конец ZIP-архива.')
  }

  private createArchive(entries: ZipEntry[]): Buffer {
    const localParts: Buffer[] = []
    const centralEntries: CentralDirectoryEntry[] = []
    let offset = 0

    for (const entry of entries) {
      const pathBuffer = Buffer.from(this.normalizePath(entry.path), 'utf8')
      const crc = crc32(entry.data)
      const localHeader = this.createLocalHeader(pathBuffer, entry.data, crc)

      localParts.push(localHeader, entry.data)
      centralEntries.push({
        pathBuffer,
        data: entry.data,
        crc,
        localHeaderOffset: offset
      })

      offset += localHeader.length + entry.data.length
    }

    const centralParts = centralEntries.map((entry) => this.createCentralDirectoryHeader(entry))
    const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0)
    const centralOffset = offset
    const endRecord = this.createEndRecord(centralEntries.length, centralSize, centralOffset)

    return Buffer.concat([...localParts, ...centralParts, endRecord])
  }

  private createLocalHeader(pathBuffer: Buffer, data: Buffer, crc: number): Buffer {
    const header = Buffer.alloc(30)

    header.writeUInt32LE(0x04034b50, 0)
    header.writeUInt16LE(VERSION_NEEDED, 4)
    header.writeUInt16LE(UTF8_FLAG, 6)
    header.writeUInt16LE(0, 8)
    header.writeUInt16LE(0, 10)
    header.writeUInt16LE(0, 12)
    header.writeUInt32LE(crc, 14)
    header.writeUInt32LE(data.length, 18)
    header.writeUInt32LE(data.length, 22)
    header.writeUInt16LE(pathBuffer.length, 26)
    header.writeUInt16LE(0, 28)

    return Buffer.concat([header, pathBuffer])
  }

  private createCentralDirectoryHeader(entry: CentralDirectoryEntry): Buffer {
    const header = Buffer.alloc(46)

    header.writeUInt32LE(0x02014b50, 0)
    header.writeUInt16LE(VERSION_MADE_BY, 4)
    header.writeUInt16LE(VERSION_NEEDED, 6)
    header.writeUInt16LE(UTF8_FLAG, 8)
    header.writeUInt16LE(0, 10)
    header.writeUInt16LE(0, 12)
    header.writeUInt16LE(0, 14)
    header.writeUInt32LE(entry.crc, 16)
    header.writeUInt32LE(entry.data.length, 20)
    header.writeUInt32LE(entry.data.length, 24)
    header.writeUInt16LE(entry.pathBuffer.length, 28)
    header.writeUInt16LE(0, 30)
    header.writeUInt16LE(0, 32)
    header.writeUInt16LE(0, 34)
    header.writeUInt16LE(0, 36)
    header.writeUInt32LE(0, 38)
    header.writeUInt32LE(entry.localHeaderOffset, 42)

    return Buffer.concat([header, entry.pathBuffer])
  }

  private createEndRecord(entryCount: number, centralSize: number, centralOffset: number): Buffer {
    const record = Buffer.alloc(22)

    record.writeUInt32LE(0x06054b50, 0)
    record.writeUInt16LE(0, 4)
    record.writeUInt16LE(0, 6)
    record.writeUInt16LE(entryCount, 8)
    record.writeUInt16LE(entryCount, 10)
    record.writeUInt32LE(centralSize, 12)
    record.writeUInt32LE(centralOffset, 16)
    record.writeUInt16LE(0, 20)

    return record
  }

  private normalizePath(value: string): string {
    return value.replace(/\\/g, '/').replace(/^\/+/, '')
  }
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff

  for (const byte of data) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  }

  return (crc ^ 0xffffffff) >>> 0
}
