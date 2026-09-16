/**
 * PRYX SVG & Raster Security Validator
 *
 * Valida formatos de entrada (raster) e sanitiza/valida estruturas SVG de saída de qualquer provider.
 * Impede injeções de script, referências remotas e viewBoxes inconsistentes.
 */

import { VectorizerError } from '../providers/types';

export interface ValidatedRasterMeta {
  mimeType: string;
  sizeBytes: number;
  format: 'png' | 'jpeg' | 'webp';
}

export interface ValidatedSvgResult {
  sanitizedSvg: string;
  dimensions: {
    width: number;
    height: number;
    viewBox: string;
  };
  pathCount: number;
  nodeCount: number;
  hasGeometry: boolean;
}

/**
 * Valida buffer de imagem raster antes do envio a provedores externos.
 */
export function validateRasterInput(buffer: Uint8Array | Buffer, maxSizeBytes: number = 50 * 1024 * 1024): ValidatedRasterMeta {
  if (!buffer || buffer.length === 0) {
    throw new VectorizerError('INVALID_INPUT', 'O arquivo de imagem está vazio ou não foi fornecido.');
  }

  if (buffer.length > maxSizeBytes) {
    throw new VectorizerError(
      'INVALID_INPUT',
      `O arquivo excede o limite máximo permitido de ${(maxSizeBytes / (1024 * 1024)).toFixed(0)}MB.`
    );
  }

  // Magic bytes check
  const isPng = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
  const isJpg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const isWebp =
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50;

  if (!isPng && !isJpg && !isWebp) {
    throw new VectorizerError(
      'INVALID_INPUT',
      'Formato de imagem inválido ou corrompido. Apenas PNG, JPEG e WebP são suportados.'
    );
  }

  const format = isPng ? 'png' : isJpg ? 'jpeg' : 'webp';
  const mimeType = isPng ? 'image/png' : isJpg ? 'image/jpeg' : 'image/webp';

  return {
    mimeType,
    sizeBytes: buffer.length,
    format,
  };
}

/**
 * Sanitiza e valida o SVG retornado por um provedor vetorial.
 */
export function validateAndSanitizeSvg(rawSvg: string): ValidatedSvgResult {
  if (!rawSvg || typeof rawSvg !== 'string' || !rawSvg.trim()) {
    throw new VectorizerError('INVALID_VECTOR_RESPONSE', 'Resposta do provedor não contém SVG válido.');
  }

  // 1. Checagem de segurança contra injeções
  const dangerousPatterns = [
    /<script\b/i,
    /<\/script>/i,
    /<foreignobject\b/i,
    /<iframe\b/i,
    /\bon\w+\s*=/i, // onload=, onerror=, etc.
    /javascript\s*:/i,
    /data\s*:\s*text\/html/i,
  ];

  for (const pattern of dangerousPatterns) {
    if (pattern.test(rawSvg)) {
      throw new VectorizerError('INVALID_VECTOR_RESPONSE', 'O SVG retornado contém scripts ou tags não seguras.');
    }
  }

  // 2. Extração de caminhos e contagem de nós
  const pathMatches = Array.from(rawSvg.matchAll(/<path\b([^>]*)\/?>/gi));
  if (pathMatches.length === 0) {
    throw new VectorizerError('INVALID_VECTOR_RESPONSE', 'O SVG gerado não contém caminhos vetoriais (<path>).');
  }

  let totalNodes = 0;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  for (const match of pathMatches) {
    const dMatch = match[1].match(/\bd\s*=\s*["']([^"']+)["']/i);
    if (dMatch && dMatch[1]) {
      const d = dMatch[1];
      const coords = Array.from(d.matchAll(/[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?/g)).map((x) => parseFloat(x[0]));
      totalNodes += Math.floor(coords.length / 2);
      for (let i = 0; i < coords.length - 1; i += 2) {
        const x = coords[i];
        const y = coords[i + 1];
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (totalNodes === 0) {
    throw new VectorizerError('INVALID_VECTOR_RESPONSE', 'O SVG gerado contém elementos <path> sem geometria vetorial.');
  }

  // 3. Extração e Sanitização de Dimensões e ViewBox
  const vbMatch = rawSvg.match(/viewBox\s*=\s*["']([^"']+)["']/i);
  const wMatch = rawSvg.match(/\bwidth\s*=\s*["']([^"']+)["']/i);
  const hMatch = rawSvg.match(/\bheight\s*=\s*["']([^"']+)["']/i);

  let width = 0;
  let height = 0;
  let viewBox = '';

  if (vbMatch) {
    viewBox = vbMatch[1].trim();
    const parts = viewBox.split(/[\s,]+/).map(Number);
    if (parts.length >= 4 && parts[2] > 0 && parts[3] > 0) {
      width = parts[2];
      height = parts[3];
    }
  }

  if ((!width || !height) && wMatch && hMatch) {
    const w = parseFloat(wMatch[1]);
    const h = parseFloat(hMatch[1]);
    if (!isNaN(w) && w > 0) width = w;
    if (!isNaN(h) && h > 0) height = h;
    if (!viewBox && width > 0 && height > 0) {
      viewBox = `0 0 ${width} ${height}`;
    }
  }

  // Se dimensões ainda forem inválidas, calcular a partir do bounding box dos nós (evita fallback estático 200x200)
  if ((!width || !height || !viewBox) && minX < Infinity && maxX > -Infinity) {
    const calcW = Math.max(1, Math.ceil(maxX));
    const calcH = Math.max(1, Math.ceil(maxY));
    width = calcW;
    height = calcH;
    viewBox = `0 0 ${width} ${height}`;
  }

  // 4. Sanitização final: assegurar atributos de SVG limpos
  let sanitized = rawSvg;
  // Remove links de imagem raster remotos desnecessários
  sanitized = sanitized.replace(/<image\b[^>]*\/>/gi, '');

  return {
    sanitizedSvg: sanitized,
    dimensions: {
      width: width || 100,
      height: height || 100,
      viewBox: viewBox || '0 0 100 100',
    },
    pathCount: pathMatches.length,
    nodeCount: totalNodes,
    hasGeometry: totalNodes > 0,
  };
}
