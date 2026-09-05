import React, { useState, useCallback } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Header } from '@/components/layout/Header';
import { StatusBar } from '@/components/layout/StatusBar';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { PropertiesPanel } from '@/components/properties/PropertiesPanel';
import { CanvasViewport } from '@/components/canvas/CanvasViewport';
import { ArtboardConfig } from '@/types/viewport';

export const App: React.FC = () => {
  // Configuração inicial da prancheta física nominal (100 x 100 mm)
  const [artboard] = useState<ArtboardConfig>({
    widthMm: 100,
    heightMm: 100,
    dpi: 300,
    backgroundColor: '#ffffff',
  });

  // Estado do Viewport (Zoom e Cursor)
  const [zoom, setZoom] = useState<number>(1.0);
  const [cursorMm, setCursorMm] = useState<{ x: number; y: number } | null>(null);

  // Ações de Zoom do Header
  const handleZoomIn = useCallback(() => {
    setZoom((prev) => Math.min(prev * 1.2, 20));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoom((prev) => Math.max(prev / 1.2, 0.1));
  }, []);

  const handleResetZoom = useCallback(() => {
    setZoom(1.0);
  }, []);

  return (
    <AppLayout
      header={
        <Header
          zoom={zoom}
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
          onResetZoom={handleResetZoom}
          artboardWidthMm={artboard.widthMm}
          artboardHeightMm={artboard.heightMm}
        />
      }
      chatPanel={<ChatPanel />}
      canvasViewport={
        <CanvasViewport
          artboard={artboard}
          zoom={zoom}
          onZoomChange={setZoom}
          onCursorMove={setCursorMm}
        />
      }
      propertiesPanel={<PropertiesPanel artboard={artboard} />}
      statusBar={
        <StatusBar
          zoom={zoom}
          cursorMm={cursorMm}
          artboardWidthMm={artboard.widthMm}
          artboardHeightMm={artboard.heightMm}
        />
      }
    />
  );
};

export default App;
