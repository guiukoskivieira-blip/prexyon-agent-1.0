/**
 * Prexyon Validation Module
 *
 * Garante que medidas físicas, arquivos e mutações no PDM atendam aos limites técnicos da pré-impressão.
 */

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export const ALLOWED_RASTER_MIME_TYPES = ['image/png', 'image/jpeg', 'image/jpg'] as const;
export const MAX_RASTER_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB
export const MIN_PHYSICAL_DIMENSION_MM = 0.5; // 0.5 mm mínimo visível
export const MAX_PHYSICAL_DIMENSION_MM = 10000; // 10 metros (limite de segurança de plotter)

/**
 * Valida se uma dimensão física (largura/altura) é válida e segura.
 */
export function validatePhysicalDimension(
  value: number,
  fieldName: string = 'Dimensão',
  maxAllowedMm: number = MAX_PHYSICAL_DIMENSION_MM
): ValidationResult {
  if (typeof value !== 'number' || isNaN(value)) {
    return { valid: false, error: `${fieldName} deve ser um número válido.` };
  }
  if (!isFinite(value)) {
    return { valid: false, error: `${fieldName} não pode ser infinito.` };
  }
  if (value < MIN_PHYSICAL_DIMENSION_MM) {
    return {
      valid: false,
      error: `${fieldName} deve ser de pelo menos ${MIN_PHYSICAL_DIMENSION_MM} mm.`,
    };
  }
  if (value > maxAllowedMm) {
    return {
      valid: false,
      error: `${fieldName} não pode exceder ${maxAllowedMm} mm.`,
    };
  }
  return { valid: true };
}

/**
 * Valida um arquivo para upload na Etapa 2.
 */
export function validateRasterFile(file: File): {
  valid: boolean;
  error?: string;
  mimeType?: 'image/png' | 'image/jpeg';
} {
  const extension = file.name.split('.').pop()?.toLowerCase();
  const isAllowedExt = extension === 'png' || extension === 'jpg' || extension === 'jpeg';
  const isAllowedMime =
    file.type === 'image/png' ||
    file.type === 'image/jpeg' ||
    file.type === 'image/jpg';

  if (!isAllowedExt && !isAllowedMime) {
    return {
      valid: false,
      error: 'Formato não suportado nesta etapa. Por favor, envie apenas arquivos PNG ou JPG/JPEG.',
    };
  }

  if (file.size <= 0) {
    return { valid: false, error: 'O arquivo selecionado está vazio (0 bytes).' };
  }

  if (file.size > MAX_RASTER_FILE_SIZE_BYTES) {
    return {
      valid: false,
      error: `O arquivo excede o limite máximo permitido de ${MAX_RASTER_FILE_SIZE_BYTES / (1024 * 1024)} MB.`,
    };
  }

  const normalizedMime: 'image/png' | 'image/jpeg' =
    file.type === 'image/png' || extension === 'png' ? 'image/png' : 'image/jpeg';

  return { valid: true, mimeType: normalizedMime };
}
