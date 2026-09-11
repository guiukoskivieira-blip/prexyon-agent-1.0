/**
 * Tool: generate_clear_separation (DTF UV Etapa 4)
 *
 * Gera de forma determinística e não-destrutiva a camada técnica de Verniz (Clear / Varnish)
 * para decalques e transferências DTF UV, registrando a separação de produção no PDM.
 */

import { ToolDefinition, ToolResult } from '../types';
import { generateClearSeparationMask } from '../../dtf/clearSeparationEngine';
import { ClearSeparationMode } from '../../dtf/types';
import { getProductionProfile } from '../../production/profile';
import { SetSeparationCommand } from './generateWhiteUnderbaseTool';

export interface GenerateClearSeparationArgs {
  mode?: ClearSeparationMode;
  dpi?: number;
  sourceNodeIds?: string[];
  forceBypassPolicy?: boolean;
}

export interface GenerateClearSeparationResultData {
  separationId: string;
  role: 'CLEAR';
  mode: ClearSeparationMode;
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

export const generateClearSeparationTool: ToolDefinition<
  GenerateClearSeparationArgs,
  GenerateClearSeparationResultData
> = {
  name: 'generate_clear_separation',
  description:
    'Gera de forma determinística e não-destrutiva a máscara técnica de Verniz (Clear / Varnish) para produção DTF UV (modos: ARTWORK sobre a arte ou FULL em toda a área).',
  parameters: {
    type: 'object',
    properties: {
      mode: {
        type: 'string',
        description: 'Modo de aplicação do verniz (ARTWORK: acompanha a arte/alpha; FULL: cobre 100% da prancheta).',
        enum: ['ARTWORK', 'FULL'],
        default: 'ARTWORK',
      },
      dpi: {
        type: 'number',
        description: 'Resolução técnica para rasterização da máscara (padrão: 300 DPI).',
        default: 300,
      },
      sourceNodeIds: {
        type: 'array',
        description: 'Lista opcional de IDs de nós para inclusão no verniz.',
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
  async execute(args, context): Promise<ToolResult<GenerateClearSeparationResultData>> {
    const { doc, historyManager, setDoc } = context;

    const currentProfileId = (context as any).profileId || 'dtf-uv';
    const profile = getProductionProfile(currentProfileId);

    // 1. Validação de Capability & Policy
    const clearPolicy = profile.dtfUvConfig?.clearPolicy || 'OPTIONAL';
    const supportsClear = profile.dtfUvConfig?.capabilities?.supportsClear ?? true;

    if ((!supportsClear || clearPolicy === 'DISABLED') && !args.forceBypassPolicy) {
      return {
        success: false,
        error: {
          code: 'POLICY_DISABLED',
          message: 'A geração de Verniz (Clear) está desabilitada nas políticas do perfil de produção DTF UV selecionado.',
        },
      };
    }

    try {
      const mode: ClearSeparationMode = args.mode || 'ARTWORK';
      const dpi = args.dpi || profile.validation?.recommendedDpi || 300;

      const result = generateClearSeparationMask(doc, {
        mode,
        dpi,
        sourceNodeIds: args.sourceNodeIds,
        clearPolicy,
        forceBypassPolicy: args.forceBypassPolicy,
      });

      const { separation, durationMs } = result;

      // 2. Aplicação do comando com histórico
      const cmd = new SetSeparationCommand('CLEAR', separation);
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
        message: `Verniz (Clear / Varnish) gerado com sucesso no modo ${mode} (${Math.round((separation.coverageRatio || 0) * 100)}% de cobertura em ${dpi} DPI).`,
        data: {
          separationId: separation.id,
          role: 'CLEAR',
          mode,
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
      const msg = err instanceof Error ? err.message : 'Falha ao gerar a máscara de Verniz / Clear.';
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
