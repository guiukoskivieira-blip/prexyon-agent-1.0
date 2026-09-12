/**
 * Prexyon Agent — Policy & Safety Gate
 *
 * Governança determinística de processos de produção gráfica (DTF UV, Generic Sticker)
 * e aplicação de restrições do operador. O LLM nunca tem autoridade para violar políticas técnicas.
 */

import { PrexyonDocument } from '../../pdm/types';
import { getProductionProfile } from '../../production/profile';
import { AgentActionPlan, PlannedAction, AgentConstraints, ProductionProcess } from './types';

export interface PolicyGateDecision {
  allowed: boolean;
  blockedReason?: string;
  sanitizedAction?: PlannedAction;
}

/**
 * Avalia se uma ação planejada é permitida sob o processo e restrições ativas.
 */
export function evaluatePolicyGate(
  action: PlannedAction,
  plan: AgentActionPlan,
  doc: PrexyonDocument
): PolicyGateDecision {
  const process: ProductionProcess = plan.process || (doc.profileId === 'dtf-uv' ? 'DTF_UV' : 'UNSPECIFIED');
  const constraints: AgentConstraints = plan.constraints || {};
  const tool = action.tool;
  const args = { ...action.arguments };

  // 1. Verificação de Restrições Explícitas do Usuário (Constraints)
  if (constraints.preserveDimensions && tool === 'resize_node') {
    return {
      allowed: false,
      blockedReason: 'Ação bloqueada pela restrição "preserveDimensions": o operador solicitou não alterar o tamanho do objeto.',
    };
  }

  if (constraints.forbidClear && tool === 'generate_clear_separation') {
    return {
      allowed: false,
      blockedReason: 'Ação bloqueada pela restrição "forbidClear": o operador solicitou não aplicar camada de verniz (Clear).',
    };
  }

  if (constraints.forbidWhite && tool === 'generate_white_underbase') {
    return {
      allowed: false,
      blockedReason: 'Ação bloqueada pela restrição "forbidWhite": o operador solicitou não gerar máscara de Base Branca.',
    };
  }

  if (constraints.forbidCutContour && tool === 'create_cut_contour') {
    return {
      allowed: false,
      blockedReason: 'Ação bloqueada pela restrição "forbidCutContour": o operador solicitou não gerar linha de corte.',
    };
  }

  // 2. Aplicação de restrição de proporção (preserveAspectRatio)
  if (constraints.preserveAspectRatio && tool === 'resize_node') {
    args.keepAspectRatio = true;
  }

  // 3. Governança de Processo DTF UV
  if (process === 'DTF_UV' || doc.profileId === 'dtf-uv') {
    const profile = getProductionProfile(doc.profileId || 'dtf-uv');
    if (profile.dtfUvConfig) {
      const effectiveWhitePolicy =
        (doc as any).activeProfile?.rules?.whiteUnderbasePolicy ||
        profile.dtfUvConfig.whitePolicy ||
        'OPTIONAL';
      if (
        tool === 'generate_white_underbase' &&
        (effectiveWhitePolicy === 'DISABLED' || effectiveWhitePolicy === 'RIP_CONTROLLED') &&
        !args.forceBypassPolicy
      ) {
        return {
          allowed: false,
          blockedReason: `A geração de Base Branca está configurada como ${effectiveWhitePolicy} e é gerenciada pelo RIP.`,
        };
      }
      if (tool === 'generate_clear_separation' && (profile.dtfUvConfig.clearPolicy === 'DISABLED' || !profile.dtfUvConfig.capabilities?.supportsClear) && !args.forceBypassPolicy) {
        return {
          allowed: false,
          blockedReason: 'A geração de Verniz (Clear) está desabilitada nas políticas do perfil de produção DTF UV selecionado.',
        };
      }
    }

    // DTF UV não usa corte mecânico nem faca de plotter. Vetorização automática e criação de faca são bloqueadas a menos que o usuário tenha pedido faca explicitamente no intent GENERATE_CUT.
    if (tool === 'create_cut_contour' && plan.intent !== 'GENERATE_CUT') {
      return {
        allowed: false,
        blockedReason: 'No processo DTF UV, o contorno de transferência é delimitado naturalmente pelo canal alfa na película; facas de corte mecânico não são aplicadas.',
      };
    }

    if (tool === 'vectorize_raster' && plan.intent !== 'VECTORIZE') {
      return {
        allowed: false,
        blockedReason: 'No processo DTF UV, imagens raster são impressas em alta resolução com canal alfa sem necessidade de vetorização automática.',
      };
    }

    if (tool === 'create_production_package') {
      // Redireciona ou bloqueia pacote de adesivo genérico em favor de generate_dtf_uv_production_package
      return {
        allowed: false,
        blockedReason: 'Para produção DTF UV, deve ser utilizado o pacote técnico "generate_dtf_uv_production_package".',
      };
    }
  }

  // 4. Governança de Processo Adesivo Convencional (GENERIC_STICKER)
  if (process === 'GENERIC_STICKER') {
    if (tool === 'generate_dtf_uv_production_package') {
      return {
        allowed: false,
        blockedReason: 'O pacote DTF UV não é aplicável ao processo de adesivos convencionais com recorte (generic-sticker).',
      };
    }
  }

  return {
    allowed: true,
    sanitizedAction: {
      ...action,
      arguments: args,
    },
  };
}
