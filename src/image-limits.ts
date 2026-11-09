/** Raster limits applied before a browser is asked to decode an upload. */

export const MAX_UPLOAD_DIMENSION = 8000;
export const MAX_UPLOAD_PIXELS = 16_000_000;

export class ImageLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageLimitError";
  }
}

export interface RasterSize {
  width: number;
  height: number;
}

export function readRasterSize(buffer: Buffer): RasterSize | null {
  if (buffer.length >= 24 && buffer[0] === 0x89 && buffer.toString("ascii", 1, 4) === "PNG") {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (buffer.length >= 10 && buffer.toString("ascii", 0, 3) === "GIF") {
    return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
  }
  if (buffer.length >= 30 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
    const chunk = buffer.toString("ascii", 12, 16);
    if (chunk === "VP8X" && buffer.length >= 30) {
      const width = 1 + buffer.readUIntLE(24, 3);
      const height = 1 + buffer.readUIntLE(27, 3);
      return { width, height };
    }
    if (chunk === "VP8 " && buffer.length >= 30) {
      return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
    }
    if (chunk === "VP8L" && buffer.length >= 25) {
      const b0 = buffer[21];
      const b1 = buffer[22];
      const b2 = buffer[23];
      const b3 = buffer[24];
      const width = 1 + (((b1 & 0x3f) << 8) | b0);
      const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
      return { width, height };
    }
  }
  if (buffer.length > 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) break;
      const marker = buffer[offset + 1];
      const size = buffer.readUInt16BE(offset + 2);
      if (marker >= 0xc0 && marker <= 0xc3) {
        return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
      }
      if (size < 2) break;
      offset += 2 + size;
    }
  }
  return null;
}

export function assertRasterWithinLimits(buffer: Buffer): RasterSize | null {
  const size = readRasterSize(buffer);
  if (!size) return null;
  if (size.width <= 0 || size.height <= 0) {
    throw new ImageLimitError("The image header does not contain a usable width and height.");
  }
  if (size.width > MAX_UPLOAD_DIMENSION || size.height > MAX_UPLOAD_DIMENSION) {
    throw new ImageLimitError(
      `This image is ${size.width} by ${size.height} pixels. The limit is ${MAX_UPLOAD_DIMENSION} pixels on the long side.`
    );
  }
  if (size.width * size.height > MAX_UPLOAD_PIXELS) {
    throw new ImageLimitError(
      `This image would expand to ${size.width * size.height} pixels. The limit is ${MAX_UPLOAD_PIXELS} pixels, so it was not decoded.`
    );
  }
  return size;
}
