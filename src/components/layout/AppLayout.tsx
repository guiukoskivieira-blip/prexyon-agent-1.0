import React from 'react';

interface AppLayoutProps {
  header: React.ReactNode;
  chatPanel: React.ReactNode;
  canvasViewport: React.ReactNode;
  propertiesPanel: React.ReactNode;
  statusBar: React.ReactNode;
}

export const AppLayout: React.FC<AppLayoutProps> = ({
  header,
  chatPanel,
  canvasViewport,
  propertiesPanel,
  statusBar,
}) => {
  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-surface-base font-sans antialiased text-slate-200">
      {/* 1. Header Superior */}
      {header}

      {/* 2. Área de Trabalho Principal (3 Colunas) */}
      <main className="flex-1 flex overflow-hidden relative">
        {/* Coluna 1: Chat (Esquerda) */}
        {chatPanel}

        {/* Coluna 2: Canvas / Prancheta Central */}
        <div className="flex-1 h-full relative flex flex-col min-w-0">
          {canvasViewport}
        </div>

        {/* Coluna 3: Objetos & Propriedades (Direita) */}
        {propertiesPanel}
      </main>

      {/* 3. Barra de Status Inferior */}
      {statusBar}
    </div>
  );
};
