/**
 * PRYX Vectorization Provider Types
 *
 * Define contratos abstratos e desacoplados para provedores de vetorização (locais ou externos),
 * garantindo idempotência, rastreamento de custos, segurança e validação determinística.
 */

export type VectorizerMode = 'test' | 'production';

export type VectorizerErrorCode =
  | 'INVALID_INPUT'
  | 'AUTH_ERROR'
  | 'RATE_LIMIT'
  | 'INSUFFICIENT_CREDITS'
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_4XX'
  | 'PROVIDER_5XX'
  | 'INVALID_VECTOR_RESPONSE'
  | 'VECTOR_IMPORT_FAILURE'
  | 'UNKNOWN_PROVIDER_ERROR';

export class VectorizerError extends Error {
  public readonly code: VectorizerErrorCode;
  public readonly httpStatus?: number;
  public readonly details?: any;

  constructor(code: VectorizerErrorCode, message: string, httpStatus?: number, details?: any) {
    super(message);
    this.name = 'VectorizerError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
  }
}

export interface VectorizationInput {
  imageBuffer: Uint8Array | Buffer;
  mimeType?: string;
  filename?: string;
  naturalWidth?: number;
  naturalHeight?: number;
}

export interface VectorizationOptions {
  mode?: VectorizerMode;
  preset?: string;
  maxColors?: number;
  idempotencyKey?: string;
  organizationId?: string;
  userId?: string;
  documentId?: string;
  timeoutMs?: number;
}

export interface VectorizationTelemetry {
  providerId: string;
  mode: VectorizerMode;
  durationMs: number;
  inputSizeBytes: number;
  outputSizeBytes: number;
  creditsCalculated: number;
  creditsCharged: number;
  requestStatus: 'SUCCESS' | 'FAILED' | 'CACHED';
  cached: boolean;
  sha256: string;
  organizationId?: string;
  userId?: string;
  documentId?: string;
  timestamp: string;
}

export interface VectorizationProviderResult {
  providerId: string;
  providerRawSvg: string;
  pryxValidatedSvg: string;
  durationMs: number;
  creditsCharged: number;
  creditsCalculated: number;
  dimensions: {
    width: number;
    height: number;
    viewBox: string;
  };
  pathCount: number;
  nodeCount: number;
  cached: boolean;
  telemetry: VectorizationTelemetry;
}

export interface VectorizationProviderCapabilities {
  supportsTestMode: boolean;
  supportsColorQuantization: boolean;
  maxImageSizeBytes: number;
  supportedMimeTypes: string[];
}

export interface VectorizationCostEstimate {
  estimatedCredits: number;
  isFreeTestMode: boolean;
  currencyOrUnit: string;
}

export interface VectorizationProvider {
  readonly id: string;
  readonly name: string;

  vectorize(
    input: VectorizationInput,
    options?: VectorizationOptions
  ): Promise<VectorizationProviderResult>;

  healthCheck(): Promise<{ ok: boolean; message?: string; latencyMs?: number }>;

  getCapabilities(): VectorizationProviderCapabilities;

  estimateCost(
    input: VectorizationInput,
    options?: VectorizationOptions
  ): Promise<VectorizationCostEstimate>;
}
