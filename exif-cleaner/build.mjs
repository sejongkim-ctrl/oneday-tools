// src/를 파일 하나짜리 index.html로 합친다.
// 더블클릭으로 열면 브라우저가 외부 JS 모듈을 CORS로 막기 때문에, 배포본은 한 파일이어야 한다.

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const src = (name) => readFile(join(root, 'src', name), 'utf8');

// 의존 순서대로 이어 붙인다. 서로만 import하므로 import/export 구문만 걷어내면 그대로 돈다.
const MODULES = ['exif.js', 'strip.js', 'zip.js', 'app.js'];

// 목록에 없는 모듈을 가져오면 합쳐진 결과에서 조용히 사라진다. 빌드에서 잡는다.
function checkImports(code, name) {
  for (const match of code.matchAll(/from '\.\/(.+?)'/g)) {
    if (!MODULES.includes(match[1])) throw new Error(`${name}이(가) ${match[1]}을(를) 가져오는데 MODULES 목록에 없어요.`);
  }
}

function inlineModule(code, name) {
  checkImports(code, name);
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
