import { parseGIF, decompressFrames } from 'gifuct-js';

/** Fully compose one bounded animation cycle; disposal applies after each displayed frame. */
export function composeGifFrames(buffer: ArrayBuffer) {
  if (buffer.byteLength > 12 * 1024 * 1024) throw Error('GIF超过12MB，请选择较小素材');
  const gif = parseGIF(buffer), width = gif.lsd.width, height = gif.lsd.height;
  const frameCount = gif.frames.filter((f: any) => f.image).length;
  if (!width || !height || width * height > 4_000_000 || !frameCount || frameCount > 240 || width * height * frameCount > 40_000_000) throw Error('GIF尺寸或帧数过大，未调用识图');
  // Some GIFs omit GCE on later patches; retain the last actual graphic control.
  let gce: any;
  for (const frame of gif.frames as any[]) { if (frame.gce) gce = frame.gce; else if (frame.image && gce) frame.gce = gce; }
  const frames = decompressFrames(gif, true), pixels = new Uint8ClampedArray(width * height * 4);
  const result: { pixels: Uint8ClampedArray; at: number; duration: number }[] = [];
  let at = 0;
  for (const frame of frames) {
    const previous = frame.disposalType === 3 ? pixels.slice() : null;
    const { left, top, width: w, height: h } = frame.dims;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (left + x >= width || top + y >= height) continue;
      const src = (y * w + x) * 4, dst = ((top + y) * width + left + x) * 4;
      if (frame.patch[src + 3]) pixels.set(frame.patch.subarray(src, src + 4), dst);
    }
    const duration = Math.max(20, frame.delay || 100);
    result.push({ pixels: pixels.slice(), at, duration }); at += duration;
    if (frame.disposalType === 2) {
      for (let y = top; y < Math.min(top + h, height); y++) pixels.fill(0, (y * width + left) * 4, (y * width + Math.min(left + w, width)) * 4);
    } else if (previous) pixels.set(previous);
  }
  return { width, height, frames: result, duration: at };
}
export function representativeGifIndices(animation: ReturnType<typeof composeGifFrames>, limit = 5) {
  const { frames, duration } = animation;
  const choices = new Set<number>([0, frames.length - 1]);
  for (let i = 1; i < limit - 1; i++) {
    const t = duration * i / (limit - 1);
    choices.add(Math.max(0, frames.findIndex(f => f.at + f.duration > t)));
  }
  const signatures: Uint8ClampedArray[] = [];
  return [...choices].sort((a, b) => a - b).filter(index => {
    const pixels = frames[index].pixels;
    // Sparse signatures retain large motion/text changes without storing another full raster.
    const samples = new Uint8ClampedArray(1024);
    for (let i = 0; i < samples.length; i++) samples[i] = pixels[Math.min(pixels.length - 1, Math.floor(i * pixels.length / samples.length))];
    if (signatures.some(old => old.reduce((sum, value, i) => sum + Math.abs(value - samples[i]), 0) / samples.length < 1)) return false;
    signatures.push(samples); return true;
  });
}
export async function visionFrameUrls(blob: Blob): Promise<{ urls: string[]; gif: boolean }> {
  const buffer = await blob.arrayBuffer(), bytes = new Uint8Array(buffer);
  const signature = String.fromCharCode(...bytes.subarray(0, 6));
  if (!signature.startsWith('GIF8')) {
    if (typeof createImageBitmap === 'function') {
      let bitmap: ImageBitmap;
      try { bitmap = await createImageBitmap(blob); } catch { throw Error('图片解码失败，未调用识图'); }
      try { if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 16_000_000) throw Error('图片尺寸过大，未调用识图'); }
      finally { bitmap.close(); }
    }
    const { blobToDataUrl } = await import('./blobRef');
    return { urls: [await blobToDataUrl(blob)], gif: false };
  }
  const animation = composeGifFrames(buffer), indices = representativeGifIndices(animation);
  if (!indices.length) throw Error('GIF没有可识别画面');
  const canvas = document.createElement('canvas'), scratch = document.createElement('canvas');
  scratch.width = animation.width; scratch.height = animation.height;
  const scale = Math.min(1, 1024 / Math.max(animation.width, animation.height));
  canvas.width = Math.max(1, Math.round(animation.width * scale)); canvas.height = Math.max(1, Math.round(animation.height * scale));
  const ctx = canvas.getContext('2d'), raw = scratch.getContext('2d');
  if (!ctx || !raw) throw Error('当前浏览器无法抽取GIF代表帧');
  try {
    return { gif: true, urls: indices.map(index => {
      const image = raw.createImageData(animation.width, animation.height); image.data.set(animation.frames[index].pixels);
      raw.putImageData(image, 0, 0); ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(scratch, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/png');
    }) };
  } finally { canvas.width = canvas.height = scratch.width = scratch.height = 0; }
}
