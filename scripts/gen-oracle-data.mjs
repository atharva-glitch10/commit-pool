// Compiles the pure data layer (src/data/*.ts) to plain JS in api/_data/ so the serverless oracle
// can run the exact same verification engine without a TypeScript build step on Vercel.
// Run after changing src/data:  npm run gen:oracle   (the output is committed)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const FILES = ['habits', 'time', 'verification', 'demoHealthData']
mkdirSync(join(root, 'api', '_data'), { recursive: true })
for (const f of FILES) {
  const src = readFileSync(join(root, 'src', 'data', `${f}.ts`), 'utf8')
  const out = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, verbatimModuleSyntax: false },
  }).outputText.replace(/(from\s+['"]\.\/[^'"]+)\.ts(['"])/g, '$1.js$2')
  writeFileSync(join(root, 'api', '_data', `${f}.js`), `// GENERATED from src/data/${f}.ts by scripts/gen-oracle-data.mjs. Do not edit.\n${out}`)
}
console.log('generated', FILES.length, 'files in api/_data')
