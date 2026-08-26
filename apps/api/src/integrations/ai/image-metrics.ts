/**
 * Reads image dimensions straight from file headers.
 *
 * A dedicated dependency (sharp, image-size) is avoided here on purpose: sharp
 * needs a native build, which complicates the Docker image and the client's
 * long-term maintenance, and all the media pipeline needs is width, height and
 * format. Supports the formats accepted for property photos: JPEG, PNG, WebP.
 * HEIC is accepted for upload but converted by the client before it reaches R2.
 */

export interface ImageDimensions {
  width: number;
  height: number;
  format: 'jpeg' | 'png' | 'webp';
}

export function measureImage(buffer: Buffer): ImageDimensions | null {
  return measurePng(buffer) ?? measureJpeg(buffer) ?? measureWebp(buffer);
}

function measurePng(buffer: Buffer): ImageDimensions | null {
  // 89 50 4E 47 0D 0A 1A 0A, then IHDR at byte 16.
  if (buffer.length < 24) return null;
  if (buffer.readUInt32BE(0) !== 0x89504e47 || buffer.readUInt32BE(4) !== 0x0d0a1a0a) return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20), format: 'png' };
}

function measureJpeg(buffer: Buffer): ImageDimensions | null {
  if (buffer.length < 4 || buffer.readUInt16BE(0) !== 0xffd8) return null;

  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];

    // Standalone markers carry no length field.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    // Start of Frame markers hold the dimensions. DHT/DAC/SOS are excluded.
    const isSof =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7),
        format: 'jpeg',
      };
    }

    const segmentLength = buffer.readUInt16BE(offset + 2);
    if (segmentLength < 2) return null;
    offset += 2 + segmentLength;
  }
  return null;
}

function measureWebp(buffer: Buffer): ImageDimensions | null {
  if (buffer.length < 30) return null;
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') return null;

  const chunk = buffer.toString('ascii', 12, 16);

  if (chunk === 'VP8 ') {
    // Lossy: 14-bit dimensions after the 3-byte start code.
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff,
      format: 'webp',
    };
  }
  if (chunk === 'VP8L') {
    // Lossless: 14 bits each, packed into 4 bytes after the signature byte.
    const bits = buffer.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1, format: 'webp' };
  }
  if (chunk === 'VP8X') {
    // Extended: 24-bit minus-one dimensions.
    const width = 1 + (buffer[24] | (buffer[25] << 8) | (buffer[26] << 16));
    const height = 1 + (buffer[27] | (buffer[28] << 8) | (buffer[29] << 16));
    return { width, height, format: 'webp' };
  }
  return null;
}

/** Maps a MIME type to the file extension used in the R2 object key. */
export function extensionForMime(mime: string): string {
  switch (mime.toLowerCase()) {
    case 'image/jpeg':
    case 'image/jpg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    case 'image/heic':
    case 'image/heif':
      return 'heic';
    default:
      return 'bin';
  }
}
