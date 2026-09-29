// 정리한 사진을 기기에 남긴다. 폰은 공유 시트, PC는 파일 내려받기.
// 폰에서 파일로 내려받으면 아이폰은 사진첩이 아니라 '파일' 앱에 들어가 당근·카톡에서 고를 수 없다.
// 공유 시트는 "이미지 저장"으로 사진첩에 바로 넣거나, 올릴 앱으로 바로 보낸다.

import { zip } from './zip.js';

// CSS의 @media (pointer: coarse)와 같은 기준이다. 화면 문구와 저장 방식이 어긋나지 않게 한다.
export const touch = matchMedia('(pointer: coarse)').matches;

const asFile = ({ name, blob }) => new File([blob], name, { type: blob.type });

function shareable(files) {
  if (!touch || typeof navigator.canShare !== 'function') return false;
  try {
    return navigator.canShare({ files });
  } catch {
    return false;
  }
}

export function download(name, blob) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// 결과: 'shared'(공유 시트에서 처리) | 'cancelled'(사용자가 닫음) | 'downloaded'
// 공유는 클릭 직후에만 허용되므로 navigator.share 전에는 await를 두지 않는다.
export async function save(items) {
  const files = items.map(asFile);
  if (shareable(files)) {
    try {
      await navigator.share({ files });
      return 'shared';
    } catch (error) {
      if (error.name === 'AbortError') return 'cancelled';
      console.error('[share]', error); // 공유가 막히면 내려받기로 넘어간다
    }
  }
  if (items.length === 1) download(items[0].name, items[0].blob);
  // 여러 장을 연달아 내려받으면 브라우저가 뒷장을 조용히 막는다. 한 묶음으로 준다.
  else download(`사진정리-${new Date().toISOString().slice(0, 10)}.zip`, await zip(items));
  return 'downloaded';
}
