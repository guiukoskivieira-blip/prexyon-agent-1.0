/**
 * PRYX Vectorizer.AI Provider Implementation
 *
 * Implementação desacoplada e segura do provider Vectorizer.AI com HTTP Basic Auth,
 * fail-closed test mode, deduplicação, sanitização de SVG e controle de créditos.
 */

import {
  VectorizationProvider,
  VectorizationInput,
  VectorizationOptions,
  VectorizationProviderResult,
  VectorizationProviderCapabilities,
  VectorizationCostEstimate,
  VectorizerError,
  VectorizerMode,
} from './types';
import { validateRasterInput, validateAndSanitizeSvg } from '../validation/svgSecurityValidator';
import { defaultVectorCache, computeVectorizationHash } from '../cache/vectorCache';
import { defaultVectorCostTracker } from '../cost/costTracker';

export interface VectorizerAiProviderConfig {
  apiId?: string;
  apiSecret?: string;
  endpointUrl?: string;
  defaultMode?: VectorizerMode;
  timeoutMs?: number;
  enforceTestModeOnly?: boolean;
}

export class VectorizerAIProvider implements VectorizationProvider {
  public readonly id = 'vectorizer_ai';
  public readonly name = 'Vectorizer.AI Cloud Engine';

  private readonly config: Required<VectorizerAiProviderConfig>;

  constructor(config?: VectorizerAiProviderConfig) {
    const env = typeof process !== 'undefined' && process.env ? process.env : ({} as Record<string, string>);
    this.config = {
      apiId: config?.apiId !== undefined ? config.apiId : (env.VECTORIZER_API_ID || env.VECTORIZER_AI_API_ID || ''),
      apiSecret: config?.apiSecret !== undefined ? config.apiSecret : (env.VECTORIZER_API_SECRET || env.VECTORIZER_AI_API_SECRET || ''),
      endpointUrl: config?.endpointUrl || 'https://pt.vectorizer.ai/api/v1/vectorize',
      defaultMode: 'test', // Fail-closed: padrão estrito TEST
      timeoutMs: config?.timeoutMs || 60000,
      enforceTestModeOnly: config?.enforceTestModeOnly ?? true, // Etapa 8.29 bloqueia production
    };
  }

  public getCapabilities(): VectorizationProviderCapabilities {
    return {
      supportsTestMode: true,
      supportsColorQuantization: true,
      maxImageSizeBytes: 50 * 1024 * 1024,
      supportedMimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
    };
  }

  public async estimateCost(
    _input: VectorizationInput,
    options?: VectorizationOptions
  ): Promise<VectorizationCostEstimate> {
    const effectiveMode = this.resolveEffectiveMode(options?.mode);
    return {
      estimatedCredits: effectiveMode === 'test' ? 0 : 1,
      isFreeTestMode: effectiveMode === 'test',
      currencyOrUnit: 'credits',
    };
  }

  public async healthCheck(): Promise<{ ok: boolean; message?: string; latencyMs?: number }> {
    const t0 = performance.now();
    try {
      if (!this.getCredentials().apiId || !this.getCredentials().apiSecret) {
        return { ok: false, message: 'Credenciais de API não configuradas no servidor.' };
      }
      // 1x1 PNG pixel para healthcheck
      const dummyPng = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        'base64'
      );
      const res = await this.executeApiCall(dummyPng, 'healthcheck.png', 'test', 10000);
      const latencyMs = Math.round(performance.now() - t0);
      return { ok: res.status === 200, latencyMs, message: 'Vectorizer.AI API operacional' };
    } catch (err: any) {
      return { ok: false, message: err.message, latencyMs: Math.round(performance.now() - t0) };
    }
  }

  public async vectorize(
    input: VectorizationInput,
    options?: VectorizationOptions
  ): Promise<VectorizationProviderResult> {
    const t0 = performance.now();
    const effectiveMode = this.resolveEffectiveMode(options?.mode);

    // 1. Validação do input raster
    const validatedInput = validateRasterInput(input.imageBuffer, this.getCapabilities().maxImageSizeBytes);

    // 2. Cálculo do hash e verificação de cache/idempotência
    const sha256 = computeVectorizationHash(input.imageBuffer, { ...options, mode: effectiveMode });

    return defaultVectorCache.executeWithDeduplication(sha256, async () => {
      let rawSvg = '';
      let creditsCharged = 0;
      let creditsCalculated = 0;

      try {
        const filename = input.filename || `image.${validatedInput.format}`;
        const timeoutMs = options?.timeoutMs || this.config.timeoutMs;

        const response = await this.executeApiCall(input.imageBuffer, filename, effectiveMode, timeoutMs);
        rawSvg = response.svgContent;
        creditsCharged = parseFloat(response.creditsCharged) || 0;
        creditsCalculated = parseFloat(response.creditsCalculated) || 0;

        // Gate de segurança em modo teste: nunca aceitar cobrança de crédito
        if (effectiveMode === 'test' && creditsCharged > 0) {
          throw new VectorizerError(
            'INSUFFICIENT_CREDITS',
            `FALHA DE SEGURANÇA: API cobrou ${creditsCharged} créditos em modo teste.`
          );
        }
      } catch (error: any) {
        const totalDuration = Math.round(performance.now() - t0);
        defaultVectorCostTracker.recordUsage({
          providerId: this.id,
          mode: effectiveMode,
          durationMs: totalDuration,
          inputSizeBytes: input.imageBuffer.length,
          outputSizeBytes: 0,
          creditsCalculated: 0,
          creditsCharged: 0,
          requestStatus: 'FAILED',
          cached: false,
          sha256,
          organizationId: options?.organizationId,
          userId: options?.userId,
          documentId: options?.documentId,
          timestamp: new Date().toISOString(),
        });
        throw error;
      }

      // 3. Validação e sanitização da geometria SVG recebida
      const validated = validateAndSanitizeSvg(rawSvg);
      const totalDuration = Math.round(performance.now() - t0);

      const telemetry = {
        providerId: this.id,
        mode: effectiveMode,
        durationMs: totalDuration,
        inputSizeBytes: input.imageBuffer.length,
        outputSizeBytes: Buffer.byteLength(validated.sanitizedSvg, 'utf-8'),
        creditsCalculated,
        creditsCharged,
        requestStatus: 'SUCCESS' as const,
        cached: false,
        sha256,
        organizationId: options?.organizationId,
        userId: options?.userId,
        documentId: options?.documentId,
        timestamp: new Date().toISOString(),
      };

      defaultVectorCostTracker.recordUsage(telemetry);

      return {
        providerId: this.id,
        providerRawSvg: rawSvg,
        pryxValidatedSvg: validated.sanitizedSvg,
        durationMs: totalDuration,
        creditsCharged,
        creditsCalculated,
        dimensions: validated.dimensions,
        pathCount: validated.pathCount,
        nodeCount: validated.nodeCount,
        cached: false,
        telemetry,
      };
    });
  }

  private resolveEffectiveMode(requestedMode?: VectorizerMode): VectorizerMode {
    if (this.config.enforceTestModeOnly) {
      return 'test'; // Bloqueio fail-closed estrito na Etapa 8.29
    }
    const envMode = (process.env.VECTORIZER_MODE as VectorizerMode) || this.config.defaultMode;
    return requestedMode === 'production' && envMode === 'production' ? 'production' : 'test';
  }

  private getCredentials(): { apiId: string; apiSecret: string } {
    const apiId = this.config.apiId !== undefined ? this.config.apiId : (process.env.VECTORIZER_API_ID || process.env.VECTORIZER_AI_API_ID || '');
    const apiSecret = this.config.apiSecret !== undefined ? this.config.apiSecret : (process.env.VECTORIZER_API_SECRET || process.env.VECTORIZER_AI_API_SECRET || '');

    if (!apiId || !apiSecret) {
      throw new VectorizerError(
        'AUTH_ERROR',
        'Credenciais do Vectorizer.AI não configuradas no servidor (VECTORIZER_API_ID / VECTORIZER_API_SECRET ausentes).'
      );
    }

    return { apiId, apiSecret };
  }

  private async executeApiCall(
    buffer: Uint8Array | Buffer,
    filename: string,
    mode: VectorizerMode,
    timeoutMs: number
  ): Promise<{ status: number; durationMs: number; creditsCharged: string; creditsCalculated: string; svgContent: string }> {
    const { apiId, apiSecret } = this.getCredentials();
    const authHeader = 'Basic ' + Buffer.from(`${apiId}:${apiSecret}`).toString('base64');

    const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
    const crlf = '\r\n';

    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}${crlf}` +
        `Content-Disposition: form-data; name="mode"${crlf}${crlf}` +
        `${mode}${crlf}` +
        `--${boundary}${crlf}` +
        `Content-Disposition: form-data; name="image"; filename="${filename}"${crlf}` +
        `Content-Type: image/jpeg${crlf}${crlf}`
      ),
      Buffer.from(buffer),
      Buffer.from(`${crlf}--${boundary}--${crlf}`),
    ]);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const t0 = performance.now();

    try {
      const response = await fetch(this.config.endpointUrl, {
        method: 'POST',
        headers: {
          Authorization: authHeader,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
        },
        body,
        signal: controller.signal,
      });

      const t1 = performance.now();
      const status = response.status;
      const creditsCharged = response.headers.get('x-credits-charged') || '0';
      const creditsCalculated = response.headers.get('x-credits-calculated') || '0';

      if (!response.ok) {
        const errorText = await response.text();
        if (status === 401 || status === 403) {
          throw new VectorizerError('AUTH_ERROR', `Falha de autenticação na API (${status}): ${errorText}`, status);
        } else if (status === 429) {
          throw new VectorizerError('RATE_LIMIT', `Limite de requisições excedido (${status}): ${errorText}`, status);
        } else if (status === 402) {
          throw new VectorizerError('INSUFFICIENT_CREDITS', `Créditos insuficientes (${status}): ${errorText}`, status);
        } else if (status >= 400 && status < 500) {
          throw new VectorizerError('PROVIDER_4XX', `Erro na requisição (${status}): ${errorText}`, status);
        } else {
          throw new VectorizerError('PROVIDER_5XX', `Erro interno no servidor do provedor (${status}): ${errorText}`, status);
        }
      }

      const svgContent = await response.text();

      return {
        status,
        durationMs: Math.round(t1 - t0),
        creditsCharged,
        creditsCalculated,
        svgContent,
      };
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw new VectorizerError('PROVIDER_TIMEOUT', `Tempo limite de ${timeoutMs}ms excedido na chamada ao provedor.`);
      }
      if (err instanceof VectorizerError) {
        throw err;
      }
      throw new VectorizerError('UNKNOWN_PROVIDER_ERROR', `Erro de comunicação com o provedor: ${err.message}`);
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
