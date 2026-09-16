import type { ColorMask } from './adaptivePreprocess';

export interface MaskTraceFailure { maskIndex: number; reason: 'EMPTY_MASK' | 'EMPTY_TRACE' | 'TRACE_ERROR' }
export interface MaskTraceResult { svg: string; failures: MaskTraceFailure[] }
export type MaskTracer = (rgba: Uint8Array, width: number, height: number) => string;

const hex = (value: number) => value.toString(16).padStart(2, '0');

export function traceColorMasks(width: number, height: number, masks: ColorMask[], trace: MaskTracer): MaskTraceResult {
  const groups: string[] = [];
  const failures: MaskTraceFailure[] = [];

  masks.forEach((colorMask, maskIndex) => {
    if (colorMask.pixelCount === 0 || !colorMask.mask.some(Boolean)) {
      failures.push({ maskIndex, reason: 'EMPTY_MASK' });
      return;
    }
    const rgba = new Uint8Array(width * height * 4);
    colorMask.mask.forEach((alpha, pixelIndex) => {
      const offset = pixelIndex * 4;
      rgba[offset] = rgba[offset + 1] = rgba[offset + 2] = 0;
      rgba[offset + 3] = alpha;
    });
    try {
      const traced = trace(rgba, width, height);
      const paths = (traced.match(/<path\b[^>]*\/?\s*>/gi) ?? []).filter((path) =>
        /\sfill=("#(?:000000|000)"|'#(?:000000|000)')/i.test(path)
      );
      if (paths.length === 0) {
        failures.push({ maskIndex, reason: 'EMPTY_TRACE' });
        return;
      }
      const fill = `#${hex(colorMask.color.r)}${hex(colorMask.color.g)}${hex(colorMask.color.b)}`;
      const recolored = paths.map((path) => path.replace(/\sfill=("[^"]*"|'[^']*')/i, ` fill="${fill}"`)).join('');
      groups.push(`<g data-mask-index="${maskIndex}">${recolored}</g>`);
    } catch {
      failures.push({ maskIndex, reason: 'TRACE_ERROR' });
    }
  });

  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${groups.join('')}</svg>`, failures };
}
