/**
 * Prexyon Agent — SkillRegistry (v1.0)
 *
 * Gerencia o catálogo estático de Skills profissionais registradas no sistema.
 * Não substitui o ToolRegistry; atua na camada superior de orquestração de procedimentos.
 */

import { SkillDefinition, SkillCapability } from './types';

export class SkillRegistry {
  private skills: Map<string, SkillDefinition> = new Map();

  constructor(initialSkills: SkillDefinition[] = []) {
    for (const skill of initialSkills) {
      this.register(skill);
    }
  }

  /**
   * Registra uma nova Skill no registro.
   * Lança erro determinístico em caso de ID inválido ou duplicado.
   */
  public register(skill: SkillDefinition): void {
    if (!skill || !skill.id || typeof skill.id !== 'string' || !skill.id.trim()) {
      throw new Error('A Skill precisa possuir um "id" válido e não-vazio.');
    }

    const cleanId = skill.id.trim();
    if (this.skills.has(cleanId)) {
      throw new Error(`Skill com id "${cleanId}" já está registrada. Registros duplicados são proibidos.`);
    }

    this.skills.set(cleanId, skill);
  }

  /**
   * Obtém uma Skill registrada pelo seu ID.
   */
  public get(skillId: string): SkillDefinition | undefined {
    if (!skillId || typeof skillId !== 'string') return undefined;
    return this.skills.get(skillId.trim());
  }

  /**
   * Verifica se uma Skill está cadastrada.
   */
  public has(skillId: string): boolean {
    if (!skillId || typeof skillId !== 'string') return false;
    return this.skills.has(skillId.trim());
  }

  /**
   * Retorna a lista de todas as Skills cadastradas.
   */
  public list(): SkillDefinition[] {
    return Array.from(this.skills.values());
  }

  /**
   * Valida se todas as capacidades exigidas pela Skill estão presentes no ambiente.
   */
  public validateCapabilities(
    skillId: string,
    availableCapabilities: SkillCapability[] = []
  ): { valid: boolean; missing: SkillCapability[] } {
    const skill = this.get(skillId);
    if (!skill) {
      return { valid: false, missing: [] };
    }

    const availSet = new Set(availableCapabilities);
    const missing = skill.requiredCapabilities.filter((cap) => !availSet.has(cap));

    return {
      valid: missing.length === 0,
      missing,
    };
  }
}

/**
 * Registro global padrão de Skills.
 * Inicialmente é inicializado com ZERO Skills de produção (intencional na Etapa 7.2).
 */
export const defaultSkillRegistry = new SkillRegistry();
