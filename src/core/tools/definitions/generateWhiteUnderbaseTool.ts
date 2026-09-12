/**
 * Tool: generate_white_underbase (DTF UV Etapa 3)
 *
 * Gera de forma determinística e não-destrutiva a camada técnica de Base Branca (White Underbase)
 * para decalques e transferências DTF UV, registrando a separação de produção no PDM.
 */

import { ToolDefinition, ToolResult } from '../types';
import { generateWhiteUnderbaseMask } from '../../dtf/whiteUnderbaseEngine';
import { getProductionProfile } from '../../production/profile';
import { PrexyonDocument } from '../../pdm/types';
import { DocumentCommand, CommandResult } from '../../commands/types';

export interface GenerateWhiteUnderbaseArgs {
  dpi?: number;
  sourceNodeIds?: string[];
  forceBypassPolicy?: boolean;
}

export interface GenerateWhiteUnderbaseResultData {
  separationId: string;
  role: 'WHITE';
  status: 'GENERATED';
  dimensions_mm: {
    width_mm: number;
    height_mm: number;
  };
  dimensions_px: {
    width_px: number;
    height_px: number;
  };
  dpi: number;
  coverageRatio: number;
  generationMethod: string;
  durationMs: number;
  maskDataUrl?: string;
}

/**
 * Comando para registrar a separação de base branca no histórico de Undo/Redo
 */
export class SetSeparationCommand implements DocumentCommand {
  readonly id: string;
  readonly name: string;
  readonly timestamp: number;

  constructor(
    public readonly role: string,
    public readonly separation: import('../../dtf/types').ProductionSeparation
  ) {
    this.id = `cmd_set_sep_${role}_${Date.now()}`;
    this.name = `Gerar Separação ${role}`;
    this.timestamp = Date.now();
  }

  execute(doc: PrexyonDocument): CommandResult {
    const nextDoc: PrexyonDocument = {
      ...doc,
      separations: {
        ...(doc.separations || {}),
        [this.role]: this.separation,
      },
      updatedAt: new Date().toISOString(),
    };
    return { doc: nextDoc };
  }

  undo(doc: PrexyonDocument): CommandResult {
    const nextSeparations = { ...(doc.separations || {}) };
    delete nextSeparations[this.role];
    const nextDoc: PrexyonDocument = {
      ...doc,
      separations: nextSeparations,
      updatedAt: new Date().toISOString(),
    };
    return { doc: nextDoc };
  }
}

export const generateWhiteUnderbaseTool: ToolDefinition<
  GenerateWhiteUnderbaseArgs,
  GenerateWhiteUnderbaseResultData
> = {
  name: 'generate_white_underbase',
  description:
    'Gera de forma determinística e não-destrutiva a máscara técnica de Base Branca (White Underbase) para produção DTF UV a partir do canal alfa da arte.',
  parameters: {
    type: 'object',
    properties: {
      dpi: {
        type: 'number',
        description: 'Resolução técnica para rasterização da máscara (padrão: 300 DPI).',
        default: 300,
      },
      sourceNodeIds: {
        type: 'array',
        description: 'Lista opcional de IDs de nós para inclusão na base branca (default: todos os nós imprimíveis).',
        items: {
          type: 'string',
          description: 'ID do nó',
        },
      },
      forceBypassPolicy: {
        type: 'boolean',
        description: 'Permite forçar a geração ignorando políticas restritivas de perfil.',
        default: false,
      },
    },
  },
  async execute(args, context): Promise<ToolResult<GenerateWhiteUnderbaseResultData>> {
    const { doc, historyManager, setDoc } = context;

    const currentProfileId = (context as any).profileId || 'dtf-uv';
    const profile = getProductionProfile(currentProfileId);

    // 1. Validação de Capability & Policy
    const effectiveWhitePolicy =
      (doc as any).activeProfile?.rules?.whiteUnderbasePolicy ||
      profile.dtfUvConfig?.whitePolicy ||
      'OPTIONAL';
    if ((effectiveWhitePolicy === 'DISABLED' || effectiveWhitePolicy === 'RIP_CONTROLLED') && !args.forceBypassPolicy) {
      return {
        success: false,
        error: {
          code: effectiveWhitePolicy === 'DISABLED' ? 'POLICY_DISABLED' : 'POLICY_RESTRICTED',
          message: `A geração de Base Branca está configurada como ${effectiveWhitePolicy} e é gerenciada pelo RIP.`,
        },
      };
    }

    try {
      // 2. Executa o motor determinístico não-destrutivo
      const dpi = args.dpi || profile.validation?.recommendedDpi || 300;
      const result = generateWhiteUnderbaseMask(doc, {
        dpi,
        sourceNodeIds: args.sourceNodeIds,
        whitePolicy: effectiveWhitePolicy,
        forceBypassPolicy: args.forceBypassPolicy,
      });

      const { separation, durationMs } = result;

      // 3. Aplicação do comando com histórico
      const cmd = new SetSeparationCommand('WHITE', separation);
      let nextDoc = doc;
      if (historyManager) {
        const historyRes = historyManager.executeCommand(cmd, doc);
        nextDoc = historyRes.doc;
      } else {
        const cmdRes = cmd.execute(doc);
        nextDoc = cmdRes.doc;
      }

      if (setDoc) {
        setDoc(nextDoc);
      }

      return {
        success: true,
        doc: nextDoc,
        message: `Base Branca (White Underbase) gerada com sucesso (${Math.round((separation.coverageRatio || 0) * 100)}% de cobertura em ${dpi} DPI).`,
        data: {
          separationId: separation.id,
          role: 'WHITE',
          status: 'GENERATED',
          dimensions_mm: {
            width_mm: separation.widthMm,
            height_mm: separation.heightMm,
          },
          dimensions_px: {
            width_px: separation.widthPx,
            height_px: separation.heightPx,
          },
          dpi: separation.dpi,
          coverageRatio: separation.coverageRatio || 0,
          generationMethod: separation.generationMethod,
          durationMs,
          maskDataUrl: separation.maskDataUrl,
        },
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Falha ao gerar a máscara de Base Branca.';
      return {
        success: false,
        error: {
          code: 'EXECUTION_FAILED',
          message: msg,
          details: err,
        },
      };
    }
  },
};
