/**
 * PRYX Vectorization Cost & Usage Ledger
 *
 * Registra custos, créditos e latências de operações de vetorização para auditoria e controle de uso.
 * NUNCA armazena ou expõe credenciais.
 */

import { VectorizationTelemetry } from '../providers/types';

export interface UsageSummary {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  cachedRequests: number;
  totalCreditsCalculated: number;
  totalCreditsCharged: number;
  averageLatencyMs: number;
}

export class VectorCostTracker {
  private records: VectorizationTelemetry[] = [];

  public recordUsage(telemetry: VectorizationTelemetry): void {
    // Garante que nenhum campo de credencial possa existir
    const sanitized: VectorizationTelemetry = {
      providerId: telemetry.providerId,
      mode: telemetry.mode,
      durationMs: telemetry.durationMs,
      inputSizeBytes: telemetry.inputSizeBytes,
      outputSizeBytes: telemetry.outputSizeBytes,
      creditsCalculated: telemetry.creditsCalculated,
      creditsCharged: telemetry.creditsCharged,
      requestStatus: telemetry.requestStatus,
      cached: telemetry.cached,
      sha256: telemetry.sha256,
      organizationId: telemetry.organizationId,
      userId: telemetry.userId,
      documentId: telemetry.documentId,
      timestamp: telemetry.timestamp,
    };
    this.records.push(sanitized);
  }

  public getSummary(filter?: { organizationId?: string; providerId?: string }): UsageSummary {
    let filtered = this.records;
    if (filter?.organizationId) {
      filtered = filtered.filter((r) => r.organizationId === filter.organizationId);
    }
    if (filter?.providerId) {
      filtered = filtered.filter((r) => r.providerId === filter.providerId);
    }

    const totalRequests = filtered.length;
    let successful = 0;
    let failed = 0;
    let cached = 0;
    let totalCalc = 0;
    let totalCharged = 0;
    let totalLatency = 0;

    for (const r of filtered) {
      if (r.requestStatus === 'SUCCESS') successful++;
      else if (r.requestStatus === 'FAILED') failed++;
      else if (r.requestStatus === 'CACHED') cached++;

      totalCalc += r.creditsCalculated;
      totalCharged += r.creditsCharged;
      totalLatency += r.durationMs;
    }

    return {
      totalRequests,
      successfulRequests: successful,
      failedRequests: failed,
      cachedRequests: cached,
      totalCreditsCalculated: totalCalc,
      totalCreditsCharged: totalCharged,
      averageLatencyMs: totalRequests > 0 ? Math.round(totalLatency / totalRequests) : 0,
    };
  }

  public getAllRecords(): readonly VectorizationTelemetry[] {
    return this.records;
  }

  public clear(): void {
    this.records = [];
  }
}

export const defaultVectorCostTracker = new VectorCostTracker();
