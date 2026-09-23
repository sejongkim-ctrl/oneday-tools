// 진입점. 파일을 받아 메타데이터를 보여주고, 지운 뒤 결과를 확인시킨다.

import { readMetadata } from './exif.js';
import { stripBytes, bakeOrientation } from './strip.js';

const $ = (sel) => document.querySelector(sel);
const cleaned = [];
let handled = 0;
let hadLocation = 0;

const KB = (n) => `${(n / 1024).toFixed(n < 10240 ? 1 : 0)}KB`;
const coord = (v, [pos, neg]) => `${Math.abs(v).toFixed(5)}° ${v >= 0 ? pos : neg}`;

function metaRows(meta) {
  const rows = [];
  if (meta.gps) rows.push(['촬영 장소', `${coord(meta.gps.lat, ['N', 'S'])}, ${coord(meta.gps.lon, ['E', 'W'])}`, true]);
  const shot = meta.dateTimeOriginal || meta.dateTime;
  if (shot) rows.push(['촬영 일시', shot.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3'), false]);
  const device = [meta.make, meta.model].filter(Boolean).join(' ');
  if (device) rows.push(['촬영 기기', device, false]);
  if (meta.software) rows.push(['편집 프로그램', meta.software, false]);
  return rows;
}

function badgeFor(meta) {
  if (meta.gps) return ['danger', '위치정보 있음'];
  if (meta.count > 0) return ['warn', '촬영 정보 있음'];
  return ['ok', '지울 것 없음'];
}

function card(file, meta) {
  const [tone, text] = badgeFor(meta);
  const rows = metaRows(meta);
  const node = document.createElement('article');
  node.className = 'card';
  node.innerHTML = `
    <div class="head">
      <img class="thumb" alt="">
      <div class="head-text">
        <b>${file.name}</b>
        <span class="badge ${tone}">${text}</span>
      </div>
    </div>
    <div class="grid">
      <section class="before">
        <h3>지금 이 사진에 담긴 정보</h3>
        <dl>${rows.map(([k, v, hot]) => `<dt>${k}</dt><dd class="${hot ? 'hot' : ''}">${v}</dd>`).join('')}
          <dt>항목 수</dt><dd>${meta.count}개</dd>
        </dl>
      </section>
      <section class="after">
        <h3>지운 뒤</h3>
        <p class="pending">처리 중…</p>
      </section>
    </div>`;
  const url = URL.createObjectURL(file);
  const thumb = node.querySelector('.thumb');
  thumb.src = url;
  thumb.addEventListener('load', () => URL.revokeObjectURL(url), { once: true });
  $('#files').append(node);
  return node;
}

function updateSummary() {
  const done = cleaned.length;
  $('#summary').textContent = hadLocation
    ? `사진 ${handled}장 중 ${hadLocation}장에서 위치정보를 지웠어요.`
    : `사진 ${handled}장을 정리했어요. 위치정보는 원래 없었어요.`;
  $('#bar').hidden = done === 0;
  $('#bar-text').textContent = `정리 완료 ${done}장`;
  $('#download-all').textContent = done > 1 ? `전부 내려받기 (${done}장)` : '내려받기';
}

async function handle(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const meta = readMetadata(bytes);
  const node = card(file, meta);
  const after = node.querySelector('.after');
  handled += 1;
  if (meta.gps) hadLocation += 1;

  if (meta.kind === 'unknown') {
    after.innerHTML =
      '<h3>지운 뒤</h3><p class="pending">JPG와 PNG만 처리할 수 있어요.<br>아이폰 HEIC 사진은 설정 → 카메라 → 포맷에서 "높은 호환성"으로 바꾸거나, 미리보기 앱에서 JPG로 내보낸 뒤 넣어주세요.</p>';
    updateSummary();
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
    <h3>지운 뒤</h3>
    <dl>
      <dt>촬영 장소</dt><dd class="${check.gps ? 'hot' : 'gone'}">${check.gps ? '남아 있음' : meta.gps ? '지워짐' : '원래 없음'}</dd>
      <dt>남은 항목</dt><dd class="${check.count ? '' : 'gone'}">${check.count}개</dd>
      <dt>용량</dt><dd>${KB(file.size)} → ${KB(blob.size)}</dd>
      ${recompressed ? '<dt>참고</dt><dd class="note">세로 사진이라 방향을 맞춰 다시 저장했어요</dd>' : ''}
    </dl>
    <button type="button" class="download">이 사진 내려받기</button>`;
  after.querySelector('.download').addEventListener('click', (e) => {
    download(name, blob);
    e.target.textContent = '내려받았어요';
    e.target.classList.add('done');
  });
  updateSummary();
}

function download(name, blob) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function addFiles(files) {
  const images = [...files].filter((f) => f.type.startsWith('image/'));
  if (images.length === 0) return;
  $('#result').hidden = false;
  for (const file of images) await handle(file);
  $('#result').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

$('#picker').addEventListener('change', (e) => {
  addFiles(e.target.files);
  e.target.value = '';
});

$('#download-all').addEventListener('click', () => cleaned.forEach(({ name, blob }) => download(name, blob)));

$('#reset').addEventListener('click', () => {
  cleaned.length = 0;
  handled = 0;
  hadLocation = 0;
  $('#files').replaceChildren();
  $('#result').hidden = true;
  $('#bar').hidden = true;
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

// 창 어디에 놓아도 받는다. 드롭 영역을 찾아 맞추는 수고를 없앤다.
const overlay = $('#drop-overlay');
let dragDepth = 0;

window.addEventListener('dragenter', (e) => {
  if (![...e.dataTransfer.types].includes('Files')) return;
  dragDepth += 1;
  overlay.hidden = false;
});
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) overlay.hidden = true;
});
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  overlay.hidden = true;
  addFiles(e.dataTransfer.files);
});
