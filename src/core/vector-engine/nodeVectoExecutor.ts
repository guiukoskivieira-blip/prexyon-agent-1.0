import type { DirectVectoExecutor } from './directVectoBackend';
import type { RgbaRaster } from './types';

export interface NodeCliVectoOptions {
  vectoPath?: string;
  timeoutMs?: number;
}

export function encodeRgbaToBmp(width: number, height: number, rgba: Uint8Array): Uint8Array {
  const rowStride = ((width * 3 + 3) & ~3);
  const imageSize = rowStride * height;
  const fileSize = 54 + imageSize;
  const arrayBuffer = new ArrayBuffer(fileSize);
  const view = new DataView(arrayBuffer);
  const buf = new Uint8Array(arrayBuffer);

  // BMP Header (14 bytes)
  buf[0] = 0x42; // 'B'
  buf[1] = 0x4d; // 'M'
  view.setUint32(2, fileSize, true);
  view.setUint32(6, 0, true);
  view.setUint32(10, 54, true);

  // DIB Header (40 bytes - BITMAPINFOHEADER)
  view.setUint32(14, 40, true);
  view.setInt32(18, width, true);
  view.setInt32(22, height, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 24, true); // 24-bit RGB
  view.setUint32(30, 0, true);  // BI_RGB (uncompressed)
  view.setUint32(34, imageSize, true);
  view.setInt32(38, 2835, true);
  view.setInt32(42, 2835, true);
  view.setUint32(46, 0, true);
  view.setUint32(50, 0, true);

  // Pixels bottom-up
  for (let y = 0; y < height; y++) {
    const srcRow = (height - 1 - y) * width;
    const dstRow = 54 + y * rowStride;
    for (let x = 0; x < width; x++) {
      const srcIdx = (srcRow + x) * 4;
      const dstIdx = dstRow + x * 3;
      buf[dstIdx] = rgba[srcIdx + 2];     // B
      buf[dstIdx + 1] = rgba[srcIdx + 1]; // G
      buf[dstIdx + 2] = rgba[srcIdx];     // R
    }
  }

  return buf;
}

export class NodeCliVectoExecutor implements DirectVectoExecutor {
  private customVectoPath?: string;
  private timeoutMs: number;

  constructor(options: NodeCliVectoOptions = {}) {
    this.customVectoPath = options.vectoPath;
    this.timeoutMs = options.timeoutMs ?? 60_000;
  }

  async vectorize(raster: RgbaRaster): Promise<string> {
    if (!raster || raster.width <= 0 || raster.height <= 0 || !raster.data) {
      throw new Error('Raster inválido para vetorização com Vecto.');
    }

    if (typeof process === 'undefined' || !process.versions?.node) {
      throw new Error('NodeCliVectoExecutor requer runtime Node.js.');
    }

    const { execFile } = await import('node:child_process');
    const { existsSync } = await import('node:fs');
    const { readFile, unlink, writeFile } = await import('node:fs/promises');
    const os = await import('node:os');
    const path = await import('node:path');

    const defaultPath = path.resolve(
      process.cwd(),
      'scratch/v50-vecto-poc/bin/cli/vecto.exe'
    );
    const vectoExe = this.customVectoPath || defaultPath;

    if (!existsSync(vectoExe)) {
      throw new Error(`Executável Vecto não encontrado em: "${vectoExe}"`);
    }

    const nonce = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const tmpBmpPath = path.join(os.tmpdir(), `vecto_in_${nonce}.bmp`);
    const tmpSvgPath = path.join(os.tmpdir(), `vecto_out_${nonce}.svg`);

    const bmpBuffer = encodeRgbaToBmp(raster.width, raster.height, raster.data);
    await writeFile(tmpBmpPath, bmpBuffer);

    try {
      const stderr = await new Promise<string>((resolve, reject) => {
        execFile(
          vectoExe,
          [tmpBmpPath, '-o', tmpSvgPath],
          {
            timeout: this.timeoutMs,
            windowsHide: true,
          },
          (error, _stdout, stdErr) => {
            if (error) {
              reject(error);
            } else {
              resolve(stdErr || '');
            }
          }
        );
      });

      if (!existsSync(tmpSvgPath)) {
        throw new Error(`Vecto finalizou sem gerar arquivo SVG de saída. Stderr: ${stderr || 'N/A'}`);
      }

      const svgContent = await readFile(tmpSvgPath, 'utf-8');
      if (!svgContent || !svgContent.trim()) {
        throw new Error('Vecto gerou um arquivo SVG vazio.');
      }

      return svgContent;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Falha na execução do Vecto CLI: ${msg}`);
    } finally {
      await Promise.allSettled([
        unlink(tmpBmpPath).catch(() => {}),
        unlink(tmpSvgPath).catch(() => {}),
      ]);
    }
  }
}
