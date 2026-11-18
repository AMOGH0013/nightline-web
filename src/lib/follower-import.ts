import "server-only";
import { inflateRawSync } from "node:zlib";
import { parseInstagramFollowerFiles, type ParsedFollowerFiles } from "@/lib/follower-import-format";

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const MAX_UNZIPPED_BYTES = 35 * 1024 * 1024;

export async function parseFollowerUpload(files: File[]): Promise<ParsedFollowerFiles> {
  if (!files.length || files.length > 20) throw new Error("Upload between one and twenty JSON/ZIP files.");
  const sources: { name: string; text: string }[] = [];
  let uploadBytes = 0;
  for (const file of files) {
    uploadBytes += file.size;
    if (!file.size || uploadBytes > MAX_UPLOAD_BYTES) throw new Error("Follower export uploads must total 20 MB or less.");
    const bytes = Buffer.from(await file.arrayBuffer());
    if (file.name.toLowerCase().endsWith(".zip") || (bytes[0] === 0x50 && bytes[1] === 0x4b)) {
      sources.push(...unzipJsonSources(file.name, bytes));
    } else if (file.name.toLowerCase().endsWith(".json")) {
      sources.push({ name: safeFileName(file.name), text: bytes.toString("utf8") });
    } else {
      throw new Error("Only Instagram JSON exports and ZIP archives are supported.");
    }
  }
  if (!sources.length) throw new Error("No JSON files were found in the upload.");
  return parseInstagramFollowerFiles(sources);
}

function unzipJsonSources(archiveName: string, bytes: Buffer) {
  const eocd = findEndOfCentralDirectory(bytes);
  const count = bytes.readUInt16LE(eocd + 10);
  const directorySize = bytes.readUInt32LE(eocd + 12);
  let offset = bytes.readUInt32LE(eocd + 16);
  if (count > 100 || offset + directorySize > bytes.length) throw new Error("ZIP archive has an unsupported directory size.");
  const sources: { name: string; text: string }[] = [];
  let expandedBytes = 0;
  for (let index = 0; index < count; index += 1) {
    if (bytes.readUInt32LE(offset) !== 0x02014b50) throw new Error("ZIP directory is malformed.");
    const flags = bytes.readUInt16LE(offset + 8);
    const method = bytes.readUInt16LE(offset + 10);
    const compressedSize = bytes.readUInt32LE(offset + 20);
    const uncompressedSize = bytes.readUInt32LE(offset + 24);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const localOffset = bytes.readUInt32LE(offset + 42);
    const entryName = bytes.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    offset += 46 + nameLength + extraLength + commentLength;
    const leafName = entryName.replaceAll("\\", "/").split("/").at(-1) ?? "";
    if (!/^followers(?:_\d+)?\.json$/i.test(leafName) && !/^relationships_followers(?:_\d+)?\.json$/i.test(leafName)) continue;
    if ((flags & 1) !== 0 || (method !== 0 && method !== 8) || compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) {
      throw new Error(`Unsupported ZIP entry: ${safeFileName(entryName)}`);
    }
    expandedBytes += uncompressedSize;
    if (expandedBytes > MAX_UNZIPPED_BYTES || localOffset + 30 > bytes.length || bytes.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error("ZIP archive exceeds the 35 MB expanded limit or is malformed.");
    }
    const localNameLength = bytes.readUInt16LE(localOffset + 26);
    const localExtraLength = bytes.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = bytes.subarray(dataOffset, dataOffset + compressedSize);
    const content = method === 0 ? compressed : inflateRawSync(compressed, { maxOutputLength: MAX_UNZIPPED_BYTES });
    if (content.length !== uncompressedSize) throw new Error(`ZIP entry size did not match: ${safeFileName(entryName)}`);
    sources.push({ name: `${safeFileName(archiveName)}:${safeFileName(entryName)}`, text: content.toString("utf8") });
  }
  return sources;
}

function findEndOfCentralDirectory(bytes: Buffer) {
  const minimum = Math.max(0, bytes.length - 65_557);
  for (let offset = bytes.length - 22; offset >= minimum; offset -= 1) {
    if (bytes.readUInt32LE(offset) === 0x06054b50) {
      const disk = bytes.readUInt16LE(offset + 4);
      const directoryDisk = bytes.readUInt16LE(offset + 6);
      if (disk !== 0 || directoryDisk !== 0 || offset + 22 + bytes.readUInt16LE(offset + 20) > bytes.length) {
        throw new Error("Multi-volume ZIP files are not supported.");
      }
      return offset;
    }
  }
  throw new Error("The ZIP archive is invalid or unsupported.");
}

function safeFileName(name: string) {
  return name.replaceAll("\\", "/").split("/").filter(Boolean).at(-1)?.replace(/[\r\n\0]/g, "") || "export.json";
}
