import React from 'react';

export interface AppLayoutProps {
  header: React.ReactNode;
  leftPanel?: React.ReactNode;
  chatPanel?: React.ReactNode;
  documentPanel?: React.ReactNode;
  canvasViewport: React.ReactNode;
  rightPanel?: React.ReactNode;
  propertiesPanel?: React.ReactNode;
  productionWorkspace?: React.ReactNode;
  statusBar: React.ReactNode;
}

export const AppLayout: React.FC<AppLayoutProps> = ({
  header,
  leftPanel,
  chatPanel,
  documentPanel,
  canvasViewport,
  rightPanel,
  propertiesPanel,
  productionWorkspace,
  statusBar,
}) => {
  const renderedLeft = leftPanel || documentPanel || chatPanel;
  const renderedRight = rightPanel || productionWorkspace || propertiesPanel;

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-surface-base font-sans antialiased text-slate-200">
      {/* 1. Header Superior */}
      {header}

      {/* 2. Área de Trabalho Principal (3 Colunas) */}
      <main className="flex-1 flex overflow-hidden relative">
        {/* Coluna 1: Documento / Elementos / Camadas (Esquerda) */}
        {renderedLeft}

        {/* Coluna 2: Canvas / Prancheta Central (Dominante) */}
        <div className="flex-1 h-full relative flex flex-col min-w-0">
          {canvasViewport}
        </div>

        {/* Coluna 3: Workspace de Produção / Agente / Issues (Direita) */}
        {renderedRight}
      </main>

      {/* 3. Barra de Status Inferior */}
      {statusBar}
    </div>
  );
};
