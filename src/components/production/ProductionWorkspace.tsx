import React, { useState } from 'react';
import { Bot, AlertCircle, FileCheck2 } from 'lucide-react';
import { PrexyonDocument } from '@/core/pdm/types';
import { ValidationReport } from '@/core/validation/types';
import { ProposedFix } from '@/core/autofix/proposalTypes';
import { ProductionStatusBanner, HumanProductionStatus } from './ProductionStatusBanner';
import { PreflightIssuesView } from './PreflightIssuesView';
import { ProductionReviewView } from './ProductionReviewView';
import { ProductionPackage } from '@/core/production/package/types';

import { getProductionReadiness } from '@/core/production/readinessSSOT';

export interface ProductionWorkspaceProps {
  doc?: PrexyonDocument;
  validationReport?: ValidationReport | null;
  proposedFixes?: ProposedFix[];
  packageResult?: ProductionPackage | null;
  isGeneratingPackage?: boolean;
  chatElement: React.ReactNode;
  onApplyProposal?: (proposalId: string) => void;
  onRejectProposal?: (proposalId: string) => void;
  onRunAutoFix?: () => void;
  onSelectNode?: (nodeId: string | null) => void;
  onGeneratePackage?: () => void;
  onOpenExportModal?: () => void;
}

export const ProductionWorkspace: React.FC<ProductionWorkspaceProps> = ({
  doc,
  validationReport,
  proposedFixes = [],
  packageResult,
  isGeneratingPackage = false,
  chatElement,
  onApplyProposal,
  onRejectProposal,
  onRunAutoFix,
  onSelectNode,
  onGeneratePackage,
  onOpenExportModal,
}) => {
  const [activeTab, setActiveTab] = useState<'chat' | 'issues' | 'review'>('chat');

  const packageEvidence = packageResult
    ? {
        status: packageResult.status,
        blockers: packageResult.validation?.blockers || [],
        warnings: packageResult.validation?.warnings || [],
      }
    : undefined;

  // Determina o status canônico via SSOT
  const readiness = getProductionReadiness({
    doc,
    validationReport,
    proposedFixes,
    packageEvidence,
    profileId: doc?.profileId,
  });

  const blockersCount = readiness.blockers.length;
  const warningsCount = readiness.warnings.length;
  const pendingProposalsCount = readiness.pendingConfirmationsCount;
  const issuesTotalCount = blockersCount + warningsCount + pendingProposalsCount;

  let currentStatus: HumanProductionStatus = 'READY_FOR_PRODUCTION';
  if (readiness.status === 'WAITING_FOR_FILE') currentStatus = 'WAITING_FOR_FILE';
  else if (readiness.status === 'BLOCKED') currentStatus = 'BLOCKED';
  else if (readiness.status === 'AWAITING_CONFIRMATION') currentStatus = 'WAITING_CONFIRMATION';
  else if (readiness.status === 'READY_WITH_WARNINGS') currentStatus = 'ATTENTION';
  else currentStatus = 'READY_FOR_PRODUCTION';

  return (
    <aside className="w-96 h-full bg-surface-panel border-l border-surface-border flex flex-col select-none text-slate-200">
      {/* 1. Status Banner no Topo */}
      <ProductionStatusBanner
        status={currentStatus}
        blockerCount={blockersCount}
        warningCount={warningsCount}
        pendingConfirmationCount={pendingProposalsCount}
        onQuickAction={() => setActiveTab('issues')}
      />

      {/* 2. Abas Principais de Produção */}
      <div className="flex border-b border-surface-border bg-surface-subtle/30 px-3 gap-1 shrink-0">
        <button
          type="button"
          onClick={() => setActiveTab('chat')}
          className={`flex items-center gap-1.5 py-2.5 px-3 text-xs font-semibold border-b-2 transition-all cursor-pointer ${
            activeTab === 'chat'
              ? 'border-indigo-500 text-indigo-400 bg-surface-elevated/40'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Bot className="w-3.5 h-3.5" />
          <span>Agente</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('issues')}
          className={`flex items-center gap-1.5 py-2.5 px-3 text-xs font-semibold border-b-2 transition-all cursor-pointer ${
            activeTab === 'issues'
              ? 'border-indigo-500 text-indigo-400 bg-surface-elevated/40'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <AlertCircle className="w-3.5 h-3.5" />
          <span>Problemas</span>
          {issuesTotalCount > 0 && (
            <span
              className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                blockersCount > 0 || readiness.manualActions.length > 0
                  ? 'bg-rose-500/20 text-rose-400'
                  : pendingProposalsCount > 0
                  ? 'bg-amber-500/20 text-amber-300'
                  : 'bg-surface-elevated text-slate-400'
              }`}
            >
              {issuesTotalCount}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('review')}
          className={`flex items-center gap-1.5 py-2.5 px-3 text-xs font-semibold border-b-2 transition-all cursor-pointer ${
            activeTab === 'review'
              ? 'border-indigo-500 text-indigo-400 bg-surface-elevated/40'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <FileCheck2 className="w-3.5 h-3.5" />
          <span>Revisão & Pacote</span>
        </button>
      </div>

      {/* 3. Conteúdo da Aba Ativa */}
      <div className="flex-1 overflow-hidden relative flex flex-col min-h-0">
        {activeTab === 'chat' && <div className="flex-1 h-full">{chatElement}</div>}

        {activeTab === 'issues' && (
          <div className="flex-1 overflow-y-auto p-4">
            <PreflightIssuesView
              validationReport={validationReport}
              proposedFixes={proposedFixes}
              onApplyProposal={onApplyProposal}
              onRejectProposal={onRejectProposal}
              onRunAutoFix={onRunAutoFix}
              onSelectNode={onSelectNode}
            />
          </div>
        )}

        {activeTab === 'review' && (
          <div className="flex-1 overflow-y-auto p-4">
            <ProductionReviewView
              doc={doc}
              validationReport={validationReport}
              proposedFixes={proposedFixes}
              packageResult={packageResult}
              isGeneratingPackage={isGeneratingPackage}
              onGeneratePackage={onGeneratePackage}
              onOpenExportModal={onOpenExportModal}
            />
          </div>
        )}
      </div>
    </aside>
  );
};
