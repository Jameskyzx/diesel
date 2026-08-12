import type { ChatAttachmentMediaType } from "@/features/ai/attachments";

export const MIN_CHAT_IMAGE_DIMENSION = 11;
export const MAX_CHAT_IMAGE_DIMENSION = 8_192;
export const MAX_CHAT_IMAGE_PIXELS = 20_000_000;

function hasPrefix(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return prefix.every((value, index) => bytes[index] === value);
}

function readUint16BigEndian(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! * 0x100 + bytes[offset + 1]!;
}

function readUint16LittleEndian(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! + bytes[offset + 1]! * 0x100;
}

function readUint24LittleEndian(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset]! +
    bytes[offset + 1]! * 0x100 +
    bytes[offset + 2]! * 0x1_0000
  );
}

function readUint32BigEndian(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset]! * 0x1_000000 +
    bytes[offset + 1]! * 0x1_0000 +
    bytes[offset + 2]! * 0x100 +
    bytes[offset + 3]!
  );
}

function readUint32LittleEndian(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset]! +
    bytes[offset + 1]! * 0x100 +
    bytes[offset + 2]! * 0x1_0000 +
    bytes[offset + 3]! * 0x1_000000
  );
}

function hasSafeImageDimensions(width: number, height: number): boolean {
  return (
    Number.isInteger(width) &&
    Number.isInteger(height) &&
    width >= MIN_CHAT_IMAGE_DIMENSION &&
    height >= MIN_CHAT_IMAGE_DIMENSION &&
    width <= MAX_CHAT_IMAGE_DIMENSION &&
    height <= MAX_CHAT_IMAGE_DIMENSION &&
    width * height <= MAX_CHAT_IMAGE_PIXELS
  );
}

function isStructurallyValidPng(bytes: Uint8Array): boolean {
  if (
    bytes.length < 45 ||
    !hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  ) {
    return false;
  }

  let offset = 8;
  let hasHeader = false;
  let hasImageData = false;
  while (offset + 12 <= bytes.length) {
    const chunkLength = readUint32BigEndian(bytes, offset);
    const dataStart = offset + 8;
    const dataEnd = dataStart + chunkLength;
    const chunkEnd = dataEnd + 4;
    if (chunkEnd > bytes.length) {
      return false;
    }
    const chunkType = String.fromCharCode(
      ...bytes.slice(offset + 4, offset + 8),
    );

    if (chunkType === "IHDR") {
      if (hasHeader || offset !== 8 || chunkLength !== 13) {
        return false;
      }
      hasHeader = hasSafeImageDimensions(
        readUint32BigEndian(bytes, dataStart),
        readUint32BigEndian(bytes, dataStart + 4),
      );
      if (!hasHeader) {
        return false;
      }
    } else if (chunkType === "IDAT") {
      hasImageData ||= chunkLength > 0;
    } else if (chunkType === "IEND") {
      return (
        chunkLength === 0 &&
        chunkEnd === bytes.length &&
        hasHeader &&
        hasImageData
      );
    }

    offset = chunkEnd;
  }

  return false;
}

const jpegStartOfFrameMarkers = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd,
  0xce, 0xcf,
]);

function isStructurallyValidJpeg(bytes: Uint8Array): boolean {
  if (
    bytes.length < 12 ||
    !hasPrefix(bytes, [0xff, 0xd8, 0xff]) ||
    bytes.at(-2) !== 0xff ||
    bytes.at(-1) !== 0xd9
  ) {
    return false;
  }

  let offset = 2;
  let hasDimensions = false;
  while (offset + 1 < bytes.length - 2) {
    if (bytes[offset] !== 0xff) {
      return false;
    }
    while (bytes[offset] === 0xff) {
      offset += 1;
    }
    const marker = bytes[offset]!;
    offset += 1;
    if (marker === 0xda) {
      return hasDimensions;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      continue;
    }
    if (offset + 2 > bytes.length - 2) {
      return false;
    }
    const segmentLength = readUint16BigEndian(bytes, offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length - 2) {
      return false;
    }
    if (jpegStartOfFrameMarkers.has(marker)) {
      if (segmentLength < 8) {
        return false;
      }
      hasDimensions = hasSafeImageDimensions(
        readUint16BigEndian(bytes, offset + 5),
        readUint16BigEndian(bytes, offset + 3),
      );
      if (!hasDimensions) {
        return false;
      }
    }
    offset += segmentLength;
  }

  return false;
}

function isStructurallyValidWebp(bytes: Uint8Array): boolean {
  if (
    bytes.length < 30 ||
    !hasPrefix(bytes, [0x52, 0x49, 0x46, 0x46]) ||
    !hasPrefix(bytes.slice(8), [0x57, 0x45, 0x42, 0x50]) ||
    readUint32LittleEndian(bytes, 4) !== bytes.length - 8
  ) {
    return false;
  }

  let offset = 12;
  let dimensions: { height: number; width: number } | null = null;
  let hasImagePayload = false;
  while (offset + 8 <= bytes.length) {
    const chunkType = String.fromCharCode(...bytes.slice(offset, offset + 4));
    const chunkLength = readUint32LittleEndian(bytes, offset + 4);
    const dataStart = offset + 8;
    const dataEnd = dataStart + chunkLength;
    const nextOffset = dataEnd + (chunkLength % 2);
    if (dataEnd > bytes.length || nextOffset > bytes.length) {
      return false;
    }

    if (chunkType === "VP8X" && chunkLength >= 10) {
      dimensions = {
        height: readUint24LittleEndian(bytes, dataStart + 7) + 1,
        width: readUint24LittleEndian(bytes, dataStart + 4) + 1,
      };
    } else if (
      chunkType === "VP8 " &&
      chunkLength >= 10 &&
      hasPrefix(bytes.slice(dataStart + 3), [0x9d, 0x01, 0x2a])
    ) {
      dimensions = {
        height: readUint16LittleEndian(bytes, dataStart + 8) & 0x3fff,
        width: readUint16LittleEndian(bytes, dataStart + 6) & 0x3fff,
      };
      hasImagePayload = true;
    } else if (
      chunkType === "VP8L" &&
      chunkLength >= 5 &&
      bytes[dataStart] === 0x2f
    ) {
      dimensions = {
        height:
          ((bytes[dataStart + 2]! >> 6) |
            (bytes[dataStart + 3]! << 2) |
            ((bytes[dataStart + 4]! & 0x0f) << 10)) +
          1,
        width:
          (bytes[dataStart + 1]! |
            ((bytes[dataStart + 2]! & 0x3f) << 8)) +
          1,
      };
      hasImagePayload = true;
    } else if (chunkType === "ANMF" && chunkLength > 16) {
      hasImagePayload = true;
    }

    offset = nextOffset;
  }

  return (
    offset === bytes.length &&
    dimensions !== null &&
    hasImagePayload &&
    hasSafeImageDimensions(dimensions.width, dimensions.height)
  );
}

export function hasStructurallyValidChatImage(
  mediaType: ChatAttachmentMediaType,
  bytes: Uint8Array,
): boolean {
  if (mediaType === "image/png") {
    return isStructurallyValidPng(bytes);
  }
  if (mediaType === "image/jpeg") {
    return isStructurallyValidJpeg(bytes);
  }
  if (mediaType === "image/webp") {
    return isStructurallyValidWebp(bytes);
  }
  return false;
}
