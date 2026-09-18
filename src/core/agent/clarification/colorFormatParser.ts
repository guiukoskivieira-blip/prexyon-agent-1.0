/**
 * Prexyon Agent — Color Format Parser & Validator (ETAPA 8.31.1)
 *
 * Reconhece e normaliza formatos de cor de forma estruturada:
 * - HEX (#RRGGBB, #RGB)
 * - RGB (rgb(r, g, b) ou rgb: r, g, b)
 * - Nomes semânticos de cores
 * - Detecta CMYK e Pantone com resposta honesta sobre limitações do motor atual
 */

import {
  normalizeColorWord,
  getCanonicalHexForColorName,
  COLOR_NAME_MAP,
} from '../vectorColorResolver';

export interface ParsedColorResult {
  valid: boolean;
  hex?: string;
  format?: 'HEX' | 'RGB' | 'COLOR_NAME' | 'CMYK' | 'PANTONE' | 'UNKNOWN';
  isSupported: boolean;
  unsupportedReason?: string;
}

export function parseColorInput(rawInput: string): ParsedColorResult {
  if (!rawInput || typeof rawInput !== 'string') {
    return { valid: false, isSupported: false, format: 'UNKNOWN' };
  }

  const trimmed = rawInput.trim();
  const lower = trimmed.toLowerCase();

  // 1. Detecção de CMYK
  if (
    lower.includes('cmyk') ||
    /(?:c\s*:\s*\d+|m\s*:\s*\d+|y\s*:\s*\d+|k\s*:\s*\d+)/i.test(lower)
  ) {
    return {
      valid: true,
      format: 'CMYK',
      isSupported: false,
      unsupportedReason:
        'A conversão física de cores CMYK requer perfil de cor ICC que ainda não está ativo no motor gráfico. Por favor, informe o equivalente em formato HEX (#0057FF) ou RGB.',
    };
  }

  // 2. Detecção de Pantone
  if (
    lower.includes('pantone') ||
    lower.includes('pms ') ||
    /\bpantone\b/i.test(lower)
  ) {
    return {
      valid: true,
      format: 'PANTONE',
      isSupported: false,
      unsupportedReason:
        'A biblioteca de fórmulas Pantone não está habilitada nesta versão. Por favor, forneça a cor correspondente em formato HEX (#0057FF) ou RGB.',
    };
  }

  // 3. HEX explícito com # (#FFFFFF ou #FFF)
  const hexMatch = trimmed.match(/#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/);
  if (hexMatch) {
    let hex = hexMatch[0].toUpperCase();
    if (hex.length === 4) {
      // Expande #RGB -> #RRGGBB
      hex = `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
    }
    return {
      valid: true,
      hex,
      format: 'HEX',
      isSupported: true,
    };
  }

  // 4. HEX sem '#' se for exatamente 6 caracteres hexadecimais (ex: "0057FF")
  if (/^[0-9a-fA-F]{6}$/.test(trimmed)) {
    return {
      valid: true,
      hex: `#${trimmed.toUpperCase()}`,
      format: 'HEX',
      isSupported: true,
    };
  }

  // 5. Formato RGB: rgb(r, g, b) ou rgb: r, g, b
  const rgbMatch = trimmed.match(/rgb\s*\(?\s*(\d{1,3})\s*[,;\s]+\s*(\d{1,3})\s*[,;\s]+\s*(\d{1,3})\s*\)?/i);
  if (rgbMatch) {
    const r = Math.min(255, Math.max(0, parseInt(rgbMatch[1], 10)));
    const g = Math.min(255, Math.max(0, parseInt(rgbMatch[2], 10)));
    const b = Math.min(255, Math.max(0, parseInt(rgbMatch[3], 10)));
    const toHex = (n: number) => n.toString(16).padStart(2, '0').toUpperCase();
    const hex = `#${toHex(r)}${toHex(g)}${toHex(b)}`;
    return {
      valid: true,
      hex,
      format: 'RGB',
      isSupported: true,
    };
  }

  // 6. Nome semântico da cor (ex: "vermelho", "azul", "branco", "preto", "amarelo")
  const normWord = normalizeColorWord(trimmed);
  if (normWord) {
    const hex = getCanonicalHexForColorName(normWord);
    if (hex) {
      return {
        valid: true,
        hex: hex.toUpperCase(),
        format: 'COLOR_NAME',
        isSupported: true,
      };
    }
  }

  // Se a frase contém nome de cor (ex: "para azul", "quero verde")
  for (const [name] of Object.entries(COLOR_NAME_MAP)) {
    if (lower.includes(name)) {
      const hex = getCanonicalHexForColorName(name);
      if (hex) {
        return {
          valid: true,
          hex: hex.toUpperCase(),
          format: 'COLOR_NAME',
          isSupported: true,
        };
      }
    }
  }

  return {
    valid: false,
    format: 'UNKNOWN',
    isSupported: false,
  };
}
