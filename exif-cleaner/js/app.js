// 진입점. 파일을 받아 메타데이터를 보여주고, 지운 뒤 결과를 확인시킨다.

import { readMetadata } from './exif.js';
import { stripBytes, bakeOrientation } from './strip.js';

const $ = (sel) => document.querySelector(sel);
const list = $('#files');
const cleaned = [];

const KB = (n) => `${(n / 1024).toFixed(n < 10240 ? 1 : 0)}KB`;
const coord = (v, [pos, neg]) => `${Math.abs(v).toFixed(5)}° ${v >= 0 ? pos : neg}`;

function metaRows(meta) {
  const rows = [];
  if (meta.gps) rows.push(['촬영 위치', `${coord(meta.gps.lat, ['N', 'S'])}, ${coord(meta.gps.lon, ['E', 'W'])}`, true]);
  const shot = meta.dateTimeOriginal || meta.dateTime;
  if (shot) rows.push(['촬영 일시', shot, false]);
  const device = [meta.make, meta.model].filter(Boolean).join(' ');
  if (device) rows.push(['촬영 기기', device, false]);
  if (meta.software) rows.push(['편집 프로그램', meta.software, false]);
  return rows;
}

function card(file, meta) {
  const node = document.createElement('article');
  node.className = 'card';
  const rows = metaRows(meta);
  const badge = meta.gps
    ? '<span class="badge danger">위치정보 있음</span>'
    : meta.count > 0
      ? '<span class="badge warn">메타데이터 있음</span>'
      : '<span class="badge ok">지울 것 없음</span>';

  node.innerHTML = `
    <div class="head"><b>${file.name}</b>${badge}</div>
    <div class="grid">
      <section>
        <h3>지우기 전</h3>
        <dl>${rows.map(([k, v, hot]) => `<dt>${k}</dt><dd class="${hot ? 'hot' : ''}">${v}</dd>`).join('')}
          <dt>메타데이터 항목</dt><dd>${meta.count}개</dd>
        </dl>
      </section>
      <section class="after">
        <h3>지운 뒤</h3>
        <p class="pending">처리 중…</p>
      </section>
    </div>`;
  list.append(node);
  return node;
}

async function handle(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const meta = readMetadata(bytes);
  const node = card(file, meta);
  const after = node.querySelector('.after');

  if (meta.kind === 'unknown') {
    after.innerHTML = '<p class="pending">JPG와 PNG만 처리할 수 있어요. 아이폰 HEIC 사진은 JPG로 바꿔서 넣어주세요.</p>';
    return;
  }

  let blob = new Blob([stripBytes(bytes, meta.kind)], { type: file.type });
  let recompressed = false;
  if (meta.kind === 'jpeg' && meta.orientation > 1) {
    const baked = await bakeOrientation(blob, meta.orientation);
    blob = new Blob([stripBytes(new Uint8Array(await baked.arrayBuffer()), 'jpeg')], { type: 'image/jpeg' });
    recompressed = true;
  }

  const check = readMetadata(new Uint8Array(await blob.arrayBuffer()));
  const name = file.name.replace(/(\.[^.]+)$/, '-clean$1');
  cleaned.push({ name, blob });

  after.innerHTML = `
    <dl>
      <dt>촬영 위치</dt><dd class="${check.gps ? 'hot' : 'gone'}">${check.gps ? '남아 있음' : meta.gps ? '지워짐' : '원래 없음'}</dd>
      <dt>메타데이터 항목</dt><dd class="${check.count ? '' : 'gone'}">${check.count}개</dd>
      <dt>용량</dt><dd>${KB(file.size)} → ${KB(blob.size)}${recompressed ? ' (회전 정보 때문에 다시 저장)' : ''}</dd>
    </dl>
    <button type="button" class="download">내려받기</button>`;
  after.querySelector('.download').addEventListener('click', () => download(name, blob));
  $('#download-all').hidden = false;
}

function download(name, blob) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function addFiles(files) {
  $('#empty').hidden = true;
  for (const file of files) await handle(file);
}

$('#picker').addEventListener('change', (e) => addFiles([...e.target.files]));
$('#download-all').addEventListener('click', () => cleaned.forEach(({ name, blob }) => download(name, blob)));

const zone = $('#zone');
['dragenter', 'dragover'].forEach((type) =>
  zone.addEventListener(type, (e) => {
    e.preventDefault();
    zone.classList.add('over');
  }),
);
['dragleave', 'drop'].forEach((type) =>
  zone.addEventListener(type, (e) => {
    e.preventDefault();
    zone.classList.remove('over');
  }),
);
zone.addEventListener('drop', (e) => addFiles([...e.dataTransfer.files]));
