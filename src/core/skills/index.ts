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
export * from './definitions/cuttingWorkflowSkill';
export * from './definitions/vectorizeArtworkSkill';
export * from './definitions/preflightDocumentSkill';

import { defaultSkillRegistry } from './registry';
import { stickerProductionSkill } from './definitions/stickerProductionSkill';
import { dtfUvProductionSkill } from './definitions/dtfUvProductionSkill';
import { cuttingWorkflowSkill } from './definitions/cuttingWorkflowSkill';
import { vectorizeArtworkSkill } from './definitions/vectorizeArtworkSkill';
import { preflightDocumentSkill } from './definitions/preflightDocumentSkill';

if (!defaultSkillRegistry.has(stickerProductionSkill.id)) {
  defaultSkillRegistry.register(stickerProductionSkill);
}

if (!defaultSkillRegistry.has(dtfUvProductionSkill.id)) {
  defaultSkillRegistry.register(dtfUvProductionSkill);
}

if (!defaultSkillRegistry.has(cuttingWorkflowSkill.id)) {
  defaultSkillRegistry.register(cuttingWorkflowSkill);
}

if (!defaultSkillRegistry.has(vectorizeArtworkSkill.id)) {
  defaultSkillRegistry.register(vectorizeArtworkSkill);
}

if (!defaultSkillRegistry.has(preflightDocumentSkill.id)) {
  defaultSkillRegistry.register(preflightDocumentSkill);
}
