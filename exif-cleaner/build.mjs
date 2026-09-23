// src/를 파일 하나짜리 index.html로 합친다.
// 더블클릭으로 열면 브라우저가 외부 JS 모듈을 CORS로 막기 때문에, 배포본은 한 파일이어야 한다.

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const src = (name) => readFile(join(root, 'src', name), 'utf8');

// 의존 순서대로 이어 붙인다. 서로만 import하므로 import/export 구문만 걷어내면 그대로 돈다.
const MODULES = ['exif.js', 'strip.js', 'app.js'];

function inlineModule(code, name) {
  const stripped = code
    .replace(/^import[\s\S]*?from '\.\/.+?';\n/gm, '')
    .replace(/^export \{[^}]*\};\n/gm, '')
    .replace(/^export (const|let|function|async function|class) /gm, '$1 ');

  const leftover = stripped.match(/^\s*(import|export)\b.*/m);
  if (leftover) throw new Error(`${name}: 합칠 수 없는 구문이 남았어요 → ${leftover[0].trim()}`);
  return `// ---- ${name}\n${stripped.trim()}\n`;
}

const css = await src('style.css');
const js = (await Promise.all(MODULES.map(async (m) => inlineModule(await src(m), m)))).join('\n');
const page = await src('page.html');

const html = page.replace('/*__CSS__*/', `\n${css.trim()}\n  `).replace('/*__JS__*/', `\n${js}\n  `);
await writeFile(join(root, 'index.html'), html);

console.log(`index.html 생성 완료 (${(Buffer.byteLength(html) / 1024).toFixed(0)}KB)`);
