/**
 * Prexyon PDF Security & Sanity Validator (Fase 18)
 *
 * Garante que arquivos PDF carregados sejam seguros, bloqueando payloads maliciosos,
 * scripts executáveis embutidos, ações Launch e tamanhos de arquivo anômalos.
 */

export interface PdfSecurityLimits {
  maxFileSizeBytes: number; // default: 50MB
  maxPages: number; // default: 100
  maxVectorObjects: number; // default: 50000
}

export const DEFAULT_PDF_SECURITY_LIMITS: PdfSecurityLimits = {
  maxFileSizeBytes: 50 * 1024 * 1024,
  maxPages: 100,
  maxVectorObjects: 50000,
};

export class PdfSecurityError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = 'PdfSecurityError';
  }
}

function toLatin1(buffer: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength).toString('latin1');
  }
  let str = '';
  const len = buffer.length;
  const CHUNK = 8192;
  for (let i = 0; i < len; i += CHUNK) {
    const sub = buffer.subarray(i, Math.min(i + CHUNK, len));
    str += String.fromCharCode.apply(null, sub as unknown as number[]);
  }
  return str;
}

export function validatePdfSecurity(
  buffer: Uint8Array | Buffer,
  limits: PdfSecurityLimits = DEFAULT_PDF_SECURITY_LIMITS
): { isValid: boolean; version: string; byteLength: number } {
  if (!buffer || buffer.length === 0) {
    throw new PdfSecurityError('EMPTY_FILE', 'O arquivo PDF fornecido está vazio.');
  }

  if (buffer.length > limits.maxFileSizeBytes) {
    throw new PdfSecurityError(
      'FILE_TOO_LARGE',
      `O arquivo PDF excede o limite máximo permitido (${(limits.maxFileSizeBytes / (1024 * 1024)).toFixed(0)}MB).`
    );
  }

  // 1. Validação de Magic Bytes (%PDF-)
  const header = toLatin1(buffer.subarray(0, 1024));
  const pdfHeaderMatch = header.match(/%PDF-(\d+\.\d+)/);
  if (!pdfHeaderMatch) {
    throw new PdfSecurityError(
      'INVALID_PDF_HEADER',
      'Assinatura de cabeçalho PDF inválida ou ausente (%PDF- não encontrado).'
    );
  }

  const version = pdfHeaderMatch[1];

  // 2. Varredura de segurança contra payloads maliciosos no PDF
  const rawString = toLatin1(buffer);

  const dangerousKeywords = [
    { pattern: /\/JavaScript\b/i, name: 'Embedded JavaScript' },
    { pattern: /\/JS\b/i, name: 'Embedded JS Action' },
    { pattern: /\/Launch\b/i, name: 'Launch Executable Action' },
    { pattern: /\/EmbeddedFiles\b/i, name: 'Embedded Executable Files' },
  ];

  for (const { pattern, name } of dangerousKeywords) {
    if (pattern.test(rawString)) {
      // Nota de segurança: bloqueia ações ativas que tentem executar código
      throw new PdfSecurityError(
        'MALICIOUS_CONTENT_BLOCKED',
        `O arquivo PDF contém recursos de segurança bloqueados: ${name}.`
      );
    }
  }

  return {
    isValid: true,
    version,
    byteLength: buffer.length,
  };
}
