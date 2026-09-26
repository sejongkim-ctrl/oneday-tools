// 여러 장을 ZIP 한 개로 묶는다.
// 브라우저가 연속 다운로드를 막아 일부가 조용히 빠지는 것을 피하려는 목적이다.
// 사진은 이미 압축된 파일이라 압축 없이 담는다(store 방식). 외부 라이브러리가 필요 없다.

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ZIP은 MS-DOS 시절 형식이라 날짜·시각을 2바이트씩 눌러 담는다.
function dosTime(date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

function header(name, data, offset, when) {
  const nameBytes = new TextEncoder().encode(name);
  const { time, day } = dosTime(when);
  const crc = crc32(data);

  const local = new DataView(new ArrayBuffer(30));
  local.setUint32(0, 0x04034b50, true);
  local.setUint16(4, 20, true); // 풀기에 필요한 버전
  local.setUint16(6, 0x0800, true); // 파일명 UTF-8
  local.setUint16(8, 0, true); // 압축 없음
  local.setUint16(10, time, true);
  local.setUint16(12, day, true);
  local.setUint32(14, crc, true);
  local.setUint32(18, data.length, true);
  local.setUint32(22, data.length, true);
  local.setUint16(26, nameBytes.length, true);

  const central = new DataView(new ArrayBuffer(46));
  central.setUint32(0, 0x02014b50, true);
  central.setUint16(4, 20, true);
  central.setUint16(6, 20, true);
  central.setUint16(8, 0x0800, true);
  central.setUint16(10, 0, true);
  central.setUint16(12, time, true);
  central.setUint16(14, day, true);
  central.setUint32(16, crc, true);
  central.setUint32(20, data.length, true);
  central.setUint32(24, data.length, true);
  central.setUint16(28, nameBytes.length, true);
  central.setUint32(42, offset, true);

  return { nameBytes, local: new Uint8Array(local.buffer), central: new Uint8Array(central.buffer) };
}

// files: [{ name, blob }] → ZIP Blob
export async function zip(files, when = new Date()) {
  const parts = [];
  const directory = [];
  let offset = 0;

  for (const file of files) {
    const data = new Uint8Array(await file.blob.arrayBuffer());
    const { nameBytes, local, central } = header(file.name, data, offset, when);
    parts.push(local, nameBytes, data);
    directory.push(central, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }

  const dirSize = directory.reduce((sum, part) => sum + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, dirSize, true);
  end.setUint32(16, offset, true);

  return new Blob([...parts, ...directory, new Uint8Array(end.buffer)], { type: 'application/zip' });
}
