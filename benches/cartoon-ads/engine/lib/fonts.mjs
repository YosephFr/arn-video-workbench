// Brand fonts for the stage: finds the TTF/OTF/WOFF2 files of each family and writes @font-face rules.
// core/bin/fetch-fonts.sh saves Google Fonts as <Family>-<weight>.ttf (spaces removed) in <repo>/assets/fonts;
// files named the usual way (Family-Bold.ttf, Family[wght].ttf) are found too.
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const NAMED = { thin: 100, hairline: 100, extralight: 200, ultralight: 200, light: 300, regular: 400, normal: 400, book: 400, medium: 500,
  semibold: 600, demibold: 600, bold: 700, extrabold: 800, ultrabold: 800, black: 900, heavy: 900 }
const squash = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '')

export function fontDirs(repo, bench, piece) {
  return [process.env.WB_FONTS_DIR, piece && path.join(piece, 'assets', 'fonts'), path.join(bench, 'brand', 'fonts'),
    path.join(bench, 'assets', 'fonts'), path.join(repo, 'assets', 'fonts')].filter((d) => d && fs.existsSync(d))
}

// [{ family, weight: '700' | '100 900', style, file }]
export function findFonts(families, dirs) {
  const out = [], files = dirs.flatMap((d) => fs.readdirSync(d).filter((f) => /\.(ttf|otf|woff2?)$/i.test(f)).map((f) => path.join(d, f)))
  for (const family of [...new Set(families.filter(Boolean))]) {
    const key = squash(family), seen = new Set()
    for (const file of files) {
      const base = path.basename(file).replace(/\.(ttf|otf|woff2?)$/i, '')
      const [head, ...rest] = base.split(/[-_]/)
      if (squash(head) !== key && !squash(base).startsWith(key)) continue
      const tail = squash(rest.join('') || base.slice(head.length)) || 'regular'
      // never match a longer family that starts with the same letters ("Inter" must not take "Inter Tight")
      if (squash(head) !== key && !/^(\d+|thin|hairline|extralight|ultralight|light|regular|normal|book|medium|semibold|demibold|bold|extrabold|ultrabold|black|heavy|italic|variablefont|wght)/.test(squash(base).slice(key.length))) continue
      const italic = /italic/.test(tail)
      let weight = '400'
      if (/\[|wght|variable/i.test(base)) weight = '100 1000'
      else if (/^\d{3}/.test(tail)) weight = tail.slice(0, 3)
      else { const w = Object.keys(NAMED).sort((a, b) => b.length - a.length).find((n) => tail.replace('italic', '').startsWith(n)); if (w) weight = String(NAMED[w]) }
      const id = `${weight}|${italic}`
      if (seen.has(id)) continue
      seen.add(id)
      out.push({ family, weight, style: italic ? 'italic' : 'normal', file })
    }
  }
  return out
}

export function fontFaceCss(fonts) {
  return fonts.map((f) => `@font-face{font-family:"${f.family}";src:url("${pathToFileURL(f.file).href}");font-weight:${f.weight};font-style:${f.style};font-display:block}`).join('\n')
}
