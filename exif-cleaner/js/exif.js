// 이미지에 숨어 있는 메타데이터를 읽는다. 외부 라이브러리 없이 바이트를 직접 해석한다.

const JPEG_TAGS = {
  0x010f: 'make',
  0x0110: 'model',
  0x0112: 'orientation',
  0x0131: 'software',
  0x0132: 'dateTime',
  0x9003: 'dateTimeOriginal',
};

// JPEG는 0xFF 마커로 구간이 나뉜다. 메타데이터는 APP 구간에 들어 있다.
export function jpegSegments(bytes) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const segments = [];
  let at = 2;
  while (at < bytes.length - 1) {
    if (bytes[at] !== 0xff) break;
    const marker = bytes[at + 1];
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2;
      continue;
    }
    const size = (bytes[at + 2] << 8) | bytes[at + 3];
    segments.push({ marker, start: at, bodyStart: at + 4, end: at + 2 + size });
    if (marker === 0xda) break; // 이미지 데이터 시작. 뒤는 건드리지 않는다.
    at += 2 + size;
  }
  return segments;
}

function ascii(bytes, start, length) {
  return String.fromCharCode(...bytes.slice(start, start + length));
}

function readIfd(view, tiffStart, ifdStart, little, out, gps) {
  const count = view.getUint16(ifdStart, little);
  let next = 0;
  for (let i = 0; i < count; i++) {
    const entry = ifdStart + 2 + i * 12;
    const tag = view.getUint16(entry, little);
    const type = view.getUint16(entry + 2, little);
    const num = view.getUint32(entry + 4, little);
    const size = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 }[type] ?? 1;
    const total = size * num;
    const valueAt = total > 4 ? tiffStart + view.getUint32(entry + 8, little) : entry + 8;
    out.count += 1;

    // 하위 IFD 위치
    if (tag === 0x8769) next = tiffStart + view.getUint32(valueAt, little);
    if (tag === 0x8825) gps.at = tiffStart + view.getUint32(valueAt, little);

    if (gps.active) {
      if (tag === 1 || tag === 3) gps[tag === 1 ? 'latRef' : 'lonRef'] = String.fromCharCode(view.getUint8(valueAt));
      if (tag === 2 || tag === 4) {
        const parts = [0, 1, 2].map((n) => {
          const numr = view.getUint32(valueAt + n * 8, little);
          const den = view.getUint32(valueAt + n * 8 + 4, little);
          return den ? numr / den : 0;
        });
        gps[tag === 2 ? 'lat' : 'lon'] = parts[0] + parts[1] / 60 + parts[2] / 3600;
      }
      continue;
    }

    const name = JPEG_TAGS[tag];
    if (!name) continue;
    if (type === 2) out[name] = ascii(new Uint8Array(view.buffer), valueAt, num).replace(/\0+$/, '').trim();
    else if (type === 3) out[name] = view.getUint16(valueAt, little);
  }
  return next;
}

// Exif 본문(TIFF 구조)에서 기기·촬영일시·GPS를 꺼낸다.
function parseExifPayload(bytes, payloadStart) {
  const tiffStart = payloadStart + 6; // 'Exif\0\0' 다음
  const view = new DataView(bytes.buffer, bytes.byteOffset);
  const little = ascii(bytes, tiffStart, 2) === 'II';
  const out = { count: 0 };
  const gps = {};

  const ifd0 = tiffStart + view.getUint32(tiffStart + 4, little);
  const exifIfd = readIfd(view, tiffStart, ifd0, little, out, gps);
  if (exifIfd) readIfd(view, tiffStart, exifIfd, little, out, gps);
  if (gps.at) {
    gps.active = true;
    readIfd(view, tiffStart, gps.at, little, out, gps);
    if (gps.lat != null && gps.lon != null) {
      out.gps = {
        lat: gps.latRef === 'S' ? -gps.lat : gps.lat,
        lon: gps.lonRef === 'W' ? -gps.lon : gps.lon,
      };
    }
  }
  return out;
}

const PNG_PRIVACY_CHUNKS = ['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME'];

export function pngChunks(bytes) {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  if (sig.some((b, i) => bytes[i] !== b)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset);
  const chunks = [];
  let at = 8;
  while (at < bytes.length - 8) {
    const length = view.getUint32(at);
    const type = ascii(bytes, at + 4, 4);
    chunks.push({ type, start: at, end: at + 12 + length });
    if (type === 'IEND') break;
    at += 12 + length;
  }
  return chunks;
}

// { kind, gps, dateTime, make, model, software, orientation, count } 형태로 돌려준다.
export function readMetadata(bytes) {
  const segments = jpegSegments(bytes);
  if (segments) {
    const found = { kind: 'jpeg', count: 0 };
    for (const seg of segments) {
      const isExif = seg.marker === 0xe1 && ascii(bytes, seg.bodyStart, 4) === 'Exif';
      if (isExif) Object.assign(found, parseExifPayload(bytes, seg.bodyStart), { kind: 'jpeg' });
      else if (seg.marker === 0xe1) found.count += 1; // XMP
      else if (seg.marker === 0xed || seg.marker === 0xfe) found.count += 1; // IPTC, 주석
    }
    return found;
  }

  const chunks = pngChunks(bytes);
  if (chunks) {
    const privacy = chunks.filter((c) => PNG_PRIVACY_CHUNKS.includes(c.type));
    return { kind: 'png', count: privacy.length };
  }
  return { kind: 'unknown', count: 0 };
}

export { PNG_PRIVACY_CHUNKS };
