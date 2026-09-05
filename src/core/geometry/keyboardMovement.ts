/**
 * Prexyon Keyboard Movement Helper
 *
 * Gerencia a movimentação precisa de nós selecionados via teclas de seta (Arrow Keys)
 * com suporte a modificadores de precisão e agrupamento de repetição contínua.
 */

import { Position_mm } from '../pdm/types';
import { roundPrecision } from '../pdm/units';

export interface KeyboardModifiers {
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}

export interface ArrowMovementDelta {
  dx: number;
  dy: number;
  step_mm: number;
}

/**
 * Calcula o deslocamento em mm para uma tecla de seta e modificadores.
 * - Seta simples: 1.0 mm
 * - Shift + Seta: 10.0 mm
 * - Ctrl + Seta ou Alt + Seta: 0.1 mm
 */
export function calculateArrowMovement(
  key: string,
  modifiers: KeyboardModifiers
): ArrowMovementDelta | null {
  let step_mm = 1.0;

  if (modifiers.shiftKey) {
    step_mm = 10.0;
  } else if (modifiers.ctrlKey || modifiers.altKey) {
    step_mm = 0.1;
  }

  switch (key) {
    case 'ArrowLeft':
      return { dx: -step_mm, dy: 0, step_mm };
    case 'ArrowRight':
      return { dx: step_mm, dy: 0, step_mm };
    case 'ArrowUp':
      return { dx: 0, dy: -step_mm, step_mm };
    case 'ArrowDown':
      return { dx: 0, dy: step_mm, step_mm };
    default:
      return null;
  }
}

/**
 * Verifica se o elemento com foco atual é um campo de entrada de texto.
 */
export function isTextInputFocused(target: EventTarget | null): boolean {
  if (!target || typeof target !== 'object') return false;

  const targetAny = target as unknown as Record<string, unknown>;
  const tagName = typeof targetAny.tagName === 'string' ? targetAny.tagName.toUpperCase() : '';
  if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') {
    return true;
  }

  if (targetAny.isContentEditable === true || targetAny.contentEditable === 'true') {
    return true;
  }

  return false;
}

/**
 * Aplica um delta de movimento a uma posição em milímetros com arredondamento seguro.
 */
export function applyPositionDelta(
  currentPos: Position_mm,
  dx: number,
  dy: number
): Position_mm {
  return {
    x: roundPrecision(currentPos.x + dx, 2),
    y: roundPrecision(currentPos.y + dy, 2),
  };
}
