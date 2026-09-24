// 메타데이터만 잘라낸다. 화질을 지키려고 픽셀 데이터는 그대로 두고 바이트만 들어낸다.

import { jpegSegments, pngChunks, PNG_PRIVACY_CHUNKS, heicItems } from './exif.js';

// 지울 구간: Exif·XMP(APP1), Photoshop IPTC(APP13), 주석(COM).
// 남길 구간: JFIF(APP0), 색 프로파일 ICC(APP2). 색이 틀어지는 것을 막는다.
const DROP_MARKERS = new Set([0xe1, 0xed, 0xfe]);

function concat(parts, length) {
  const out = new Uint8Array(length);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

export function stripJpeg(bytes) {
  const segments = jpegSegments(bytes);
  if (!segments) return bytes;
  const parts = [bytes.slice(0, 2)];
  let cursor = 2;
  for (const seg of segments) {
    if (seg.marker === 0xda) break;
    if (!DROP_MARKERS.has(seg.marker)) continue;
    parts.push(bytes.slice(cursor, seg.start));
    cursor = seg.end;
  }
  parts.push(bytes.slice(cursor));
  return concat(parts, parts.reduce((sum, p) => sum + p.length, 0));
}

export function stripPng(bytes) {
  const chunks = pngChunks(bytes);
  if (!chunks) return bytes;
  const parts = [bytes.slice(0, 8)];
  for (const chunk of chunks) {
    if (PNG_PRIVACY_CHUNKS.includes(chunk.type)) continue;
    parts.push(bytes.slice(chunk.start, chunk.end));
  }
  return concat(parts, parts.reduce((sum, p) => sum + p.length, 0));
}

// 회전 정보(Orientation)가 있는 사진은 그것까지 지우면 눕거나 뒤집혀 보인다.
// 그래서 회전을 픽셀에 먼저 구워 넣고 다시 저장한다. 이때만 재압축이 일어난다.
//
// 넘기는 blob은 Exif를 이미 걷어낸 것이어야 한다. 브라우저에 따라 createImageBitmap이
// Exif 회전을 자동 적용하는데, 그 상태에서 회전을 또 걸면 원위치로 돌아간다.
export async function bakeOrientation(blob, orientation) {
  const bitmap = await createImageBitmap(blob);
  const swap = orientation >= 5 && orientation <= 8;
  const canvas = document.createElement('canvas');
  canvas.width = swap ? bitmap.height : bitmap.width;
  canvas.height = swap ? bitmap.width : bitmap.height;
  const ctx = canvas.getContext('2d');
  const { width: w, height: h } = bitmap;
  const transforms = {
    2: [-1, 0, 0, 1, w, 0],
    3: [-1, 0, 0, -1, w, h],
    4: [1, 0, 0, -1, 0, h],
    5: [0, 1, 1, 0, 0, 0],
    6: [0, 1, -1, 0, h, 0],
    7: [0, -1, -1, 0, h, w],
    8: [0, -1, 1, 0, 0, w],
  };
  if (transforms[orientation]) ctx.setTransform(...transforms[orientation]);
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.95));
}

// HEIC은 항목을 빼면 뒤쪽 위치표가 전부 어긋난다. 그래서 길이는 그대로 두고
// Exif·XMP 항목의 내용만 0으로 덮는다. 사진 데이터(mdat의 그림 부분)는 건드리지 않는다.
export function stripHeic(bytes) {
  const items = heicItems(bytes).filter(
    (item) => item.kind === 'Exif' || item.kind === 'mime' || item.kind === 'xml ',
  );
  if (items.length === 0) return { bytes, wiped: 0 };

  const out = bytes.slice();
  let wiped = 0;
  for (const item of items) {
    if (item.start < 0 || item.start + item.length > out.length) continue;
    out.fill(0, item.start, item.start + item.length);
    wiped += 1;
  }
  return { bytes: out, wiped };
}

// HEIC처럼 바이트만 들어낼 수 없는 형식은 다시 그려서 JPG로 내보낸다.
// 그림만 옮겨 담으므로 촬영 정보는 따라오지 않는다. 브라우저가 그 형식을 열 수 있어야 한다.
export async function toJpeg(blob, quality = 0.92) {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((out) => (out ? resolve(out) : reject(new Error('변환 실패'))), 'image/jpeg', quality),
  );
}

export function stripBytes(bytes, kind) {
  if (kind === 'jpeg') return stripJpeg(bytes);
  if (kind === 'png') return stripPng(bytes);
  return bytes;
}
