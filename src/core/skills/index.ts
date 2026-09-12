/**
 * Prexyon Agent — Skills Module (v1.0)
 *
 * Ponto de entrada da infraestrutura da Camada de Skills.
 */

export * from './types';
export * from './registry';
export * from './executor';
export * from './definitions/stickerProductionSkill';
export * from './definitions/dtfUvProductionSkill';

import { defaultSkillRegistry } from './registry';
import { stickerProductionSkill } from './definitions/stickerProductionSkill';
import { dtfUvProductionSkill } from './definitions/dtfUvProductionSkill';

if (!defaultSkillRegistry.has(stickerProductionSkill.id)) {
  defaultSkillRegistry.register(stickerProductionSkill);
}

if (!defaultSkillRegistry.has(dtfUvProductionSkill.id)) {
  defaultSkillRegistry.register(dtfUvProductionSkill);
}
