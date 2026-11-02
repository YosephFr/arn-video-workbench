// A small PNG decoder (8-bit greyscale, RGB or RGBA, not interlaced: what Chromium screenshots are), so the
// overlap report needs no image library. Returns { width, height, data: Uint8Array RGBA }.
import zlib from 'node:zlib'

export function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG')
  let pos = 8, width = 0, height = 0, depth = 0, color = 0, interlace = 0
  const idat = []
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos), type = buf.toString('ascii', pos + 4, pos + 8), body = buf.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); depth = body[8]; color = body[9]; interlace = body[12] }
    else if (type === 'IDAT') idat.push(body)
    else if (type === 'IEND') break
    pos += 12 + len
  }
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[color]
  if (depth !== 8 || !channels || interlace) throw new Error(`unsupported PNG (depth ${depth}, colour type ${color}, interlace ${interlace})`)
  const raw = zlib.inflateSync(Buffer.concat(idat)), stride = width * channels
  const px = new Uint8Array(height * stride)
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, row = y * stride
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? px[row + x - channels] : 0, b = y ? px[row - stride + x] : 0, c = x >= channels && y ? px[row - stride + x - channels] : 0
      let v = raw[src + x]
      if (f === 1) v += a
      else if (f === 2) v += b
      else if (f === 3) v += (a + b) >> 1
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c }
      px[row + x] = v & 255
    }
  }
  if (channels === 4) return { width, height, data: px }
  const out = new Uint8Array(width * height * 4)
  for (let i = 0, j = 0; i < width * height; i++, j += channels) {
    out[i * 4] = px[j]; out[i * 4 + 1] = channels >= 3 ? px[j + 1] : px[j]; out[i * 4 + 2] = channels >= 3 ? px[j + 2] : px[j]; out[i * 4 + 3] = channels === 2 ? px[j + 1] : channels === 4 ? px[j + 3] : 255
  }
  return { width, height, data: out }
}
