/**
 * Prexyon VTracer Bridge
 *
 * Gerencia a extração de pixels da imagem raster e a comunicação com o Web Worker WASM.
 */

import { RasterNode } from '../pdm/types';
import { VTracerOptions, VTracerWasmInstance } from './vtracerWasmCore';
import { buildVectorGroupFromSvg, BuildVectorGroupResult } from './svgParser';
import wasmBinaryUrl from '@visioncortex/vtracer/pkg/vtracer_wasm_bg.wasm?url';

export interface VectorizationResult extends BuildVectorGroupResult {
  svgString: string;
  durationMs: number;
}

class VTracerBridgeManager {
  private worker: Worker | null = null;
  private pendingRequests: Map<
    string,
    {
      resolve: (value: { svg: string; durationMs: number }) => void;
      reject: (reason: any) => void;
    }
  > = new Map();

  private fallbackWasmInstance: VTracerWasmInstance | null = null;

  private getWorker(): Worker | null {
    if (typeof window === 'undefined' || typeof Worker === 'undefined') return null;

    if (!this.worker) {
      try {
        this.worker = new Worker(
          new URL('../workers/vtracer.worker.ts', import.meta.url),
          { type: 'module' }
        );

        this.worker.onmessage = (e: MessageEvent) => {
          const { id, type, svg, durationMs, error } = e.data;
          const req = this.pendingRequests.get(id);
          if (!req) return;

          this.pendingRequests.delete(id);
          if (type === 'SUCCESS' && svg !== undefined) {
            req.resolve({ svg, durationMs: durationMs ?? 0 });
          } else {
            req.reject(new Error(error || 'Erro na vetorização'));
          }
        };

        this.worker.onerror = (err) => {
          console.error('VTracer Worker Error:', err);
        };
      } catch (err) {
        console.warn('Falha ao instanciar Web Worker, utilizando fallback síncrono:', err);
        this.worker = null;
      }
    }

    return this.worker;
  }

  /**
   * Extrai os pixels RGBA de um RasterNode usando Canvas 2D.
   */
  public async extractRgbaFromRaster(
    node: RasterNode
  ): Promise<{ rgba: Uint8Array; width: number; height: number }> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const width = img.naturalWidth || node.naturalWidth;
        const height = img.naturalHeight || node.naturalHeight;

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Não foi possível obter contexto 2D do Canvas.'));
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);
        const imageData = ctx.getImageData(0, 0, width, height);
        resolve({
          rgba: new Uint8Array(imageData.data.buffer),
          width,
          height,
        });
      };
      img.onerror = () => reject(new Error('Erro ao carregar imagem raster para extração de pixels.'));
      img.src = node.src;
    });
  }

  /**
   * Executa a vetorização do RasterNode e retorna os nós prontos para inserção no PDM.
   */
  public async vectorizeRasterNode(
    node: RasterNode,
    options: VTracerOptions = { mode: 'spline', clustering: 'color-cluster' }
  ): Promise<VectorizationResult> {
    const { rgba, width, height } = await this.extractRgbaFromRaster(node);
    const worker = this.getWorker();
    const requestId = Math.random().toString(36).substring(2, 9);

    let svgString = '';
    let durationMs = 0;

    if (worker) {
      // Execução off-thread no Web Worker
      const result = await new Promise<{ svg: string; durationMs: number }>((resolve, reject) => {
        this.pendingRequests.set(requestId, { resolve, reject });
        worker.postMessage({
          type: 'VECTORIZE',
          id: requestId,
          rgba,
          width,
          height,
          options,
          wasmUrl: wasmBinaryUrl,
        });
      });

      svgString = result.svg;
      durationMs = result.durationMs;
    } else {
      // Fallback para execução direta
      const startTime = performance.now();
      if (!this.fallbackWasmInstance) {
        this.fallbackWasmInstance = new VTracerWasmInstance();
        const response = await fetch(wasmBinaryUrl);
        const wasmBuffer = await response.arrayBuffer();
        await this.fallbackWasmInstance.init(wasmBuffer);
      }
      svgString = this.fallbackWasmInstance.vectorizeRgba(rgba, width, height, options);
      durationMs = Math.round(performance.now() - startTime);
    }

    // Converte o SVG no modelo estruturado do PDM preservando a escala física exata do RasterNode
    const vectorGroup = buildVectorGroupFromSvg({
      svgString,
      sourceRasterNodeId: node.id,
      name: `Vetor: ${node.name}`,
      physicalWidth_mm: node.physicalWidth_mm,
      physicalHeight_mm: node.physicalHeight_mm,
      position_mm: { x: node.position_mm.x, y: node.position_mm.y },
      vectorizationTimeMs: durationMs,
      preset: options.mode ?? 'spline',
    });

    return {
      ...vectorGroup,
      svgString,
      durationMs,
    };
  }
}

export const vtracerBridge = new VTracerBridgeManager();
