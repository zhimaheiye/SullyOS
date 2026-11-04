import { expect, it } from 'vitest';
import { composeGifFrames, representativeGifIndices } from './visionFrames';

const GIF = 'R0lGODlhCAAGAIEAAAAAAAAAAAAAAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQFCQAAACwAAAAACAAGAAAIDgABCBxIsKDBgwgTDgwIACH5BAUMAAAALAEAAQADAAQAgQAAAP8AAAAAAAAAAAgIAAMIHEhQYEAAIfkECRAAAAAsAQABAAQABACBAAAAAAD/AAAAAAAACA0AAQQYKJDgwAAFAwQEACH5BA0LAAAALAMAAQADAAQAgQAAAAC0AAAAAAAAAAgIAAMIHEhQYEAAIfkEBQ4AAAAsAwABAAQABACBAAAA/8gAAAAAAAAACA0AAQQYKJDgwAAFAwQEADs=';
const gifBytes = () => Buffer.from(GIF, 'base64');

it('composes transparent/difference patches and disposal 2/3 against independently decoded synthetic pixels', () => {
  const bytes = gifBytes();
  const animation = composeGifFrames(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  expect(animation).toMatchObject({ width: 8, height: 6 });
  expect(animation.frames).toHaveLength(5);
  expect(animation.frames[0].pixels.every(value => value === 0)).toBe(true);
  expect(new Set(animation.frames.slice(1).map(frame => Buffer.from(frame.pixels).toString('base64'))).size).toBeGreaterThan(2);
  const selected = representativeGifIndices(animation);
  expect(selected.length).toBeGreaterThan(1); expect(selected.length).toBeLessThanOrEqual(5);
  expect(selected).toEqual([...selected].sort((a, b) => a - b));
});
it('deduplicates identical full frames, retains a single-frame GIF, and rejects excessive resources', () => {
  const bytes = gifBytes();
  const animation = composeGifFrames(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const identical = { ...animation, frames: animation.frames.map(frame => ({ ...frame, pixels: animation.frames[1].pixels })) };
  expect(representativeGifIndices(identical)).toHaveLength(1);
  expect(representativeGifIndices({ ...animation, frames: [animation.frames[1]] })).toEqual([0]);
  expect(() => composeGifFrames(new ArrayBuffer(12 * 1024 * 1024 + 1))).toThrow('超过12MB');
});
