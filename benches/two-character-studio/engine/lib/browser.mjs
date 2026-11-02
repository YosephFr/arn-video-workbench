// Headless Chromium (Playwright) for WebGL rendering. Never a visible window.
// --gl gpu: hardware WebGL through ANGLE (Metal on macOS); --gl swiftshader: software WebGL, works on any machine
// without a GPU (slower); --gl auto (default): GPU first, SwiftShader if WebGL is unavailable.
import { chromium } from 'playwright';

const SOFT = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'];
const GPU = process.platform === 'darwin'
  ? ['--use-angle=metal', '--enable-gpu-rasterization', '--ignore-gpu-blocklist', '--enable-webgl']
  : ['--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl'];

async function probe(browser){
  const page = await browser.newPage();
  const info = await page.evaluate(() => {
    const c = document.createElement('canvas'), gl = c.getContext('webgl2');
    if (!gl) return null;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  });
  await page.close();
  return info;
}

export async function launch(mode = process.env.WB_GL || 'auto'){
  const tries = mode === 'swiftshader' ? [SOFT] : mode === 'gpu' ? [GPU] : [GPU, SOFT];
  let last = null;
  for (const args of tries){
    let browser = null;
    try {
      browser = await chromium.launch({ headless:true, args });
      const renderer = await probe(browser);
      if (renderer){ return { browser, renderer:String(renderer), software:/swiftshader|llvmpipe|software/i.test(String(renderer)) }; }
      last = new Error('WebGL2 unavailable');
    } catch (e){ last = e; }
    if (browser) await browser.close();
  }
  throw new Error(`could not start headless Chromium with WebGL2: ${last && last.message}\n(install it with: npx playwright install chromium-headless-shell)`);
}
