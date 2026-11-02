// Brand fonts for pages rendered in Chromium (app captures, HTML scenes): reads the family and weight of every
// TTF/OTF in a folder from its own name and OS/2 tables and writes the matching @font-face rules.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function fontInfo(file) {
  const b = fs.readFileSync(file); const n = b.readUInt16BE(4); let name = null, os2 = null;
  for (let i = 0; i < n; i++) { const o = 12 + i * 16; const tag = b.toString('latin1', o, o + 4); const off = b.readUInt32BE(o + 8); if (tag === 'name') name = off; if (tag === 'OS/2') os2 = off; }
  let family = null, typo = null;
  if (name != null) {
    const count = b.readUInt16BE(name + 2), strings = name + b.readUInt16BE(name + 4);
    for (let i = 0; i < count; i++) {
      const r = name + 6 + i * 12; const pid = b.readUInt16BE(r), nid = b.readUInt16BE(r + 6), len = b.readUInt16BE(r + 8), off = b.readUInt16BE(r + 10);
      if (nid !== 1 && nid !== 16) continue;
      const raw = Buffer.from(b.subarray(strings + off, strings + off + len)); const s = pid === 0 || pid === 3 ? raw.swap16().toString('utf16le') : raw.toString('latin1');
      if (nid === 16) typo = s; else if (!family || pid === 3) family = s;
    }
  }
  return { family: typo || family, weight: os2 != null ? b.readUInt16BE(os2 + 4) : 400 };
}

// dirs: folders to scan. url(file): how the page will reach a font (a file:// URL by default).
export function fontFaces(dirs, url = (f) => pathToFileURL(f).href) {
  const files = {}; const rules = [];
  for (const dir of [].concat(dirs).filter((d) => d && fs.existsSync(d))) {
    for (const f of fs.readdirSync(dir).filter((x) => /\.(ttf|otf)$/i.test(x))) {
      const full = path.join(dir, f);
      try { const { family, weight } = fontInfo(full); if (!family) continue; files[f] = full; rules.push(`@font-face{font-family:"${family}";font-weight:${weight};font-style:normal;src:url("${url(full, f)}")}`); } catch (e) { /* unreadable: skip */ }
    }
  }
  return { css: rules.join('\n'), files };
}
