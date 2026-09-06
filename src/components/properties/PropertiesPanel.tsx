import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { 
  Layers, 
  Settings2, 
  Box, 
  Eye, 
  EyeOff, 
  Lock, 
  Unlock, 
  Trash2, 
  Link, 
  Unlink, 
  Image as ImageIcon,
  Check,
  RotateCcw,
  Sparkles,
  Loader2,
  Shapes,
  FolderTree,
  SplitSquareVertical,
  AlertTriangle,
  Scissors,
  Crosshair,
  Compass,
  Copy,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  RefreshCw
} from 'lucide-react';
import { 
  PrexyonDocument, 
  DocumentDimensions,
  DocumentNode, 
  RasterNode, 
  VectorGroupNode, 
  CutContourNode, 
  TechnicalGuideNode,
  TechnicalGuideOrientation,
  TechnicalGuideRole,
  JoinStyle,
  BleedSettings,
  SafetyMarginSettings,
  DEFAULT_PRODUCTION_SETTINGS 
} from '@/core/pdm/types';
import { findCutContourForSourceNode, calculateBleedDimensions, calculateSafetyArea } from '@/core/pdm/document';
import { calculateEffectiveDpi, roundPrecision } from '@/core/pdm/units';
import { generateCutContour } from '@/core/geometry/cutContourEngine';
import { VectorizePresetId, VECTORIZE_PRESETS } from '@/core/vectorizer/presets';
import { analyzeVectorComplexity } from '@/core/vectorizer/complexity';
import { ComparisonMode } from '@/store/editorStore';
import { validateProductionDocument, ValidationReport, ValidationIssue } from '@/core/validation';

interface PropertiesPanelProps {
  doc: PrexyonDocument;
  selectedNodeId: string | null;
  selectedNode?: DocumentNode;
  previewNode?: DocumentNode | null;
  keepAspectRatio: boolean;
  isVectorizing: boolean;
  vectorizePreset: VectorizePresetId;
  comparisonMode: ComparisonMode;
  overlayOpacity: number;
  onSelectPreset: (preset: VectorizePresetId) => void;
  onSetComparisonMode: (mode: ComparisonMode) => void;
  onSetOverlayOpacity: (opacity: number) => void;
  onSelectNode: (nodeId: string | null) => void;
  onVectorizeNode: (nodeId: string, presetId?: VectorizePresetId) => void;
  onCreateCutContour: (
    sourceVectorNodeId: string,
    offset_mm: number,
    joinStyle: JoinStyle,
    includeInnerContours?: boolean,
    strokeWidth_mm?: number
  ) => void;
  onUpdateCutContour: (
    contourNodeId: string,
    optionsOrOffset:
      | {
          offset_mm?: number;
          joinStyle?: JoinStyle;
          includeInnerContours?: boolean;
          strokeWidth_mm?: number;
        }
      | number,
    joinStyle?: JoinStyle,
    includeInnerContours?: boolean,
    strokeWidth_mm?: number
  ) => void;
  onUpdateCutContourStrokeWidth?: (contourNodeId: string, strokeWidth_mm: number) => void;
  onDeleteCutContour: (contourNodeId: string) => void;
  onSetPreviewNode?: (node: DocumentNode | null) => void;
  onApplyCutContourChanges?: (nodeId: string, nextNode: CutContourNode) => void;
  onUpdateWidth: (nodeId: string, width_mm: number, isLive?: boolean) => void;
  onUpdateHeight: (nodeId: string, height_mm: number, isLive?: boolean) => void;
  onUpdatePosition: (nodeId: string, pos: { x?: number; y?: number }, isLive?: boolean) => void;
  onCommitDimensions?: (
    nodeId: string,
    initialDimensions: { width_mm?: number; height_mm?: number; physicalWidth_mm?: number; physicalHeight_mm?: number; aspectRatio?: number },
    finalDimensions: { width_mm?: number; height_mm?: number; physicalWidth_mm?: number; physicalHeight_mm?: number; aspectRatio?: number }
  ) => void;
  onCommitPosition?: (
    nodeId: string,
    initialPosition: { x: number; y: number },
    finalPosition: { x: number; y: number }
  ) => void;
  onCenterCutContour?: (contourNodeId: string) => void;
  onSetArtboardDimensions?: (dimensions: Partial<DocumentDimensions>, isLive?: boolean) => void;
  onCommitArtboardDimensions?: (prev: DocumentDimensions, next: DocumentDimensions) => void;
  onUpdateBleedSettings?: (settings: Partial<BleedSettings>, isLive?: boolean) => void;
  onCommitBleedSettings?: (prev: BleedSettings, next: BleedSettings) => void;
  onUpdateSafetyMarginSettings?: (settings: Partial<SafetyMarginSettings>, isLive?: boolean) => void;
  onCommitSafetyMarginSettings?: (prev: SafetyMarginSettings, next: SafetyMarginSettings) => void;
  onCreateTechnicalGuide?: (params: {
    orientation: TechnicalGuideOrientation;
    guidePosition_mm?: number;
    guideRole?: TechnicalGuideRole;
    strokeColor?: string;
    strokeWidth_mm?: number;
  }) => void;
  onUpdateTechnicalGuide?: (guideNodeId: string, updates: Partial<TechnicalGuideNode>, isLive?: boolean) => void;
  onCommitTechnicalGuide?: (guideNodeId: string, prev: TechnicalGuideNode, next: TechnicalGuideNode) => void;
  onDuplicateTechnicalGuide?: (guideNodeId: string) => void;
  onChangeTechnicalGuideOrientation?: (guideNodeId: string, orientation: TechnicalGuideOrientation) => void;
  onUpdateName: (nodeId: string, name: string) => void;
  onResetAspectRatio: (nodeId: string) => void;
  onToggleVisibility: (nodeId: string) => void;
  onToggleLock: (nodeId: string) => void;
  onDeleteNode: (nodeId: string) => void;
  onToggleKeepAspectRatio: () => void;
  validationReport?: ValidationReport;
  onRunValidation?: (customDoc?: PrexyonDocument) => ValidationReport;
}

export const PropertiesPanel: React.FC<PropertiesPanelProps> = ({
  doc,
  selectedNodeId,
  selectedNode,
  previewNode,
  keepAspectRatio,
  isVectorizing,
  vectorizePreset,
  comparisonMode,
  overlayOpacity,
  onSelectPreset,
  onSetComparisonMode,
  onSetOverlayOpacity,
  onSelectNode,
  onVectorizeNode,
  onCreateCutContour,
  onUpdateCutContour,
  onUpdateCutContourStrokeWidth: _onUpdateCutContourStrokeWidth,
  onDeleteCutContour,
  onSetPreviewNode,
  onApplyCutContourChanges,
  onUpdateWidth,
  onUpdateHeight,
  onUpdatePosition,
  onCommitDimensions,
  onCommitPosition,
  onCenterCutContour,
  onSetArtboardDimensions,
  onCommitArtboardDimensions,
  onUpdateBleedSettings,
  onCommitBleedSettings,
  onUpdateSafetyMarginSettings,
  onCommitSafetyMarginSettings,
  onCreateTechnicalGuide,
  onUpdateTechnicalGuide,
  onCommitTechnicalGuide,
  onDuplicateTechnicalGuide,
  onChangeTechnicalGuideOrientation,
  onUpdateName,
  onResetAspectRatio,
  onToggleVisibility,
  onToggleLock,
  onDeleteNode,
  onToggleKeepAspectRatio,
  validationReport: externalValidationReport,
  onRunValidation,
}) => {
  const [activeTab, setActiveTab] = useState<'objects' | 'artboard' | 'validation'>('objects');
  const [validationFilter, setValidationFilter] = useState<'all' | 'error' | 'warning' | 'info'>('all');
  const [isVerifying, setIsVerifying] = useState<boolean>(false);
  const [verifiedAtNotice, setVerifiedAtNotice] = useState<string | null>(null);

  // Relatório reativo de validação de produção gráfica
  const [localValidationReport, setLocalValidationReport] = useState<ValidationReport>(() =>
    externalValidationReport || validateProductionDocument(doc)
  );

  useEffect(() => {
    if (externalValidationReport) {
      setLocalValidationReport(externalValidationReport);
    } else {
      setLocalValidationReport(validateProductionDocument(doc));
    }
  }, [doc, externalValidationReport]);

  const activeReport = externalValidationReport || localValidationReport;

  const handleManualVerify = useCallback(() => {
    setIsVerifying(true);
    let report: ValidationReport;
    if (onRunValidation) {
      report = onRunValidation(doc);
    } else {
      report = validateProductionDocument(doc);
      setLocalValidationReport(report);
    }
    setTimeout(() => {
      setIsVerifying(false);
      setVerifiedAtNotice('Verificado agora');
      setTimeout(() => setVerifiedAtNotice(null), 2500);
    }, 200);
  }, [doc, onRunValidation]);

  const formattedCheckedAt = useMemo(() => {
    try {
      const d = new Date(activeReport.checkedAt);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
      return '';
    }
  }, [activeReport.checkedAt]);

  const filteredIssues: ValidationIssue[] = useMemo(() => {
    if (validationFilter === 'all') return activeReport.issues;
    return activeReport.issues.filter((i) => i.severity === validationFilter);
  }, [activeReport, validationFilter]);

  // Estados locais para inputs numéricos controlados
  const [widthInput, setWidthInput] = useState<string>('');
  const [heightInput, setHeightInput] = useState<string>('');
  const [posXInput, setPosXInput] = useState<string>('');
  const [posYInput, setPosYInput] = useState<string>('');
  const [nameInput, setNameInput] = useState<string>('');
  const [cutOffsetInput, setCutOffsetInput] = useState<string>('2.00');
  const [cutJoinStyle, setCutJoinStyle] = useState<JoinStyle>('round');
  const [cutOnlyOuter, setCutOnlyOuter] = useState<boolean>(true);
  const [cutStrokeWidthInput, setCutStrokeWidthInput] = useState<string>('0.30');

  // Estados locais para dimensões da prancheta
  const [artboardWidthInput, setArtboardWidthInput] = useState<string>(doc.dimensions.width_mm.toString());
  const [artboardHeightInput, setArtboardHeightInput] = useState<string>(doc.dimensions.height_mm.toString());

  // Estados locais para Sangria (Bleed) e Margem de Segurança (Safety)
  const currentBleed = doc.productionSettings?.bleed || DEFAULT_PRODUCTION_SETTINGS.bleed;
  const currentSafety = doc.productionSettings?.safetyMargin || DEFAULT_PRODUCTION_SETTINGS.safetyMargin;
  const bleedSettings = currentBleed;
  const safetySettings = currentSafety;
  const bleedBox = calculateBleedDimensions(doc.dimensions, bleedSettings);
  const safetyBox = calculateSafetyArea(doc.dimensions, safetySettings);

  const [bleedUniformInput, setBleedUniformInput] = useState<string>(currentBleed.top_mm.toString());
  const [bleedTopInput, setBleedTopInput] = useState<string>(currentBleed.top_mm.toString());
  const [bleedRightInput, setBleedRightInput] = useState<string>(currentBleed.right_mm.toString());
  const [bleedBottomInput, setBleedBottomInput] = useState<string>(currentBleed.bottom_mm.toString());
  const [bleedLeftInput, setBleedLeftInput] = useState<string>(currentBleed.left_mm.toString());

  const [safetyUniformInput, setSafetyUniformInput] = useState<string>(currentSafety.top_mm.toString());
  const [safetyTopInput, setSafetyTopInput] = useState<string>(currentSafety.top_mm.toString());
  const [safetyRightInput, setSafetyRightInput] = useState<string>(currentSafety.right_mm.toString());
  const [safetyBottomInput, setSafetyBottomInput] = useState<string>(currentSafety.bottom_mm.toString());
  const [safetyLeftInput, setSafetyLeftInput] = useState<string>(currentSafety.left_mm.toString());

  // Refs para capturar estado inicial antes de edições contínuas (para granularidade de Undo/Redo no blur)
  const sessionInitialNodeRef = useRef<{
    id: string;
    width_mm: number;
    height_mm: number;
    x: number;
    y: number;
  } | null>(null);
  const sessionInitialArtboardRef = useRef<DocumentDimensions | null>(null);
  const sessionInitialBleedRef = useRef<BleedSettings | null>(null);
  const sessionInitialSafetyRef = useRef<SafetyMarginSettings | null>(null);

  // Sincroniza inputs locais de Sangria e Margem de Segurança com doc.productionSettings
  useEffect(() => {
    const bleed = doc.productionSettings?.bleed || DEFAULT_PRODUCTION_SETTINGS.bleed;
    setBleedUniformInput(bleed.top_mm.toString());
    setBleedTopInput(bleed.top_mm.toString());
    setBleedRightInput(bleed.right_mm.toString());
    setBleedBottomInput(bleed.bottom_mm.toString());
    setBleedLeftInput(bleed.left_mm.toString());
  }, [
    doc.productionSettings?.bleed?.enabled,
    doc.productionSettings?.bleed?.top_mm,
    doc.productionSettings?.bleed?.right_mm,
    doc.productionSettings?.bleed?.bottom_mm,
    doc.productionSettings?.bleed?.left_mm,
    doc.productionSettings?.bleed?.linked,
  ]);

  useEffect(() => {
    const safety = doc.productionSettings?.safetyMargin || DEFAULT_PRODUCTION_SETTINGS.safetyMargin;
    setSafetyUniformInput(safety.top_mm.toString());
    setSafetyTopInput(safety.top_mm.toString());
    setSafetyRightInput(safety.right_mm.toString());
    setSafetyBottomInput(safety.bottom_mm.toString());
    setSafetyLeftInput(safety.left_mm.toString());
  }, [
    doc.productionSettings?.safetyMargin?.enabled,
    doc.productionSettings?.safetyMargin?.top_mm,
    doc.productionSettings?.safetyMargin?.right_mm,
    doc.productionSettings?.safetyMargin?.bottom_mm,
    doc.productionSettings?.safetyMargin?.left_mm,
    doc.productionSettings?.safetyMargin?.linked,
  ]);

  const isRaster = selectedNode?.type === 'raster_image';
  const isVectorGroup = selectedNode?.type === 'group';
  const isCutContour = selectedNode?.type === 'cut_contour';
  const isTechnicalGuide = selectedNode?.type === 'technical_guide';
  const rasterNode = isRaster ? (selectedNode as RasterNode) : undefined;
  const groupNode = isVectorGroup ? (selectedNode as VectorGroupNode) : undefined;
  const cutContourNode = isCutContour ? (selectedNode as CutContourNode) : undefined;
  const guideNode = isTechnicalGuide ? (selectedNode as TechnicalGuideNode) : undefined;

  // Estados locais para Guia Técnica
  const [guidePositionInput, setGuidePositionInput] = useState<string>('');
  const [guideStrokeWidthInput, setGuideStrokeWidthInput] = useState<string>('0.25');
  const sessionInitialGuideRef = useRef<TechnicalGuideNode | null>(null);

  // Faca dependente vinculada ao grupo selecionado (se houver)
  const attachedCutContour = groupNode ? findCutContourForSourceNode(doc, groupNode.id) : undefined;

  // Verifica se há pelo menos um vetor e um raster no documento para habilitar ferramentas de comparação
  const hasRaster = Object.values(doc.nodes).some((n) => n.type === 'raster_image');
  const hasVector = Object.values(doc.nodes).some((n) => n.type === 'group');

  // Sincroniza inputs locais sempre que selectedNode mudar no PDM
  useEffect(() => {
    if (selectedNode && (isRaster || isVectorGroup || isCutContour)) {
      const target = selectedNode as RasterNode | VectorGroupNode | CutContourNode;
      setWidthInput(target.physicalWidth_mm.toString());
      setHeightInput(target.physicalHeight_mm.toString());
      setPosXInput(target.position_mm.x.toString());
      setPosYInput(target.position_mm.y.toString());
      setNameInput(target.name);
      if (target.type === 'cut_contour') {
        const cut = target as CutContourNode;
        setCutOffsetInput(cut.offset_mm.toString());
        setCutJoinStyle(cut.joinStyle);
        setCutOnlyOuter(!cut.includeInnerContours);
        setCutStrokeWidthInput((cut.strokeWidth_mm || 0.30).toFixed(2));
      }
    } else if (selectedNode && isTechnicalGuide && guideNode) {
      setGuidePositionInput(guideNode.guidePosition_mm.toString());
      setGuideStrokeWidthInput((guideNode.strokeWidth_mm || 0.25).toFixed(2));
      setNameInput(guideNode.name);
    }
    // Ao trocar de nó selecionado, limpa preview temporário
    onSetPreviewNode?.(null);
  }, [
    selectedNode?.id,
    selectedNode?.type,
    isRaster,
    isVectorGroup,
    isCutContour,
    isTechnicalGuide,
    rasterNode?.physicalWidth_mm,
    rasterNode?.physicalHeight_mm,
    rasterNode?.position_mm.x,
    rasterNode?.position_mm.y,
    rasterNode?.name,
    groupNode?.physicalWidth_mm,
    groupNode?.physicalHeight_mm,
    groupNode?.position_mm.x,
    groupNode?.position_mm.y,
    groupNode?.name,
    cutContourNode?.physicalWidth_mm,
    cutContourNode?.physicalHeight_mm,
    cutContourNode?.position_mm.x,
    cutContourNode?.position_mm.y,
    cutContourNode?.name,
    cutContourNode?.offset_mm,
    cutContourNode?.joinStyle,
    cutContourNode?.includeInnerContours,
    cutContourNode?.strokeWidth_mm,
    guideNode?.guidePosition_mm,
    guideNode?.strokeWidth_mm,
    guideNode?.orientation,
    guideNode?.guideRole,
    guideNode?.name,
  ]);

  // Sincroniza inputs locais da prancheta sempre que as dimensões mudarem no PDM
  useEffect(() => {
    setArtboardWidthInput(doc.dimensions.width_mm.toString());
    setArtboardHeightInput(doc.dimensions.height_mm.toString());
  }, [doc.dimensions.width_mm, doc.dimensions.height_mm]);

  // Função auxiliar de cálculo de Preview para CutContourNode
  const computeAndSetCutPreview = (overrides?: {
    offset?: number;
    strokeWidth?: number;
    joinStyle?: JoinStyle;
    onlyOuter?: boolean;
    width?: number;
    height?: number;
    posX?: number;
    posY?: number;
  }) => {
    if (!isCutContour || !cutContourNode) return;
    const off = overrides?.offset !== undefined ? overrides.offset : (parseFloat(cutOffsetInput) || cutContourNode.offset_mm);
    const sw = overrides?.strokeWidth !== undefined ? overrides.strokeWidth : (parseFloat(cutStrokeWidthInput) || cutContourNode.strokeWidth_mm || 0.30);
    const js = overrides?.joinStyle !== undefined ? overrides.joinStyle : cutJoinStyle;
    const oo = overrides?.onlyOuter !== undefined ? overrides.onlyOuter : cutOnlyOuter;
    const w = overrides?.width !== undefined ? overrides.width : (parseFloat(widthInput) || cutContourNode.physicalWidth_mm);
    const h = overrides?.height !== undefined ? overrides.height : (parseFloat(heightInput) || cutContourNode.physicalHeight_mm);
    const px = overrides?.posX !== undefined ? overrides.posX : (parseFloat(posXInput) !== undefined && !isNaN(parseFloat(posXInput)) ? parseFloat(posXInput) : cutContourNode.position_mm.x);
    const py = overrides?.posY !== undefined ? overrides.posY : (parseFloat(posYInput) !== undefined && !isNaN(parseFloat(posYInput)) ? parseFloat(posYInput) : cutContourNode.position_mm.y);

    const isOffsetDirty = Math.abs(off - cutContourNode.offset_mm) > 0.001;
    const isStrokeDirty = Math.abs(sw - (cutContourNode.strokeWidth_mm || 0.30)) > 0.001;
    const isJoinDirty = js !== cutContourNode.joinStyle;
    const isInnerDirty = (!oo) !== !!cutContourNode.includeInnerContours;
    const isWidthDirty = Math.abs(w - cutContourNode.physicalWidth_mm) > 0.001;
    const isHeightDirty = Math.abs(h - cutContourNode.physicalHeight_mm) > 0.001;
    const isPosDirty = Math.abs(px - cutContourNode.position_mm.x) > 0.001 || Math.abs(py - cutContourNode.position_mm.y) > 0.001;
    const isDirty = isOffsetDirty || isStrokeDirty || isJoinDirty || isInnerDirty || isWidthDirty || isHeightDirty || isPosDirty;

    if (!isDirty) {
      onSetPreviewNode?.(null);
      return;
    }

    const sourceGroup = doc.nodes[cutContourNode.sourceNodeId] as VectorGroupNode | undefined;
    let contours = cutContourNode.contours;
    let targetPosX = px;
    let targetPosY = py;
    let physWidth = w;
    let physHeight = h;

    if ((isOffsetDirty || isJoinDirty || isInnerDirty) && sourceGroup && sourceGroup.type === 'group') {
      try {
        const result = generateCutContour(sourceGroup, doc, {
          offset_mm: off,
          joinStyle: js,
          includeInnerContours: !oo,
        });
        const dx = px - cutContourNode.position_mm.x;
        const dy = py - cutContourNode.position_mm.y;
        contours = result.contours.map((c) => ({
          ...c,
          points_mm: c.points_mm.map((pt) => ({
            x: roundPrecision(pt.x + dx, 4),
            y: roundPrecision(pt.y + dy, 4),
          })),
        }));
        targetPosX = result.boundingBox_mm.minX + dx;
        targetPosY = result.boundingBox_mm.minY + dy;
        physWidth = result.boundingBox_mm.width_mm;
        physHeight = result.boundingBox_mm.height_mm;
      } catch (err) {
        console.error('Failed to generate preview cut contour', err);
      }
    } else if (isWidthDirty || isHeightDirty) {
      if (cutContourNode.physicalWidth_mm > 0 && cutContourNode.physicalHeight_mm > 0) {
        const scaleX = w / cutContourNode.physicalWidth_mm;
        const scaleY = h / cutContourNode.physicalHeight_mm;
        const basePosX = cutContourNode.position_mm.x;
        const basePosY = cutContourNode.position_mm.y;
        const dx = px - basePosX;
        const dy = py - basePosY;
        contours = cutContourNode.contours.map((c) => ({
          ...c,
          points_mm: c.points_mm.map((pt) => ({
            x: roundPrecision(basePosX + (pt.x - basePosX) * scaleX + dx, 4),
            y: roundPrecision(basePosY + (pt.y - basePosY) * scaleY + dy, 4),
          })),
        }));
      }
    } else if (isPosDirty) {
      const dx = px - cutContourNode.position_mm.x;
      const dy = py - cutContourNode.position_mm.y;
      contours = cutContourNode.contours.map((c) => ({
        ...c,
        points_mm: c.points_mm.map((pt) => ({
          x: roundPrecision(pt.x + dx, 4),
          y: roundPrecision(pt.y + dy, 4),
        })),
      }));
    }

    const preview: CutContourNode = {
      ...cutContourNode,
      offset_mm: off,
      joinStyle: js,
      includeInnerContours: !oo,
      strokeWidth_mm: sw,
      physicalWidth_mm: physWidth,
      physicalHeight_mm: physHeight,
      position_mm: { x: targetPosX, y: targetPosY },
      contours,
      metadata: {
        ...cutContourNode.metadata,
        manualPositionApplied: true,
        calculatedAt: new Date().toISOString(),
      },
    };

    onSetPreviewNode?.(preview);
  };

  const isCutDirty = Boolean(
    isCutContour &&
    cutContourNode &&
    (
      Math.abs((parseFloat(cutOffsetInput) || cutContourNode.offset_mm) - cutContourNode.offset_mm) > 0.001 ||
      Math.abs((parseFloat(cutStrokeWidthInput) || (cutContourNode.strokeWidth_mm || 0.30)) - (cutContourNode.strokeWidth_mm || 0.30)) > 0.001 ||
      cutJoinStyle !== cutContourNode.joinStyle ||
      (!cutOnlyOuter) !== !!cutContourNode.includeInnerContours ||
      (parseFloat(widthInput) > 0 && Math.abs(parseFloat(widthInput) - cutContourNode.physicalWidth_mm) > 0.001) ||
      (parseFloat(heightInput) > 0 && Math.abs(parseFloat(heightInput) - cutContourNode.physicalHeight_mm) > 0.001) ||
      (parseFloat(posXInput) !== undefined && !isNaN(parseFloat(posXInput)) && Math.abs(parseFloat(posXInput) - cutContourNode.position_mm.x) > 0.001) ||
      (parseFloat(posYInput) !== undefined && !isNaN(parseFloat(posYInput)) && Math.abs(parseFloat(posYInput) - cutContourNode.position_mm.y) > 0.001)
    )
  );

  const handleCancelCutPreview = () => {
    if (!cutContourNode) return;
    setCutOffsetInput(cutContourNode.offset_mm.toString());
    setCutStrokeWidthInput((cutContourNode.strokeWidth_mm || 0.30).toFixed(2));
    setCutJoinStyle(cutContourNode.joinStyle);
    setCutOnlyOuter(!cutContourNode.includeInnerContours);
    setWidthInput(cutContourNode.physicalWidth_mm.toString());
    setHeightInput(cutContourNode.physicalHeight_mm.toString());
    setPosXInput(cutContourNode.position_mm.x.toString());
    setPosYInput(cutContourNode.position_mm.y.toString());
    onSetPreviewNode?.(null);
  };

  const handleApplyCutChanges = () => {
    if (!cutContourNode || !isCutDirty) return;
    const off = parseFloat(cutOffsetInput) || cutContourNode.offset_mm;
    const sw = parseFloat(cutStrokeWidthInput) || cutContourNode.strokeWidth_mm || 0.30;
    const js = cutJoinStyle;
    const oo = cutOnlyOuter;
    const w = parseFloat(widthInput) || cutContourNode.physicalWidth_mm;
    const h = parseFloat(heightInput) || cutContourNode.physicalHeight_mm;
    const px = parseFloat(posXInput) !== undefined && !isNaN(parseFloat(posXInput)) ? parseFloat(posXInput) : cutContourNode.position_mm.x;
    const py = parseFloat(posYInput) !== undefined && !isNaN(parseFloat(posYInput)) ? parseFloat(posYInput) : cutContourNode.position_mm.y;

    let nextNode: CutContourNode;
    if (previewNode && previewNode.id === cutContourNode.id && previewNode.type === 'cut_contour') {
      nextNode = {
        ...(previewNode as CutContourNode),
        metadata: {
          ...cutContourNode.metadata,
          calculatedAt: new Date().toISOString(),
        },
      };
    } else {
      const sourceGroup = doc.nodes[cutContourNode.sourceNodeId] as VectorGroupNode | undefined;
      let contours = cutContourNode.contours;
      let targetPosX = px;
      let targetPosY = py;
      let physWidth = w;
      let physHeight = h;

      if (sourceGroup && sourceGroup.type === 'group') {
        try {
          const result = generateCutContour(sourceGroup, doc, {
            offset_mm: off,
            joinStyle: js,
            includeInnerContours: !oo,
          });
          const dx = px - cutContourNode.position_mm.x;
          const dy = py - cutContourNode.position_mm.y;
          contours = result.contours.map((c) => ({
            ...c,
            points_mm: c.points_mm.map((pt) => ({
              x: roundPrecision(pt.x + dx, 4),
              y: roundPrecision(pt.y + dy, 4),
            })),
          }));
          targetPosX = result.boundingBox_mm.minX + dx;
          targetPosY = result.boundingBox_mm.minY + dy;
          physWidth = result.boundingBox_mm.width_mm;
          physHeight = result.boundingBox_mm.height_mm;
        } catch (err) {
          console.error('Failed to generate cut contour on apply', err);
        }
      } else {
        const dx = px - cutContourNode.position_mm.x;
        const dy = py - cutContourNode.position_mm.y;
        contours = cutContourNode.contours.map((c) => ({
          ...c,
          points_mm: c.points_mm.map((pt) => ({
            x: roundPrecision(pt.x + dx, 4),
            y: roundPrecision(pt.y + dy, 4),
          })),
        }));
      }

      nextNode = {
        ...cutContourNode,
        offset_mm: off,
        joinStyle: js,
        includeInnerContours: !oo,
        strokeWidth_mm: sw,
        physicalWidth_mm: physWidth,
        physicalHeight_mm: physHeight,
        position_mm: { x: targetPosX, y: targetPosY },
        contours,
        metadata: {
          ...cutContourNode.metadata,
          manualPositionApplied: true,
          calculatedAt: new Date().toISOString(),
        },
      };
    }

    if (onApplyCutContourChanges) {
      onApplyCutContourChanges(cutContourNode.id, nextNode);
    } else {
      onUpdateCutContour(cutContourNode.id, {
        offset_mm: nextNode.offset_mm,
        joinStyle: nextNode.joinStyle,
        includeInnerContours: nextNode.includeInnerContours,
        strokeWidth_mm: nextNode.strokeWidth_mm,
      });
    }
    onSetPreviewNode?.(null);
  };

  // Captura o estado do nó no início do foco de um input para criar apenas 1 histórico ao final
  const handleInputFocus = () => {
    if (!selectedNode) return;
    const target = selectedNode as RasterNode | VectorGroupNode | CutContourNode;
    if (!sessionInitialNodeRef.current || sessionInitialNodeRef.current.id !== target.id) {
      sessionInitialNodeRef.current = {
        id: target.id,
        width_mm: target.physicalWidth_mm,
        height_mm: target.physicalHeight_mm,
        x: target.position_mm.x,
        y: target.position_mm.y,
      };
    }
  };

  // Reatividade Imediata: Largura
  const handleWidthChange = (valStr: string) => {
    setWidthInput(valStr);
    if (!selectedNode) return;

    if (!sessionInitialNodeRef.current || sessionInitialNodeRef.current.id !== selectedNode.id) {
      const target = selectedNode as RasterNode | VectorGroupNode | CutContourNode;
      sessionInitialNodeRef.current = {
        id: target.id,
        width_mm: target.physicalWidth_mm,
        height_mm: target.physicalHeight_mm,
        x: target.position_mm.x,
        y: target.position_mm.y,
      };
    }

    const num = parseFloat(valStr);
    if (isNaN(num) || num <= 0) return;

    if (isCutContour) {
      computeAndSetCutPreview({ width: num });
      return;
    }

    // Se proporcional, atualiza altura proporcionalmente
    const physNode = selectedNode as RasterNode | VectorGroupNode | CutContourNode;
    if (keepAspectRatio && physNode.physicalWidth_mm > 0) {
      const ratio =
        physNode.aspectRatio ||
        (physNode.physicalHeight_mm > 0 ? physNode.physicalWidth_mm / physNode.physicalHeight_mm : 1) ||
        1;
      const nextH = roundPrecision(num / ratio, 2);
      setHeightInput(nextH.toString());
    }

    // Atualização reativa imediata no Canvas/PDM
    onUpdateWidth(selectedNode.id, num, true);
  };

  const handleWidthBlur = () => {
    if (!selectedNode) return;
    const num = parseFloat(widthInput);
    if (!isNaN(num) && num > 0) {
      if (isCutContour) {
        computeAndSetCutPreview({ width: num });
      } else {
        if (sessionInitialNodeRef.current && sessionInitialNodeRef.current.id === selectedNode.id) {
          const initial = sessionInitialNodeRef.current;
          const finalW = num;
          const finalH = parseFloat(heightInput) || (selectedNode as RasterNode).physicalHeight_mm;
          if (Math.abs(initial.width_mm - finalW) > 0.001 || Math.abs(initial.height_mm - finalH) > 0.001) {
            onCommitDimensions?.(selectedNode.id, { width_mm: initial.width_mm, height_mm: initial.height_mm }, { width_mm: finalW, height_mm: finalH });
          }
        } else {
          onUpdateWidth(selectedNode.id, num, false);
        }
      }
    } else {
      const target = selectedNode as RasterNode | VectorGroupNode | CutContourNode;
      setWidthInput(target.physicalWidth_mm?.toString() || '');
    }
    sessionInitialNodeRef.current = null;
  };

  // Reatividade Imediata: Altura
  const handleHeightChange = (valStr: string) => {
    setHeightInput(valStr);
    if (!selectedNode) return;

    if (!sessionInitialNodeRef.current || sessionInitialNodeRef.current.id !== selectedNode.id) {
      const target = selectedNode as RasterNode | VectorGroupNode | CutContourNode;
      sessionInitialNodeRef.current = {
        id: target.id,
        width_mm: target.physicalWidth_mm,
        height_mm: target.physicalHeight_mm,
        x: target.position_mm.x,
        y: target.position_mm.y,
      };
    }

    const num = parseFloat(valStr);
    if (isNaN(num) || num <= 0) return;

    if (isCutContour) {
      computeAndSetCutPreview({ height: num });
      return;
    }

    // Se proporcional, atualiza largura proporcionalmente
    const physNode = selectedNode as RasterNode | VectorGroupNode | CutContourNode;
    if (keepAspectRatio && physNode.physicalHeight_mm > 0) {
      const ratio =
        physNode.aspectRatio ||
        (physNode.physicalHeight_mm > 0 ? physNode.physicalWidth_mm / physNode.physicalHeight_mm : 1) ||
        1;
      const nextW = roundPrecision(num * ratio, 2);
      setWidthInput(nextW.toString());
    }

    // Atualização reativa imediata no Canvas/PDM
    onUpdateHeight(selectedNode.id, num, true);
  };

  const handleHeightBlur = () => {
    if (!selectedNode) return;
    const num = parseFloat(heightInput);
    if (!isNaN(num) && num > 0) {
      if (isCutContour) {
        computeAndSetCutPreview({ height: num });
      } else {
        if (sessionInitialNodeRef.current && sessionInitialNodeRef.current.id === selectedNode.id) {
          const initial = sessionInitialNodeRef.current;
          const finalH = num;
          const finalW = parseFloat(widthInput) || (selectedNode as RasterNode).physicalWidth_mm;
          if (Math.abs(initial.width_mm - finalW) > 0.001 || Math.abs(initial.height_mm - finalH) > 0.001) {
            onCommitDimensions?.(selectedNode.id, { width_mm: initial.width_mm, height_mm: initial.height_mm }, { width_mm: finalW, height_mm: finalH });
          }
        } else {
          onUpdateHeight(selectedNode.id, num, false);
        }
      }
    } else {
      const target = selectedNode as RasterNode | VectorGroupNode | CutContourNode;
      setHeightInput(target.physicalHeight_mm?.toString() || '');
    }
    sessionInitialNodeRef.current = null;
  };

  // Reatividade Imediata: Posição X
  const handlePosXChange = (valStr: string) => {
    setPosXInput(valStr);
    if (!selectedNode) return;

    if (!sessionInitialNodeRef.current || sessionInitialNodeRef.current.id !== selectedNode.id) {
      const target = selectedNode as RasterNode | VectorGroupNode | CutContourNode;
      sessionInitialNodeRef.current = {
        id: target.id,
        width_mm: target.physicalWidth_mm,
        height_mm: target.physicalHeight_mm,
        x: target.position_mm.x,
        y: target.position_mm.y,
      };
    }

    const num = parseFloat(valStr);
    if (isNaN(num)) return;

    if (isCutContour) {
      computeAndSetCutPreview({ posX: num });
    } else {
      onUpdatePosition(selectedNode.id, { x: num }, true);
    }
  };

  const handlePosXBlur = () => {
    if (!selectedNode) return;
    const num = parseFloat(posXInput);
    if (!isNaN(num)) {
      if (isCutContour) {
        computeAndSetCutPreview({ posX: num });
      } else {
        if (sessionInitialNodeRef.current && sessionInitialNodeRef.current.id === selectedNode.id) {
          const initial = sessionInitialNodeRef.current;
          const finalX = num;
          const finalY = parseFloat(posYInput) !== undefined && !isNaN(parseFloat(posYInput)) ? parseFloat(posYInput) : (selectedNode as RasterNode).position_mm.y;
          if (Math.abs(initial.x - finalX) > 0.001 || Math.abs(initial.y - finalY) > 0.001) {
            onCommitPosition?.(selectedNode.id, { x: initial.x, y: initial.y }, { x: finalX, y: finalY });
          }
        } else {
          onUpdatePosition(selectedNode.id, { x: num }, false);
        }
      }
    } else {
      setPosXInput(selectedNode.position_mm.x.toString());
    }
    sessionInitialNodeRef.current = null;
  };

  // Reatividade Imediata: Posição Y
  const handlePosYChange = (valStr: string) => {
    setPosYInput(valStr);
    if (!selectedNode) return;

    if (!sessionInitialNodeRef.current || sessionInitialNodeRef.current.id !== selectedNode.id) {
      const target = selectedNode as RasterNode | VectorGroupNode | CutContourNode;
      sessionInitialNodeRef.current = {
        id: target.id,
        width_mm: target.physicalWidth_mm,
        height_mm: target.physicalHeight_mm,
        x: target.position_mm.x,
        y: target.position_mm.y,
      };
    }

    const num = parseFloat(valStr);
    if (isNaN(num)) return;

    if (isCutContour) {
      computeAndSetCutPreview({ posY: num });
    } else {
      onUpdatePosition(selectedNode.id, { y: num }, true);
    }
  };

  const handlePosYBlur = () => {
    if (!selectedNode) return;
    const num = parseFloat(posYInput);
    if (!isNaN(num)) {
      if (isCutContour) {
        computeAndSetCutPreview({ posY: num });
      } else {
        if (sessionInitialNodeRef.current && sessionInitialNodeRef.current.id === selectedNode.id) {
          const initial = sessionInitialNodeRef.current;
          const finalY = num;
          const finalX = parseFloat(posXInput) !== undefined && !isNaN(parseFloat(posXInput)) ? parseFloat(posXInput) : (selectedNode as RasterNode).position_mm.x;
          if (Math.abs(initial.x - finalX) > 0.001 || Math.abs(initial.y - finalY) > 0.001) {
            onCommitPosition?.(selectedNode.id, { x: initial.x, y: initial.y }, { x: finalX, y: finalY });
          }
        } else {
          onUpdatePosition(selectedNode.id, { y: num }, false);
        }
      }
    } else {
      setPosYInput(selectedNode.position_mm.y.toString());
    }
    sessionInitialNodeRef.current = null;
  };

  const handleArtboardWidthChange = (valStr: string) => {
    setArtboardWidthInput(valStr);
    if (!sessionInitialArtboardRef.current) {
      sessionInitialArtboardRef.current = { ...doc.dimensions };
    }
    const num = parseFloat(valStr);
    if (!isNaN(num) && num >= 10 && num <= 5000) {
      onSetArtboardDimensions?.({ width_mm: num, height_mm: doc.dimensions.height_mm }, true);
    }
  };

  const handleArtboardWidthBlur = () => {
    const val = parseFloat(artboardWidthInput);
    if (!isNaN(val) && val >= 10 && val <= 5000) {
      if (sessionInitialArtboardRef.current) {
        const initial = sessionInitialArtboardRef.current;
        sessionInitialArtboardRef.current = null;
        const finalDims: DocumentDimensions = { unit: 'mm', width_mm: val, height_mm: doc.dimensions.height_mm };
        if (Math.abs(initial.width_mm - val) > 0.001 || Math.abs(initial.height_mm - doc.dimensions.height_mm) > 0.001) {
          if (onCommitArtboardDimensions) {
            onCommitArtboardDimensions(initial, finalDims);
            return;
          }
        }
      }
      onSetArtboardDimensions?.({ width_mm: val, height_mm: doc.dimensions.height_mm }, false);
    } else {
      setArtboardWidthInput(doc.dimensions.width_mm.toString());
    }
    sessionInitialArtboardRef.current = null;
  };

  const handleArtboardHeightChange = (valStr: string) => {
    setArtboardHeightInput(valStr);
    if (!sessionInitialArtboardRef.current) {
      sessionInitialArtboardRef.current = { ...doc.dimensions };
    }
    const num = parseFloat(valStr);
    if (!isNaN(num) && num >= 10 && num <= 5000) {
      onSetArtboardDimensions?.({ width_mm: doc.dimensions.width_mm, height_mm: num }, true);
    }
  };

  const handleArtboardHeightBlur = () => {
    const val = parseFloat(artboardHeightInput);
    if (!isNaN(val) && val >= 10 && val <= 5000) {
      if (sessionInitialArtboardRef.current) {
        const initial = sessionInitialArtboardRef.current;
        sessionInitialArtboardRef.current = null;
        const finalDims: DocumentDimensions = { unit: 'mm', width_mm: doc.dimensions.width_mm, height_mm: val };
        if (Math.abs(initial.height_mm - val) > 0.001 || Math.abs(initial.width_mm - doc.dimensions.width_mm) > 0.001) {
          if (onCommitArtboardDimensions) {
            onCommitArtboardDimensions(initial, finalDims);
            return;
          }
        }
      }
      onSetArtboardDimensions?.({ width_mm: doc.dimensions.width_mm, height_mm: val }, false);
    } else {
      setArtboardHeightInput(doc.dimensions.height_mm.toString());
    }
    sessionInitialArtboardRef.current = null;
  };

  const handleApplyArtboardPreset = (w: number, h: number) => {
    setArtboardWidthInput(w.toString());
    setArtboardHeightInput(h.toString());
    sessionInitialArtboardRef.current = null;
    onSetArtboardDimensions?.({ width_mm: w, height_mm: h }, false);
  };

  // --- Handlers de Sangria (Bleed) ---
  const handleToggleBleed = () => {
    const prev = doc.productionSettings?.bleed || DEFAULT_PRODUCTION_SETTINGS.bleed;
    const next: BleedSettings = { ...prev, enabled: !prev.enabled };
    if (onCommitBleedSettings) {
      onCommitBleedSettings(prev, next);
    } else {
      onUpdateBleedSettings?.({ enabled: next.enabled }, false);
    }
  };

  const handleToggleBleedLink = () => {
    const prev = doc.productionSettings?.bleed || DEFAULT_PRODUCTION_SETTINGS.bleed;
    const next: BleedSettings = { ...prev, linked: !prev.linked };
    if (next.linked) {
      next.right_mm = next.top_mm;
      next.bottom_mm = next.top_mm;
      next.left_mm = next.top_mm;
    }
    if (onCommitBleedSettings) {
      onCommitBleedSettings(prev, next);
    } else {
      onUpdateBleedSettings?.(next, false);
    }
  };

  const handleBleedUniformChange = (valStr: string) => {
    setBleedUniformInput(valStr);
    setBleedTopInput(valStr);
    setBleedRightInput(valStr);
    setBleedBottomInput(valStr);
    setBleedLeftInput(valStr);

    if (!sessionInitialBleedRef.current) {
      sessionInitialBleedRef.current = { ...(doc.productionSettings?.bleed || DEFAULT_PRODUCTION_SETTINGS.bleed) };
    }

    const num = parseFloat(valStr);
    if (!isNaN(num) && num >= 0 && num <= 100) {
      onUpdateBleedSettings?.({ top_mm: num, right_mm: num, bottom_mm: num, left_mm: num }, true);
    }
  };

  const handleBleedSideChange = (side: 'top_mm' | 'right_mm' | 'bottom_mm' | 'left_mm', valStr: string) => {
    if (side === 'top_mm') setBleedTopInput(valStr);
    if (side === 'right_mm') setBleedRightInput(valStr);
    if (side === 'bottom_mm') setBleedBottomInput(valStr);
    if (side === 'left_mm') setBleedLeftInput(valStr);

    if (!sessionInitialBleedRef.current) {
      sessionInitialBleedRef.current = { ...(doc.productionSettings?.bleed || DEFAULT_PRODUCTION_SETTINGS.bleed) };
    }

    const num = parseFloat(valStr);
    if (!isNaN(num) && num >= 0 && num <= 100) {
      onUpdateBleedSettings?.({ [side]: num }, true);
    }
  };

  const handleBleedCommit = () => {
    const current = doc.productionSettings?.bleed || DEFAULT_PRODUCTION_SETTINGS.bleed;
    if (sessionInitialBleedRef.current) {
      const initial = sessionInitialBleedRef.current;
      sessionInitialBleedRef.current = null;
      if (
        initial.enabled !== current.enabled ||
        initial.linked !== current.linked ||
        Math.abs(initial.top_mm - current.top_mm) > 0.001 ||
        Math.abs(initial.right_mm - current.right_mm) > 0.001 ||
        Math.abs(initial.bottom_mm - current.bottom_mm) > 0.001 ||
        Math.abs(initial.left_mm - current.left_mm) > 0.001
      ) {
        onCommitBleedSettings?.(initial, current);
        return;
      }
    }
    onUpdateBleedSettings?.(current, false);
  };

  const handleApplyBleedPreset = (val: number) => {
    const prev = doc.productionSettings?.bleed || DEFAULT_PRODUCTION_SETTINGS.bleed;
    const next: BleedSettings = {
      ...prev,
      enabled: val > 0 ? true : prev.enabled,
      top_mm: val,
      right_mm: val,
      bottom_mm: val,
      left_mm: val,
    };
    if (onCommitBleedSettings) {
      onCommitBleedSettings(prev, next);
    } else {
      onUpdateBleedSettings?.(next, false);
    }
  };

  // --- Handlers de Margem de Segurança (Safety Margin) ---
  const handleToggleSafety = () => {
    const prev = doc.productionSettings?.safetyMargin || DEFAULT_PRODUCTION_SETTINGS.safetyMargin;
    const next: SafetyMarginSettings = { ...prev, enabled: !prev.enabled };
    if (onCommitSafetyMarginSettings) {
      onCommitSafetyMarginSettings(prev, next);
    } else {
      onUpdateSafetyMarginSettings?.({ enabled: next.enabled }, false);
    }
  };

  const handleToggleSafetyLink = () => {
    const prev = doc.productionSettings?.safetyMargin || DEFAULT_PRODUCTION_SETTINGS.safetyMargin;
    const next: SafetyMarginSettings = { ...prev, linked: !prev.linked };
    if (next.linked) {
      next.right_mm = next.top_mm;
      next.bottom_mm = next.top_mm;
      next.left_mm = next.top_mm;
    }
    if (onCommitSafetyMarginSettings) {
      onCommitSafetyMarginSettings(prev, next);
    } else {
      onUpdateSafetyMarginSettings?.(next, false);
    }
  };

  const handleSafetyUniformChange = (valStr: string) => {
    setSafetyUniformInput(valStr);
    setSafetyTopInput(valStr);
    setSafetyRightInput(valStr);
    setSafetyBottomInput(valStr);
    setSafetyLeftInput(valStr);

    if (!sessionInitialSafetyRef.current) {
      sessionInitialSafetyRef.current = { ...(doc.productionSettings?.safetyMargin || DEFAULT_PRODUCTION_SETTINGS.safetyMargin) };
    }

    const num = parseFloat(valStr);
    if (!isNaN(num) && num >= 0 && num * 2 < doc.dimensions.width_mm && num * 2 < doc.dimensions.height_mm) {
      onUpdateSafetyMarginSettings?.({ top_mm: num, right_mm: num, bottom_mm: num, left_mm: num }, true);
    }
  };

  const handleSafetySideChange = (side: 'top_mm' | 'right_mm' | 'bottom_mm' | 'left_mm', valStr: string) => {
    if (side === 'top_mm') setSafetyTopInput(valStr);
    if (side === 'right_mm') setSafetyRightInput(valStr);
    if (side === 'bottom_mm') setSafetyBottomInput(valStr);
    if (side === 'left_mm') setSafetyLeftInput(valStr);

    if (!sessionInitialSafetyRef.current) {
      sessionInitialSafetyRef.current = { ...(doc.productionSettings?.safetyMargin || DEFAULT_PRODUCTION_SETTINGS.safetyMargin) };
    }

    const num = parseFloat(valStr);
    if (!isNaN(num) && num >= 0) {
      onUpdateSafetyMarginSettings?.({ [side]: num }, true);
    }
  };

  const handleSafetyCommit = () => {
    const current = doc.productionSettings?.safetyMargin || DEFAULT_PRODUCTION_SETTINGS.safetyMargin;
    if (sessionInitialSafetyRef.current) {
      const initial = sessionInitialSafetyRef.current;
      sessionInitialSafetyRef.current = null;
      if (
        initial.enabled !== current.enabled ||
        initial.linked !== current.linked ||
        Math.abs(initial.top_mm - current.top_mm) > 0.001 ||
        Math.abs(initial.right_mm - current.right_mm) > 0.001 ||
        Math.abs(initial.bottom_mm - current.bottom_mm) > 0.001 ||
        Math.abs(initial.left_mm - current.left_mm) > 0.001
      ) {
        onCommitSafetyMarginSettings?.(initial, current);
        return;
      }
    }
    onUpdateSafetyMarginSettings?.(current, false);
  };

  const handleApplySafetyPreset = (val: number) => {
    const prev = doc.productionSettings?.safetyMargin || DEFAULT_PRODUCTION_SETTINGS.safetyMargin;
    const next: SafetyMarginSettings = {
      ...prev,
      enabled: val > 0 ? true : prev.enabled,
      top_mm: val,
      right_mm: val,
      bottom_mm: val,
      left_mm: val,
    };
    if (onCommitSafetyMarginSettings) {
      onCommitSafetyMarginSettings(prev, next);
    } else {
      onUpdateSafetyMarginSettings?.(next, false);
    }
  };

  const handleNameBlur = () => {
    if (!selectedNode) return;
    if (nameInput.trim()) {
      onUpdateName(selectedNode.id, nameInput.trim());
    } else {
      setNameInput(selectedNode.name);
    }
  };

  const handleTriggerVectorize = () => {
    if (!selectedNode || selectedNode.type !== 'raster_image') return;
    onVectorizeNode(selectedNode.id, vectorizePreset);
  };

  const handleCutOffsetChange = (valStr: string) => {
    setCutOffsetInput(valStr);
    const num = parseFloat(valStr);
    if (!isNaN(num) && num >= 0.1 && num <= 50.0) {
      computeAndSetCutPreview({ offset: num });
    }
  };

  const handleApplyCutOffset = (offset: number) => {
    setCutOffsetInput(offset.toString());
    computeAndSetCutPreview({ offset });
  };

  const handleSelectJoinStyle = (style: JoinStyle) => {
    setCutJoinStyle(style);
    computeAndSetCutPreview({ joinStyle: style });
  };

  const handleCutStrokeWidthChange = (valStr: string) => {
    setCutStrokeWidthInput(valStr);
    const num = parseFloat(valStr);
    if (!isNaN(num) && num >= 0.05 && num <= 2.0) {
      computeAndSetCutPreview({ strokeWidth: num });
    }
  };

  const handleApplyCutStrokeWidth = (sw: number) => {
    setCutStrokeWidthInput(sw.toFixed(2));
    computeAndSetCutPreview({ strokeWidth: sw });
  };

  const handleToggleOnlyOuter = (onlyOuter: boolean) => {
    setCutOnlyOuter(onlyOuter);
    computeAndSetCutPreview({ onlyOuter });
  };

  // Handlers para Guia Técnica
  const handleGuideInputFocus = () => {
    if (!guideNode) return;
    if (!sessionInitialGuideRef.current || sessionInitialGuideRef.current.id !== guideNode.id) {
      sessionInitialGuideRef.current = { ...guideNode };
    }
  };

  const handleGuidePositionChange = (valStr: string) => {
    setGuidePositionInput(valStr);
    if (!guideNode) return;
    const num = parseFloat(valStr);
    if (isNaN(num)) return;
    const maxVal = guideNode.orientation === 'vertical' ? doc.dimensions.width_mm : doc.dimensions.height_mm;
    const clamped = Math.max(0, Math.min(maxVal, num));
    onUpdateTechnicalGuide?.(guideNode.id, { guidePosition_mm: clamped }, true);
  };

  const handleGuidePositionBlur = () => {
    if (!guideNode) return;
    const num = parseFloat(guidePositionInput);
    if (!isNaN(num)) {
      const maxVal = guideNode.orientation === 'vertical' ? doc.dimensions.width_mm : doc.dimensions.height_mm;
      const clamped = Math.max(0, Math.min(maxVal, num));
      const nextGuide: TechnicalGuideNode = {
        ...guideNode,
        guidePosition_mm: clamped,
        position_mm: guideNode.orientation === 'vertical' ? { x: clamped, y: 0 } : { x: 0, y: clamped },
      };
      if (sessionInitialGuideRef.current && sessionInitialGuideRef.current.id === guideNode.id) {
        const initial = sessionInitialGuideRef.current;
        sessionInitialGuideRef.current = null;
        if (Math.abs(initial.guidePosition_mm - clamped) > 0.001) {
          onCommitTechnicalGuide?.(guideNode.id, initial, nextGuide);
          return;
        }
      }
      onUpdateTechnicalGuide?.(guideNode.id, { guidePosition_mm: clamped }, false);
    } else {
      setGuidePositionInput(guideNode.guidePosition_mm.toString());
    }
    sessionInitialGuideRef.current = null;
  };

  const handleApplyGuidePositionPreset = (val: number) => {
    if (!guideNode) return;
    const maxVal = guideNode.orientation === 'vertical' ? doc.dimensions.width_mm : doc.dimensions.height_mm;
    const clamped = Math.max(0, Math.min(maxVal, val));
    setGuidePositionInput(clamped.toString());
    const prev = { ...guideNode };
    const next: TechnicalGuideNode = {
      ...guideNode,
      guidePosition_mm: clamped,
      position_mm: guideNode.orientation === 'vertical' ? { x: clamped, y: 0 } : { x: 0, y: clamped },
    };
    if (onCommitTechnicalGuide) {
      onCommitTechnicalGuide(guideNode.id, prev, next);
    } else {
      onUpdateTechnicalGuide?.(guideNode.id, { guidePosition_mm: clamped }, false);
    }
  };

  const handleGuideStrokeWidthChange = (valStr: string) => {
    setGuideStrokeWidthInput(valStr);
    if (!guideNode) return;
    const num = parseFloat(valStr);
    if (!isNaN(num) && num >= 0.05 && num <= 5.0) {
      onUpdateTechnicalGuide?.(guideNode.id, { strokeWidth_mm: num }, true);
    }
  };

  const handleGuideStrokeWidthBlur = () => {
    if (!guideNode) return;
    const num = parseFloat(guideStrokeWidthInput);
    if (!isNaN(num) && num >= 0.05 && num <= 5.0) {
      onUpdateTechnicalGuide?.(guideNode.id, { strokeWidth_mm: num }, false);
    } else {
      setGuideStrokeWidthInput((guideNode.strokeWidth_mm || 0.25).toFixed(2));
    }
  };

  const handleGuideRoleChange = (role: TechnicalGuideRole) => {
    if (!guideNode) return;
    const colors: Record<TechnicalGuideRole, string> = {
      generic: '#06b6d4',
      fold: '#f59e0b',
      crease: '#8b5cf6',
      cut_reference: '#ec4899',
      alignment: '#3b82f6',
    };
    onUpdateTechnicalGuide?.(guideNode.id, { guideRole: role, strokeColor: colors[role] }, false);
  };

  // Cálculo do DPI Efetivo da imagem (apenas para raster)
  const effectiveDpi = rasterNode
    ? calculateEffectiveDpi(rasterNode.naturalWidth, rasterNode.physicalWidth_mm)
    : 0;

  const naturalRatio = rasterNode
    ? rasterNode.naturalWidth / rasterNode.naturalHeight
    : 1;
  const isRatioDistorted = rasterNode
    ? Math.abs(rasterNode.aspectRatio - naturalRatio) > 0.01
    : false;

  return (
    <aside className="w-80 h-full bg-surface-panel border-l border-surface-border flex flex-col select-none">
      {/* Tab Navigation */}
      <div className="h-11 border-b border-surface-border flex items-center px-1.5 gap-1 bg-surface-panel">
        <button
          onClick={() => setActiveTab('objects')}
          className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded text-xs font-medium transition-colors ${
            activeTab === 'objects'
              ? 'bg-surface-subtle text-white border border-surface-border shadow-sm'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Layers className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
          <span className="truncate">Camadas ({doc.rootNodeIds.length})</span>
        </button>
        <button
          onClick={() => setActiveTab('artboard')}
          className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded text-xs font-medium transition-colors ${
            activeTab === 'artboard'
              ? 'bg-surface-subtle text-white border border-surface-border shadow-sm'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Settings2 className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
          <span className="truncate">Prancheta</span>
        </button>
        <button
          onClick={() => setActiveTab('validation')}
          className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded text-xs font-medium transition-colors relative ${
            activeTab === 'validation'
              ? 'bg-surface-subtle text-white border border-surface-border shadow-sm'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <ShieldCheck className={`w-3.5 h-3.5 shrink-0 ${
            activeReport.status === 'blocked'
              ? 'text-rose-400'
              : activeReport.status === 'attention'
              ? 'text-amber-400'
              : 'text-emerald-400'
          }`} />
          <span className="truncate">Validação</span>
          {activeReport.errorCount > 0 ? (
            <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse shrink-0" />
          ) : activeReport.warningCount > 0 ? (
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
          ) : (
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
          )}
        </button>
      </div>

      {/* Tab Content */}
      <div className="flex-1 p-3.5 overflow-y-auto space-y-4">
        {activeTab === 'objects' ? (
          <div className="space-y-4">
            {/* 1. Lista / Árvore de Objetos */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span className="font-semibold text-slate-300">Árvore de Objetos</span>
                <span className="text-[10px] font-mono text-slate-500">
                  {doc.rootNodeIds.length} {doc.rootNodeIds.length === 1 ? 'objeto' : 'objetos'}
                </span>
              </div>

              {doc.rootNodeIds.length === 0 ? (
                <div className="p-4 rounded-lg bg-surface-subtle border border-surface-border text-center space-y-2">
                  <div className="w-8 h-8 mx-auto rounded-md bg-surface-base border border-surface-border flex items-center justify-center text-slate-500">
                    <Box className="w-4 h-4" />
                  </div>
                  <p className="text-xs text-slate-400">Nenhum objeto no documento.</p>
                  <p className="text-[11px] text-slate-500">
                    Use o botão "Importar Arquivo" no topo para carregar uma logo PNG/JPG.
                  </p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {doc.rootNodeIds.map((nodeId) => {
                    const node = doc.nodes[nodeId];
                    if (!node) return null;
                    const isSelected = selectedNodeId === nodeId;
                    const isNodeRaster = node.type === 'raster_image';
                    const isNodeGroup = node.type === 'group';
                    const isNodeCut = node.type === 'cut_contour';
                    const isNodeGuide = node.type === 'technical_guide';

                    return (
                      <div
                        key={node.id}
                        onClick={() => onSelectNode(node.id)}
                        className={`group relative flex items-center justify-between p-2.5 rounded-lg border text-xs cursor-pointer transition-all ${
                          isSelected
                            ? isNodeCut
                              ? 'bg-rose-950/70 border-rose-500 shadow-sm shadow-rose-500/10 ring-1 ring-rose-500/50 text-white'
                              : isNodeGuide
                              ? 'bg-cyan-950/70 border-cyan-500 shadow-sm shadow-cyan-500/10 ring-1 ring-cyan-500/50 text-white'
                              : 'bg-indigo-950/70 border-indigo-500 shadow-sm shadow-indigo-500/10 ring-1 ring-indigo-500/50 text-white'
                            : 'bg-surface-subtle border-surface-border hover:border-slate-600 text-slate-300'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 truncate flex-1 min-w-0">
                          {isNodeRaster ? (
                            <div className="p-1 rounded bg-amber-500/15 border border-amber-500/30 shrink-0">
                              <ImageIcon className="w-3.5 h-3.5 text-amber-400" />
                            </div>
                          ) : isNodeGroup ? (
                            <div className="p-1 rounded bg-emerald-500/15 border border-emerald-500/30 shrink-0">
                              <Shapes className="w-3.5 h-3.5 text-emerald-400" />
                            </div>
                          ) : isNodeCut ? (
                            <div className="p-1 rounded bg-rose-500/15 border border-rose-500/30 shrink-0">
                              <Scissors className="w-3.5 h-3.5 text-rose-400" />
                            </div>
                          ) : isNodeGuide ? (
                            <div className="p-1 rounded bg-cyan-500/15 border border-cyan-500/30 shrink-0">
                              <Compass className="w-3.5 h-3.5 text-cyan-400" />
                            </div>
                          ) : (
                            <div className="p-1 rounded bg-indigo-500/15 border border-indigo-500/30 shrink-0">
                              <Box className="w-3.5 h-3.5 text-indigo-400" />
                            </div>
                          )}
                          <div className="flex flex-col truncate min-w-0">
                            <div className="flex items-center gap-1.5 truncate">
                              <span className="truncate font-semibold text-slate-100">{node.name}</span>
                              {isSelected && (
                                <span className={`text-[9px] font-mono px-1 py-0.2 text-white rounded font-bold uppercase tracking-wider shrink-0 ${
                                  isNodeCut ? 'bg-rose-500' : isNodeGuide ? 'bg-cyan-500' : 'bg-indigo-500'
                                }`}>
                                  Ativo
                                </span>
                              )}
                            </div>
                            <span className="text-[10px] text-slate-400 font-mono">
                              {isNodeRaster
                                ? 'Imagem Raster (PNG/JPG)'
                                : isNodeGroup
                                ? `Grupo Vetorial (${(node as VectorGroupNode).childrenIds.length} paths)`
                                : isNodeCut
                                ? `Faca de Corte (+${(node as CutContourNode).offset_mm} mm)`
                                : isNodeGuide
                                ? `Guia ${(node as TechnicalGuideNode).orientation === 'vertical' ? 'Vertical' : 'Horizontal'} (${(node as TechnicalGuideNode).guidePosition_mm.toFixed(1)} mm)`
                                : 'Nó Genérico'}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-1 shrink-0 ml-2" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={() => onToggleVisibility(node.id)}
                            title={node.visible ? 'Ocultar' : 'Exibir'}
                            className="p-1 rounded hover:bg-surface-hover text-slate-400 hover:text-slate-200"
                          >
                            {node.visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5 text-amber-400" />}
                          </button>
                          <button
                            onClick={() => onToggleLock(node.id)}
                            title={node.locked ? 'Destravar' : 'Travar'}
                            className="p-1 rounded hover:bg-surface-hover text-slate-400 hover:text-slate-200"
                          >
                            {node.locked ? <Lock className="w-3.5 h-3.5 text-amber-400" /> : <Unlock className="w-3.5 h-3.5" />}
                          </button>
                          <button
                            onClick={() => onDeleteNode(node.id)}
                            title="Remover objeto"
                            className="p-1 rounded hover:bg-red-500/20 text-slate-400 hover:text-red-400"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* 2. Ferramenta de Comparação Visual (Raster vs Vetor) */}
            {hasRaster && hasVector && (
              <div className="p-3 rounded-lg bg-surface-subtle border border-surface-border space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
                    <SplitSquareVertical className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Comparação Visual</span>
                  </div>
                  <span className="text-[10px] font-mono text-indigo-300">Auditoria</span>
                </div>

                {/* Modos de Comparação */}
                <div className="grid grid-cols-4 gap-1 p-0.5 bg-surface-base rounded-md border border-surface-border text-[10px]">
                  <button
                    onClick={() => onSetComparisonMode('default')}
                    className={`py-1 rounded text-center font-medium transition-colors ${
                      comparisonMode === 'default'
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Padrão
                  </button>
                  <button
                    onClick={() => onSetComparisonMode('overlay')}
                    className={`py-1 rounded text-center font-medium transition-colors ${
                      comparisonMode === 'overlay'
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Sobrepor
                  </button>
                  <button
                    onClick={() => onSetComparisonMode('vector_only')}
                    className={`py-1 rounded text-center font-medium transition-colors ${
                      comparisonMode === 'vector_only'
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Vetor
                  </button>
                  <button
                    onClick={() => onSetComparisonMode('raster_only')}
                    className={`py-1 rounded text-center font-medium transition-colors ${
                      comparisonMode === 'raster_only'
                        ? 'bg-indigo-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Raster
                  </button>
                </div>

                {/* Slider de Opacidade de Sobreposição */}
                {comparisonMode === 'overlay' && (
                  <div className="pt-1.5 space-y-1 border-t border-surface-border/50">
                    <div className="flex justify-between text-[10px] text-slate-400">
                      <span>Opacidade do Vetor</span>
                      <span className="font-mono text-indigo-300">{Math.round(overlayOpacity * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min="0.1"
                      max="1.0"
                      step="0.05"
                      value={overlayOpacity}
                      onChange={(e) => onSetOverlayOpacity(parseFloat(e.target.value))}
                      className="w-full accent-indigo-500 h-1.5 bg-surface-base rounded-lg cursor-pointer"
                    />
                  </div>
                )}
              </div>
            )}

            {/* 3. Painel de Vetorização (Exibido quando RasterNode selecionado) */}
            {isRaster && rasterNode && (
              <div className="p-3.5 rounded-lg bg-gradient-to-br from-indigo-950/40 via-surface-subtle to-surface-subtle border border-indigo-500/30 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-indigo-400" />
                    <span className="text-xs font-semibold text-white">Vetorização VTracer</span>
                  </div>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 font-mono">
                    Presets Gráficos
                  </span>
                </div>

                <p className="text-[11px] text-slate-400 leading-snug">
                  Converte esta imagem em caminhos vetoriais puros no PDM com curvas Bézier calibradas para produção.
                </p>

                {/* Seletor de Presets Calibrados */}
                <div className="space-y-1.5">
                  <label className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider block">
                    Preset de Vetorização
                  </label>
                  <div className="grid grid-cols-3 gap-1.5">
                    {(['logo', 'detailed', 'simple'] as VectorizePresetId[]).map((pid) => {
                      const p = VECTORIZE_PRESETS[pid];
                      const isPSelected = vectorizePreset === pid;
                      return (
                        <button
                          key={pid}
                          onClick={() => onSelectPreset(pid)}
                          disabled={isVectorizing}
                          className={`p-1.5 rounded-lg border text-left transition-all ${
                            isPSelected
                              ? 'bg-indigo-600/30 border-indigo-500 text-white shadow-sm'
                              : 'bg-surface-base border-surface-border text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          <div className="text-[11px] font-semibold truncate">{p.name.split('/')[0].trim()}</div>
                          <div className="text-[9px] text-slate-500 truncate">
                            {pid === 'logo' ? 'Curvas Limpas' : pid === 'detailed' ? 'Fidelidade Alta' : 'Poucos Paths'}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-[10px] text-indigo-300/80 bg-surface-base/60 p-1.5 rounded border border-surface-border/50">
                    {VECTORIZE_PRESETS[vectorizePreset]?.description}
                  </p>
                </div>

                {/* Botão de Ação de Vetorização */}
                <button
                  onClick={handleTriggerVectorize}
                  disabled={isVectorizing}
                  className="w-full flex items-center justify-center gap-2 py-2 px-3 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-900/50 text-white text-xs font-semibold rounded-lg transition-all shadow-md shadow-indigo-600/20 active:scale-[0.98] disabled:cursor-not-allowed"
                >
                  {isVectorizing ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin text-white" />
                      <span>Vetorizando com VTracer...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4 text-indigo-200" />
                      <span>Vetorizar Imagem / Logo</span>
                    </>
                  )}
                </button>
              </div>
            )}

            {/* 4. Painel de Propriedades Físicas (Raster, Vetor ou Faca) */}
            {selectedNode && (isRaster || isVectorGroup || isCutContour) && (
              <div className="space-y-3.5 pt-2 border-t border-surface-border">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-200">Propriedades Físicas</span>
                  <span
                    className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
                      isRaster
                        ? 'bg-amber-500/10 text-amber-300 border-amber-500/20'
                        : isVectorGroup
                        ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20'
                        : 'bg-rose-500/10 text-rose-300 border-rose-500/20'
                    }`}
                  >
                    {isRaster ? 'Raster Image' : isVectorGroup ? 'Grupo Vetorial' : 'Faca de Corte'}
                  </span>
                </div>

                {/* Nome do Objeto */}
                <div className="space-y-1">
                  <label className="text-[11px] text-slate-400 block">Nome do Objeto</label>
                  <input
                    type="text"
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                    onBlur={handleNameBlur}
                    onKeyDown={(e) => e.key === 'Enter' && handleNameBlur()}
                    className="w-full bg-surface-base border border-surface-border rounded px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500 font-medium"
                  />
                </div>

                {/* Dimensões Físicas (Largura x Altura em mm) */}
                <div className="p-3 rounded-lg bg-surface-subtle border border-surface-border space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-slate-300">Tamanho em Milímetros</span>
                    <button
                      onClick={onToggleKeepAspectRatio}
                      title={keepAspectRatio ? 'Proporção travada' : 'Proporção livre'}
                      className={`flex items-center gap-1 text-[11px] px-2 py-0.5 rounded border transition-colors ${
                        keepAspectRatio
                          ? 'bg-indigo-500/20 border-indigo-500/40 text-indigo-300'
                          : 'bg-surface-base border-surface-border text-slate-400'
                      }`}
                    >
                      {keepAspectRatio ? <Link className="w-3 h-3" /> : <Unlink className="w-3 h-3" />}
                      <span>{keepAspectRatio ? 'Proporcional' : 'Livre'}</span>
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label className="text-[10px] text-slate-400 flex items-center justify-between">
                        <span className="font-semibold text-indigo-300">Largura (W)</span>
                        <span className="text-slate-500 font-mono">mm</span>
                      </label>
                      <input
                        type="number"
                        step="0.5"
                        min="0.5"
                        value={widthInput}
                        onFocus={handleInputFocus}
                        onChange={(e) => handleWidthChange(e.target.value)}
                        onBlur={handleWidthBlur}
                        onKeyDown={(e) => e.key === 'Enter' && handleWidthBlur()}
                        className="w-full bg-surface-base border border-surface-border rounded px-2 py-1 text-xs font-mono text-white focus:outline-none focus:border-indigo-500 text-right font-medium"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] text-slate-400 flex items-center justify-between">
                        <span className="font-semibold text-indigo-300">Altura (H)</span>
                        <span className="text-slate-500 font-mono">mm</span>
                      </label>
                      <input
                        type="number"
                        step="0.5"
                        min="0.5"
                        value={heightInput}
                        onFocus={handleInputFocus}
                        onChange={(e) => handleHeightChange(e.target.value)}
                        onBlur={handleHeightBlur}
                        onKeyDown={(e) => e.key === 'Enter' && handleHeightBlur()}
                        className="w-full bg-surface-base border border-surface-border rounded px-2 py-1 text-xs font-mono text-white focus:outline-none focus:border-indigo-500 text-right font-medium"
                      />
                    </div>
                  </div>

                  {/* Atalhos Rápidos */}
                  <div className="pt-1.5 space-y-1.5 border-t border-surface-border/50 text-[10px]">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400 font-medium">Largura rápida (W):</span>
                      <div className="flex items-center gap-1 font-mono">
                        <button
                          onClick={() => onUpdateWidth(selectedNode.id, 50, false)}
                          className="px-1.5 py-0.5 rounded bg-surface-base hover:bg-surface-hover border border-surface-border text-slate-300 hover:text-white"
                        >
                          50 mm
                        </button>
                        <button
                          onClick={() => onUpdateWidth(selectedNode.id, 70, false)}
                          className="px-1.5 py-0.5 rounded bg-surface-base hover:bg-surface-hover border border-surface-border text-slate-300 hover:text-white"
                        >
                          70 mm
                        </button>
                        <button
                          onClick={() => onUpdateWidth(selectedNode.id, 85, false)}
                          className="px-1.5 py-0.5 rounded bg-surface-base hover:bg-surface-hover border border-surface-border text-slate-300 hover:text-white"
                        >
                          85 mm
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="text-slate-400 font-medium">Altura rápida (H):</span>
                      <div className="flex items-center gap-1 font-mono">
                        <button
                          onClick={() => onUpdateHeight(selectedNode.id, 30, false)}
                          className="px-1.5 py-0.5 rounded bg-surface-base hover:bg-surface-hover border border-surface-border text-slate-300 hover:text-white"
                        >
                          30 mm
                        </button>
                        <button
                          onClick={() => onUpdateHeight(selectedNode.id, 40, false)}
                          className="px-1.5 py-0.5 rounded bg-surface-base hover:bg-surface-hover border border-surface-border text-slate-300 hover:text-white"
                        >
                          40 mm
                        </button>
                        <button
                          onClick={() => onUpdateHeight(selectedNode.id, 50, false)}
                          className="px-1.5 py-0.5 rounded bg-surface-base hover:bg-surface-hover border border-surface-border text-slate-300 hover:text-white"
                        >
                          50 mm
                        </button>
                      </div>
                    </div>

                    {isRaster && isRatioDistorted && (
                      <div className="pt-1 flex justify-end">
                        <button
                          onClick={() => onResetAspectRatio(selectedNode.id)}
                          className="flex items-center gap-1 px-2 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20 hover:bg-amber-500/20 transition-colors text-[10px]"
                        >
                          <RotateCcw className="w-3 h-3" />
                          <span>Restaurar Proporção ({roundPrecision(naturalRatio, 2)}:1)</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Posição Física na Prancheta */}
                <div className="p-3 rounded-lg bg-surface-subtle border border-surface-border space-y-2">
                  <span className="text-[11px] font-semibold text-slate-300 block">Posição na Prancheta (mm)</span>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <label className="text-[10px] text-slate-400 flex items-center justify-between">
                        <span>Posição X</span>
                        <span className="text-slate-500 font-mono">mm</span>
                      </label>
                      <input
                        type="number"
                        step="1"
                        value={posXInput}
                        onFocus={handleInputFocus}
                        onChange={(e) => handlePosXChange(e.target.value)}
                        onBlur={handlePosXBlur}
                        onKeyDown={(e) => e.key === 'Enter' && handlePosXBlur()}
                        className="w-full bg-surface-base border border-surface-border rounded px-2 py-1 text-xs font-mono text-white focus:outline-none focus:border-indigo-500 text-right"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] text-slate-400 flex items-center justify-between">
                        <span>Posição Y</span>
                        <span className="text-slate-500 font-mono">mm</span>
                      </label>
                      <input
                        type="number"
                        step="1"
                        value={posYInput}
                        onFocus={handleInputFocus}
                        onChange={(e) => handlePosYChange(e.target.value)}
                        onBlur={handlePosYBlur}
                        onKeyDown={(e) => e.key === 'Enter' && handlePosYBlur()}
                        className="w-full bg-surface-base border border-surface-border rounded px-2 py-1 text-xs font-mono text-white focus:outline-none focus:border-indigo-500 text-right"
                      />
                    </div>
                  </div>
                </div>

                {/* Metadados Técnicos Específicos */}
                {isRaster && rasterNode && (
                  <div className="p-3 rounded-lg bg-surface-subtle border border-surface-border text-[11px] text-slate-400 space-y-1.5">
                    <span className="font-semibold text-slate-300 block mb-1">Telemetria de Resolução</span>
                    <div className="flex justify-between py-0.5">
                      <span>Pixels Nativos:</span>
                      <span className="font-mono text-slate-200">
                        {rasterNode.naturalWidth} × {rasterNode.naturalHeight} px
                      </span>
                    </div>
                    <div className="flex justify-between py-0.5">
                      <span>DPI Efetivo:</span>
                      <span
                        className={`font-mono font-medium ${
                          effectiveDpi >= 300
                            ? 'text-emerald-400'
                            : effectiveDpi >= 150
                            ? 'text-amber-400'
                            : 'text-red-400'
                        }`}
                      >
                        {effectiveDpi} DPI {effectiveDpi >= 300 ? '(Ótimo)' : effectiveDpi >= 150 ? '(Médio)' : '(Baixo)'}
                      </span>
                    </div>
                  </div>
                )}

                {isVectorGroup && groupNode && (() => {
                  const complexityReport = analyzeVectorComplexity({
                    pathCount: groupNode.childrenIds.length,
                    totalSegments: groupNode.metadata?.totalSegments,
                  });

                  return (
                    <div className="space-y-2">
                      <div className="p-3 rounded-lg bg-surface-subtle border border-surface-border text-[11px] text-slate-400 space-y-1.5">
                        <div className="flex items-center justify-between font-semibold mb-1">
                          <div className="flex items-center gap-1.5 text-emerald-400">
                            <FolderTree className="w-3.5 h-3.5" />
                            <span>Métricas de Geometria Vetorial</span>
                          </div>
                          <span
                            className={`text-[9px] font-mono px-1.5 py-0.5 rounded uppercase font-bold tracking-wider ${
                              complexityReport.level === 'simple'
                                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                                : complexityReport.level === 'moderate'
                                ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                                : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                            }`}
                          >
                            {complexityReport.badgeLabel}
                          </span>
                        </div>
                        <div className="flex justify-between py-0.5">
                          <span>Total de Caminhos:</span>
                          <span className="font-mono text-emerald-300 font-semibold">
                            {groupNode.childrenIds.length} paths
                          </span>
                        </div>
                        <div className="flex justify-between py-0.5">
                          <span>Comandos / Nós Bézier:</span>
                          <span className="font-mono text-slate-200">
                            {groupNode.metadata?.totalSegments ?? '--'} segmentos
                          </span>
                        </div>
                        <div className="flex justify-between py-0.5">
                          <span>Tempo de Vetorização:</span>
                          <span className="font-mono text-slate-200">
                            {groupNode.metadata?.vectorizationTimeMs ?? '--'} ms
                          </span>
                        </div>
                        <div className="flex justify-between py-0.5">
                          <span>Preset Utilizado:</span>
                          <span className="font-mono text-indigo-300 capitalize">
                            {groupNode.metadata?.preset ?? 'logo'}
                          </span>
                        </div>
                        <div className="flex justify-between py-0.5">
                          <span>ViewBox Nativo:</span>
                          <span className="font-mono text-slate-200">
                            {groupNode.sourceViewBox.width} × {groupNode.sourceViewBox.height} px
                          </span>
                        </div>
                        <div className="flex justify-between py-0.5">
                          <span>Dimensões Físicas:</span>
                          <span className="font-mono text-slate-200">
                            {groupNode.physicalWidth_mm} × {groupNode.physicalHeight_mm} mm
                          </span>
                        </div>
                      </div>

                      {/* Card de Diagnóstico de Complexidade / Aviso Não-Bloqueante */}
                      {complexityReport.isHighComplexity && (
                        <div className="p-3 rounded-lg bg-amber-950/30 border border-amber-500/40 text-xs space-y-1.5">
                          <div className="flex items-center gap-1.5 text-amber-400 font-semibold">
                            <AlertTriangle className="w-4 h-4 shrink-0" />
                            <span>Vetorização de Alta Densidade</span>
                          </div>
                          <p className="text-[11px] text-amber-200/90 leading-relaxed">
                            {complexityReport.warningMessage}
                          </p>
                          <p className="text-[10px] text-amber-400/80 leading-snug pt-1 border-t border-amber-500/20">
                            💡 {complexityReport.recommendation}
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Painel de Faca / Contorno de Corte (Exibido para VectorGroupNode) */}
                {isVectorGroup && groupNode && (
                  <div className="p-3.5 rounded-lg bg-gradient-to-br from-rose-950/40 via-surface-subtle to-surface-subtle border border-rose-500/30 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Scissors className="w-4 h-4 text-rose-400" />
                        <span className="text-xs font-semibold text-white">Faca / Contorno de Corte</span>
                      </div>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 font-mono">
                        Clipper2 Boolean
                      </span>
                    </div>

                    <p className="text-[11px] text-slate-400 leading-snug">
                      Gera contorno externo com offset milimétrico real (sangria técnica/faca de corte) preservando curvas e cantos.
                    </p>

                    {/* Offset Input + Cantos */}
                    <div className="space-y-2">
                      <div className="space-y-1">
                        <div className="flex justify-between text-[10px] text-slate-400">
                          <span className="font-semibold text-rose-300">Distância do Offset (mm)</span>
                          <span className="font-mono text-slate-500">0.10 a 50.00 mm</span>
                        </div>
                        <input
                          type="number"
                          step="0.5"
                          min="0.1"
                          max="50"
                          value={cutOffsetInput}
                          onChange={(e) => setCutOffsetInput(e.target.value)}
                          className="w-full bg-surface-base border border-surface-border rounded px-2.5 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-rose-500 text-right font-medium"
                        />
                      </div>

                      {/* Botões Rápidos */}
                      <div className="flex items-center justify-between text-[10px]">
                        <span className="text-slate-400">Offset rápido:</span>
                        <div className="flex items-center gap-1 font-mono">
                          {[1.0, 1.5, 2.0, 3.0, 5.0].map((val) => (
                            <button
                              key={val}
                              onClick={() => setCutOffsetInput(val.toFixed(1))}
                              className={`px-1.5 py-0.5 rounded border transition-colors ${
                                parseFloat(cutOffsetInput) === val
                                  ? 'bg-rose-500/20 border-rose-500/40 text-rose-300 font-semibold'
                                  : 'bg-surface-base hover:bg-surface-hover border-surface-border text-slate-300 hover:text-white'
                              }`}
                            >
                              {val} mm
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Opção Somente Contorno Externo */}
                      <div className="pt-1">
                        <label className="flex items-center gap-2 p-1.5 rounded bg-surface-base/80 border border-surface-border cursor-pointer hover:border-slate-500 transition-colors">
                          <input
                            type="checkbox"
                            checked={cutOnlyOuter}
                            onChange={(e) => setCutOnlyOuter(e.target.checked)}
                            className="w-3.5 h-3.5 accent-rose-500 rounded cursor-pointer"
                          />
                          <span className="text-[11px] text-slate-200 font-medium">
                            Somente contorno externo
                          </span>
                        </label>
                      </div>

                      {/* Estilo de Canto / Join Style */}
                      <div className="space-y-1">
                        <label className="text-[10px] text-slate-400 block font-medium">Estilo dos Cantos</label>
                        <div className="grid grid-cols-3 gap-1 text-[10px]">
                          {(['round', 'miter', 'bevel'] as JoinStyle[]).map((style) => (
                            <button
                              key={style}
                              onClick={() => setCutJoinStyle(style)}
                              className={`py-1 rounded border text-center font-medium capitalize transition-colors ${
                                cutJoinStyle === style
                                  ? 'bg-rose-600 border-rose-500 text-white shadow-sm'
                                  : 'bg-surface-base hover:bg-surface-hover border-surface-border text-slate-400 hover:text-slate-200'
                              }`}
                            >
                              {style === 'round' ? 'Arredondado' : style === 'miter' ? 'Pontiagudo' : 'Chanfrado'}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Ações: Criar ou Recalcular */}
                      {attachedCutContour ? (
                        <div className="pt-2 space-y-2 border-t border-rose-500/20">
                          <div className="flex items-center justify-between text-[11px] text-rose-300 bg-rose-950/40 p-2 rounded border border-rose-500/30">
                            <span>Faca vinculada:</span>
                            <span className="font-mono font-bold">+{attachedCutContour.offset_mm} mm ({attachedCutContour.joinStyle})</span>
                          </div>
                          <div className="grid grid-cols-2 gap-1.5">
                            <button
                              onClick={() => {
                                const num = parseFloat(cutOffsetInput) || 2.0;
                                onUpdateCutContour(attachedCutContour.id, {
                                  offset_mm: num,
                                  joinStyle: cutJoinStyle,
                                  includeInnerContours: !cutOnlyOuter,
                                });
                              }}
                              className="w-full flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md bg-rose-600 hover:bg-rose-500 text-white font-medium text-xs transition-colors shadow-sm"
                            >
                              <Scissors className="w-3.5 h-3.5" />
                              <span>Recalcular</span>
                            </button>
                            <button
                              onClick={() => onSelectNode(attachedCutContour.id)}
                              className="w-full flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md bg-surface-base hover:bg-surface-hover border border-surface-border text-slate-200 text-xs transition-colors"
                            >
                              <span>Ver Faca</span>
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="pt-2">
                          <button
                            onClick={() => {
                              const num = parseFloat(cutOffsetInput) || 2.0;
                              onCreateCutContour(
                                groupNode.id,
                                num,
                                cutJoinStyle,
                                !cutOnlyOuter,
                                parseFloat(cutStrokeWidthInput) || 0.30
                              );
                            }}
                            className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-md bg-rose-600 hover:bg-rose-500 text-white font-medium text-xs transition-colors shadow-sm shadow-rose-600/20"
                          >
                            <Scissors className="w-4 h-4" />
                            <span>Gerar Contorno de Corte (Faca)</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* 5. Painel de Propriedades da Faca de Corte */}
                {isCutContour && cutContourNode && (
                  <div className="space-y-3">
                    <div className="p-3.5 rounded-lg bg-gradient-to-br from-rose-950/40 via-surface-subtle to-surface-subtle border border-rose-500/30 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Scissors className="w-4 h-4 text-rose-400" />
                          <span className="text-xs font-semibold text-white">Parâmetros da Faca</span>
                        </div>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 font-mono font-bold">
                          Spot Magenta
                        </span>
                      </div>

                      {/* Indicador de Alterações Não Aplicadas / Preview Ativo */}
                      {isCutDirty && (
                        <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded bg-amber-500/15 border border-amber-500/30 text-amber-300 text-[11px] font-medium">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-400" />
                          <span>Alterações não aplicadas (Preview ativo)</span>
                        </div>
                      )}

                      {/* Distância do Offset */}
                      <div className="space-y-1.5">
                        <div className="flex justify-between text-[10px] text-slate-400">
                          <span className="font-semibold text-rose-300">Offset Físico (Distância)</span>
                          <span className="font-mono text-slate-500">mm</span>
                        </div>
                        <div className="flex gap-1.5">
                          <input
                            type="number"
                            step="0.5"
                            min="0.1"
                            max="50"
                            value={cutOffsetInput}
                            onChange={(e) => handleCutOffsetChange(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleApplyCutChanges()}
                            className="flex-1 bg-surface-base border border-surface-border rounded px-2.5 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-rose-500 text-right font-medium"
                          />
                        </div>

                        {/* Atalhos Rápidos Offset */}
                        <div className="flex items-center justify-between text-[10px] pt-1">
                          <span className="text-slate-400">Offset rápido:</span>
                          <div className="flex items-center gap-1 font-mono">
                            {[1.0, 1.5, 2.0, 3.0, 5.0].map((val) => (
                              <button
                                key={val}
                                onClick={() => handleApplyCutOffset(val)}
                                className={`px-1.5 py-0.5 rounded border transition-colors ${
                                  (parseFloat(cutOffsetInput) || cutContourNode.offset_mm) === val
                                    ? 'bg-rose-500/20 border-rose-500/40 text-rose-300 font-semibold'
                                    : 'bg-surface-base hover:bg-surface-hover border-surface-border text-slate-300 hover:text-white'
                                }`}
                              >
                                {val} mm
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>

                      {/* Espessura do Traço Técnico */}
                      <div className="space-y-1.5 pt-2 border-t border-surface-border/50">
                        <div className="flex justify-between text-[10px] text-slate-400">
                          <span className="font-semibold text-rose-300">Espessura do Traço</span>
                          <span className="font-mono text-slate-500">0.05 a 2.00 mm</span>
                        </div>
                        <div className="flex gap-1.5">
                          <input
                            type="number"
                            step="0.05"
                            min="0.05"
                            max="2.00"
                            value={cutStrokeWidthInput}
                            onChange={(e) => handleCutStrokeWidthChange(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleApplyCutChanges()}
                            className="flex-1 bg-surface-base border border-surface-border rounded px-2.5 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-rose-500 text-right font-medium"
                          />
                        </div>

                        {/* Atalhos Rápidos Espessura */}
                        <div className="flex items-center justify-between text-[10px] pt-1">
                          <span className="text-slate-400">Traço rápido:</span>
                          <div className="flex items-center gap-1 font-mono">
                            {[0.10, 0.20, 0.30, 0.50, 1.00].map((val) => (
                              <button
                                key={val}
                                onClick={() => handleApplyCutStrokeWidth(val)}
                                className={`px-1.5 py-0.5 rounded border transition-colors ${
                                  (parseFloat(cutStrokeWidthInput) || cutContourNode.strokeWidth_mm || 0.30) === val
                                    ? 'bg-rose-500/20 border-rose-500/40 text-rose-300 font-semibold'
                                    : 'bg-surface-base hover:bg-surface-hover border-surface-border text-slate-300 hover:text-white'
                                }`}
                              >
                                {val.toFixed(2)} mm
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>

                      {/* Opção de Contornos */}
                      <div className="pt-2 border-t border-surface-border/50 space-y-1">
                        <label className="text-[10px] text-slate-400 block font-medium">Contornos</label>
                        <label className="flex items-center gap-2 p-1.5 rounded bg-surface-base/80 border border-surface-border cursor-pointer hover:border-slate-500 transition-colors">
                          <input
                            type="checkbox"
                            checked={cutOnlyOuter}
                            onChange={(e) => handleToggleOnlyOuter(e.target.checked)}
                            className="w-3.5 h-3.5 accent-rose-500 rounded cursor-pointer"
                          />
                          <span className="text-[11px] text-slate-200 font-medium">
                            Somente contorno externo
                          </span>
                        </label>
                      </div>

                      {/* Estilo dos Cantos */}
                      <div className="space-y-1 pt-2 border-t border-surface-border/50">
                        <label className="text-[10px] text-slate-400 block font-medium">Estilo dos Cantos</label>
                        <div className="grid grid-cols-3 gap-1 text-[10px]">
                          {(['round', 'miter', 'bevel'] as JoinStyle[]).map((style) => (
                            <button
                              key={style}
                              onClick={() => handleSelectJoinStyle(style)}
                              className={`py-1 rounded border text-center font-medium capitalize transition-colors ${
                                cutJoinStyle === style
                                  ? 'bg-rose-600 border-rose-500 text-white shadow-sm'
                                  : 'bg-surface-base hover:bg-surface-hover border-surface-border text-slate-400 hover:text-slate-200'
                              }`}
                            >
                              {style === 'round' ? 'Arredondado' : style === 'miter' ? 'Pontiagudo' : 'Chanfrado'}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Barra de Ação: Cancelar e Aplicar */}
                      <div className="pt-2.5 flex gap-2 border-t border-surface-border/50">
                        <button
                          onClick={handleCancelCutPreview}
                          disabled={!isCutDirty}
                          className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md text-xs font-medium transition-colors ${
                            isCutDirty
                              ? 'bg-surface-base hover:bg-surface-hover border border-surface-border text-slate-200 shadow-sm cursor-pointer'
                              : 'bg-surface-base/40 border border-surface-border/30 text-slate-500 cursor-not-allowed'
                          }`}
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>Cancelar</span>
                        </button>
                        <button
                          onClick={handleApplyCutChanges}
                          disabled={!isCutDirty}
                          className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md text-xs font-semibold transition-all shadow-sm ${
                            isCutDirty
                              ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-600/25 ring-1 ring-emerald-400 cursor-pointer'
                              : 'bg-surface-base/40 border border-surface-border/30 text-slate-500 cursor-not-allowed'
                          }`}
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span>Aplicar</span>
                        </button>
                      </div>
                    </div>

                    {/* Métricas e Telemetria da Faca */}
                    <div className="p-3 rounded-lg bg-surface-subtle border border-surface-border text-[11px] text-slate-400 space-y-1.5">
                      <div className="flex items-center justify-between font-semibold mb-1 text-rose-300">
                        <div className="flex items-center gap-1.5">
                          <FolderTree className="w-3.5 h-3.5" />
                          <span>Especificação Técnica de Corte</span>
                        </div>
                        <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/30 uppercase font-bold">
                          Faca 1:1
                        </span>
                      </div>

                      <div className="flex justify-between py-0.5">
                        <span>Polígonos / Ilhas de Corte:</span>
                        <span className="font-mono text-rose-300 font-semibold">
                          {cutContourNode.contours.length} {cutContourNode.contours.length === 1 ? 'polígono' : 'polígonos'}
                        </span>
                      </div>

                      <div className="flex justify-between py-0.5">
                        <span>Vértices Totais (Clipper):</span>
                        <span className="font-mono text-slate-200">
                          {cutContourNode.contours.reduce((acc, c) => acc + c.points_mm.length, 0)} pontos
                        </span>
                      </div>

                      <div className="flex justify-between py-0.5">
                        <span>Cor Técnica (Spot Color):</span>
                        <span className="font-mono text-rose-400 font-semibold">
                          {cutContourNode.strokeColor} (100% Magenta)
                        </span>
                      </div>

                      <div className="flex justify-between py-0.5">
                        <span>Espessura Técnica de Traço:</span>
                        <span className="font-mono text-slate-200">
                          {(cutContourNode.strokeWidth_mm || 0.30).toFixed(2)} mm
                        </span>
                      </div>

                      <div className="flex justify-between py-0.5">
                        <span>Vetor de Origem:</span>
                        <span className="font-mono text-indigo-300">
                          {doc.nodes[cutContourNode.sourceNodeId]?.name || cutContourNode.sourceNodeId}
                        </span>
                      </div>

                      <div className="pt-2 space-y-1.5">
                        <button
                          onClick={() => onCenterCutContour?.(cutContourNode.id)}
                          className="w-full flex items-center justify-center gap-1.5 py-1.5 px-2 rounded bg-rose-600/20 hover:bg-rose-600/30 border border-rose-500/40 text-rose-200 text-xs font-medium transition-colors cursor-pointer"
                          title="Centraliza a faca no centro físico do vetor de origem"
                        >
                          <Crosshair className="w-3.5 h-3.5 text-rose-400" />
                          <span>Centralizar na imagem</span>
                        </button>
                        <div className="flex gap-2">
                          <button
                            onClick={() => onSelectNode(cutContourNode.sourceNodeId)}
                            className="flex-1 py-1 px-2 rounded bg-surface-base hover:bg-surface-hover border border-surface-border text-slate-200 text-xs transition-colors text-center"
                          >
                            Ir para Vetor de Origem
                          </button>
                          <button
                            onClick={() => onDeleteCutContour(cutContourNode.id)}
                            className="py-1 px-2 rounded bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-300 text-xs transition-colors"
                          >
                            Excluir Faca
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 5. Painel de Guia Técnica (Exibido quando TechnicalGuideNode selecionado) */}
            {selectedNode && isTechnicalGuide && guideNode && (
              <div className="space-y-3.5 pt-2 border-t border-surface-border">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5">
                    <Compass className="w-4 h-4 text-cyan-400" />
                    <span className="font-semibold text-slate-200">Guia Técnica</span>
                  </div>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border bg-cyan-500/10 text-cyan-300 border-cyan-500/20 capitalize">
                    {guideNode.guideRole === 'fold'
                      ? 'Dobra'
                      : guideNode.guideRole === 'crease'
                      ? 'Vinco'
                      : guideNode.guideRole === 'cut_reference'
                      ? 'Corte'
                      : guideNode.guideRole === 'alignment'
                      ? 'Alinhamento'
                      : 'Geral'}
                  </span>
                </div>

                {/* Nome da Guia */}
                <div className="space-y-1">
                  <label className="text-[11px] text-slate-400 block">Nome da Guia</label>
                  <input
                    type="text"
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                    onBlur={handleNameBlur}
                    onKeyDown={(e) => e.key === 'Enter' && handleNameBlur()}
                    className="w-full bg-surface-base border border-surface-border rounded px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-500 font-medium"
                  />
                </div>

                {/* Orientação da Guia (Vertical vs Horizontal) */}
                <div className="p-3 rounded-lg bg-surface-subtle border border-surface-border space-y-2">
                  <span className="text-[11px] font-semibold text-slate-300 block">Orientação</span>
                  <div className="grid grid-cols-2 gap-1.5 text-xs">
                    <button
                      onClick={() => onChangeTechnicalGuideOrientation?.(guideNode.id, 'vertical')}
                      className={`py-1.5 px-2 rounded border text-center font-medium transition-colors ${
                        guideNode.orientation === 'vertical'
                          ? 'bg-cyan-600/30 border-cyan-500 text-cyan-200 font-semibold shadow-sm'
                          : 'bg-surface-base hover:bg-surface-hover border-surface-border text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      Vertical (Eixo X)
                    </button>
                    <button
                      onClick={() => onChangeTechnicalGuideOrientation?.(guideNode.id, 'horizontal')}
                      className={`py-1.5 px-2 rounded border text-center font-medium transition-colors ${
                        guideNode.orientation === 'horizontal'
                          ? 'bg-cyan-600/30 border-cyan-500 text-cyan-200 font-semibold shadow-sm'
                          : 'bg-surface-base hover:bg-surface-hover border-surface-border text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      Horizontal (Eixo Y)
                    </button>
                  </div>
                </div>

                {/* Função Técnica / Papel (Role) */}
                <div className="p-3 rounded-lg bg-surface-subtle border border-surface-border space-y-2">
                  <span className="text-[11px] font-semibold text-slate-300 block">Função Técnica</span>
                  <div className="grid grid-cols-3 gap-1 text-[10px]">
                    {[
                      { role: 'generic' as TechnicalGuideRole, label: 'Geral', color: '#06b6d4' },
                      { role: 'fold' as TechnicalGuideRole, label: 'Dobra', color: '#f59e0b' },
                      { role: 'crease' as TechnicalGuideRole, label: 'Vinco', color: '#8b5cf6' },
                      { role: 'cut_reference' as TechnicalGuideRole, label: 'Corte', color: '#ec4899' },
                      { role: 'alignment' as TechnicalGuideRole, label: 'Alinhamento', color: '#3b82f6' },
                    ].map((item) => (
                      <button
                        key={item.role}
                        onClick={() => handleGuideRoleChange(item.role)}
                        className={`py-1 px-1.5 rounded border text-center font-medium transition-colors flex items-center justify-center gap-1 ${
                          guideNode.guideRole === item.role
                            ? 'bg-surface-base border-cyan-500 text-white shadow-sm ring-1 ring-cyan-500/50'
                            : 'bg-surface-base/60 hover:bg-surface-hover border-surface-border text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
                        <span className="truncate">{item.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Posição na Prancheta */}
                <div className="p-3 rounded-lg bg-surface-subtle border border-surface-border space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-slate-300">
                      {guideNode.orientation === 'vertical' ? 'Posição X (mm)' : 'Posição Y (mm)'}
                    </span>
                    <span className="text-[10px] font-mono text-slate-500">
                      0.0 a {guideNode.orientation === 'vertical' ? doc.dimensions.width_mm : doc.dimensions.height_mm} mm
                    </span>
                  </div>

                  <div className="space-y-1">
                    <input
                      type="number"
                      step="0.5"
                      min="0"
                      max={guideNode.orientation === 'vertical' ? doc.dimensions.width_mm : doc.dimensions.height_mm}
                      value={guidePositionInput}
                      onFocus={handleGuideInputFocus}
                      onChange={(e) => handleGuidePositionChange(e.target.value)}
                      onBlur={handleGuidePositionBlur}
                      onKeyDown={(e) => e.key === 'Enter' && handleGuidePositionBlur()}
                      className="w-full bg-surface-base border border-surface-border rounded px-2.5 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-cyan-500 text-right font-medium"
                    />
                  </div>

                  {/* Atalhos Rápidos de Posição */}
                  <div className="pt-2 border-t border-surface-border/50 space-y-1 text-[10px]">
                    <span className="text-slate-400 font-medium block">Atalhos de Posição:</span>
                    <div className="grid grid-cols-3 gap-1 font-mono">
                      <button
                        onClick={() => {
                          const max = guideNode.orientation === 'vertical' ? doc.dimensions.width_mm : doc.dimensions.height_mm;
                          handleApplyGuidePositionPreset(roundPrecision(max / 2, 2));
                        }}
                        className="p-1 rounded bg-surface-base hover:bg-surface-hover border border-surface-border text-slate-300 hover:text-white text-center"
                      >
                        Centro (50%)
                      </button>
                      <button
                        onClick={() => {
                          const max = guideNode.orientation === 'vertical' ? doc.dimensions.width_mm : doc.dimensions.height_mm;
                          handleApplyGuidePositionPreset(roundPrecision(max / 3, 2));
                        }}
                        className="p-1 rounded bg-surface-base hover:bg-surface-hover border border-surface-border text-slate-300 hover:text-white text-center"
                      >
                        1/3 ({roundPrecision((guideNode.orientation === 'vertical' ? doc.dimensions.width_mm : doc.dimensions.height_mm) / 3, 1)}mm)
                      </button>
                      <button
                        onClick={() => {
                          const max = guideNode.orientation === 'vertical' ? doc.dimensions.width_mm : doc.dimensions.height_mm;
                          handleApplyGuidePositionPreset(roundPrecision((max * 2) / 3, 2));
                        }}
                        className="p-1 rounded bg-surface-base hover:bg-surface-hover border border-surface-border text-slate-300 hover:text-white text-center"
                      >
                        2/3 ({roundPrecision(((guideNode.orientation === 'vertical' ? doc.dimensions.width_mm : doc.dimensions.height_mm) * 2) / 3, 1)}mm)
                      </button>
                    </div>
                  </div>
                </div>

                {/* Espessura do Traço */}
                <div className="p-3 rounded-lg bg-surface-subtle border border-surface-border space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-slate-300">Espessura do Traço</span>
                    <span className="text-[10px] font-mono text-slate-500">mm</span>
                  </div>
                  <input
                    type="number"
                    step="0.05"
                    min="0.05"
                    max="5.0"
                    value={guideStrokeWidthInput}
                    onChange={(e) => handleGuideStrokeWidthChange(e.target.value)}
                    onBlur={handleGuideStrokeWidthBlur}
                    onKeyDown={(e) => e.key === 'Enter' && handleGuideStrokeWidthBlur()}
                    className="w-full bg-surface-base border border-surface-border rounded px-2.5 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-cyan-500 text-right font-medium"
                  />
                  <div className="flex items-center justify-between text-[10px] pt-1 border-t border-surface-border/50">
                    <span className="text-slate-400">Padrões:</span>
                    <div className="flex items-center gap-1 font-mono">
                      {[0.10, 0.25, 0.50, 1.00].map((val) => (
                        <button
                          key={val}
                          onClick={() => {
                            setGuideStrokeWidthInput(val.toFixed(2));
                            onUpdateTechnicalGuide?.(guideNode.id, { strokeWidth_mm: val }, false);
                          }}
                          className={`px-1.5 py-0.5 rounded border transition-colors ${
                            (guideNode.strokeWidth_mm || 0.25) === val
                              ? 'bg-cyan-500/20 border-cyan-500/40 text-cyan-300 font-semibold'
                              : 'bg-surface-base hover:bg-surface-hover border-surface-border text-slate-300 hover:text-white'
                          }`}
                        >
                          {val.toFixed(2)} mm
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Ações da Guia */}
                <div className="pt-2 flex gap-2">
                  <button
                    onClick={() => onDuplicateTechnicalGuide?.(guideNode.id)}
                    className="flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded bg-surface-base hover:bg-surface-hover border border-surface-border text-slate-200 text-xs font-medium transition-colors"
                  >
                    <Copy className="w-3.5 h-3.5 text-cyan-400" />
                    <span>Duplicar (+5mm)</span>
                  </button>
                  <button
                    onClick={() => onDeleteNode(guideNode.id)}
                    className="py-1.5 px-3 rounded bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-300 text-xs transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span className="font-semibold text-slate-300">Configuração da Prancheta</span>
              <span className="text-[10px] font-mono text-emerald-400">Escala Real</span>
            </div>

            {/* Physical Dimensions Editable Cards */}
            <div className="space-y-2.5">
              <div className="p-3 rounded-lg bg-surface-subtle border border-surface-border space-y-2.5">
                <div className="flex items-center justify-between text-[11px] font-semibold text-slate-300">
                  <span>Tamanho da Prancheta (mm)</span>
                  <span className="text-[10px] font-mono text-slate-500">10 a 5000 mm</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-[10px] text-slate-400 flex items-center justify-between">
                      <span className="font-semibold text-indigo-300">Largura (W)</span>
                      <span className="text-slate-500 font-mono">mm</span>
                    </label>
                    <input
                      type="number"
                      step="10"
                      min="10"
                      max="5000"
                      value={artboardWidthInput}
                      onChange={(e) => handleArtboardWidthChange(e.target.value)}
                      onBlur={handleArtboardWidthBlur}
                      onKeyDown={(e) => e.key === 'Enter' && handleArtboardWidthBlur()}
                      className="w-full bg-surface-base border border-surface-border rounded px-2 py-1 text-xs font-mono text-white focus:outline-none focus:border-indigo-500 text-right font-medium"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] text-slate-400 flex items-center justify-between">
                      <span className="font-semibold text-indigo-300">Altura (H)</span>
                      <span className="text-slate-500 font-mono">mm</span>
                    </label>
                    <input
                      type="number"
                      step="10"
                      min="10"
                      max="5000"
                      value={artboardHeightInput}
                      onChange={(e) => handleArtboardHeightChange(e.target.value)}
                      onBlur={handleArtboardHeightBlur}
                      onKeyDown={(e) => e.key === 'Enter' && handleArtboardHeightBlur()}
                      className="w-full bg-surface-base border border-surface-border rounded px-2 py-1 text-xs font-mono text-white focus:outline-none focus:border-indigo-500 text-right font-medium"
                    />
                  </div>
                </div>

                {/* Presets Rápidos */}
                <div className="pt-2 border-t border-surface-border/50 space-y-1.5">
                  <span className="text-[10px] text-slate-400 font-medium block">Formatos Pré-definidos:</span>
                  <div className="grid grid-cols-2 gap-1.5 font-mono text-[10px]">
                    <button
                      onClick={() => handleApplyArtboardPreset(100, 100)}
                      className={`p-1.5 rounded border transition-colors text-center ${
                        doc.dimensions.width_mm === 100 && doc.dimensions.height_mm === 100
                          ? 'bg-indigo-600/30 border-indigo-500 text-white font-semibold'
                          : 'bg-surface-base hover:bg-surface-hover border-surface-border text-slate-300 hover:text-white'
                      }`}
                    >
                      100 × 100 mm (10cm)
                    </button>
                    <button
                      onClick={() => handleApplyArtboardPreset(210, 297)}
                      className={`p-1.5 rounded border transition-colors text-center ${
                        doc.dimensions.width_mm === 210 && doc.dimensions.height_mm === 297
                          ? 'bg-indigo-600/30 border-indigo-500 text-white font-semibold'
                          : 'bg-surface-base hover:bg-surface-hover border-surface-border text-slate-300 hover:text-white'
                      }`}
                    >
                      210 × 297 mm (A4 Retrato)
                    </button>
                    <button
                      onClick={() => handleApplyArtboardPreset(297, 210)}
                      className={`p-1.5 rounded border transition-colors text-center ${
                        doc.dimensions.width_mm === 297 && doc.dimensions.height_mm === 210
                          ? 'bg-indigo-600/30 border-indigo-500 text-white font-semibold'
                          : 'bg-surface-base hover:bg-surface-hover border-surface-border text-slate-300 hover:text-white'
                      }`}
                    >
                      297 × 210 mm (A4 Paisagem)
                    </button>
                    <button
                      onClick={() => handleApplyArtboardPreset(300, 300)}
                      className={`p-1.5 rounded border transition-colors text-center ${
                        doc.dimensions.width_mm === 300 && doc.dimensions.height_mm === 300
                          ? 'bg-indigo-600/30 border-indigo-500 text-white font-semibold'
                          : 'bg-surface-base hover:bg-surface-hover border-surface-border text-slate-300 hover:text-white'
                      }`}
                    >
                      300 × 300 mm (30cm)
                    </button>
                    <button
                      onClick={() => handleApplyArtboardPreset(500, 500)}
                      className={`col-span-2 p-1.5 rounded border transition-colors text-center ${
                        doc.dimensions.width_mm === 500 && doc.dimensions.height_mm === 500
                          ? 'bg-indigo-600/30 border-indigo-500 text-white font-semibold'
                          : 'bg-surface-base hover:bg-surface-hover border-surface-border text-slate-300 hover:text-white'
                      }`}
                    >
                      500 × 500 mm (50cm)
                    </button>
                  </div>
                </div>
              </div>

              {/* PREPARAÇÃO TÉCNICA (FASE 5.1: SANGRIA E MARGEM DE SEGURANÇA) */}
              {/* Card 1: Sangria (Bleed) */}
              <div className="p-3 rounded-lg bg-surface-subtle border border-surface-border space-y-3">
                <div className="flex items-center justify-between text-[11px] font-semibold text-slate-300">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-rose-500" />
                    <span>SANGRIA (BLEED)</span>
                  </div>
                  <label className="flex items-center gap-1.5 cursor-pointer text-[10px] text-slate-300 select-none">
                    <input
                      type="checkbox"
                      checked={bleedSettings.enabled}
                      onChange={handleToggleBleed}
                      className="rounded border-surface-border text-rose-500 focus:ring-rose-500/20 bg-surface-base"
                    />
                    <span className={bleedSettings.enabled ? 'text-rose-400 font-medium' : 'text-slate-500'}>
                      {bleedSettings.enabled ? 'Ativado' : 'Desativado'}
                    </span>
                  </label>
                </div>

                {bleedSettings.enabled && (
                  <div className="space-y-2.5 pt-1 border-t border-surface-border/50">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-slate-400 font-medium">Distância da Sangria:</span>
                      <button
                        type="button"
                        onClick={handleToggleBleedLink}
                        title={bleedSettings.linked ? 'Dimensões vinculadas (iguais)' : 'Dimensões independentes'}
                        className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border transition-colors ${
                          bleedSettings.linked
                            ? 'bg-rose-500/10 border-rose-500/40 text-rose-300'
                            : 'bg-surface-base border-surface-border text-slate-400 hover:text-white'
                        }`}
                      >
                        {bleedSettings.linked ? <Link className="w-3 h-3" /> : <Unlink className="w-3 h-3" />}
                        <span>{bleedSettings.linked ? 'Vinculado' : 'Independente'}</span>
                      </button>
                    </div>

                    {bleedSettings.linked ? (
                      <div className="space-y-1">
                        <label className="text-[10px] text-slate-400 flex items-center justify-between">
                          <span className="font-semibold text-rose-300">Todos os lados</span>
                          <span className="text-slate-500 font-mono">mm</span>
                        </label>
                        <input
                          type="number"
                          step="0.5"
                          min="0"
                          max="100"
                          value={bleedUniformInput}
                          onChange={(e) => handleBleedUniformChange(e.target.value)}
                          onBlur={handleBleedCommit}
                          onKeyDown={(e) => e.key === 'Enter' && handleBleedCommit()}
                          className="w-full bg-surface-base border border-surface-border rounded px-2 py-1 text-xs font-mono text-white focus:outline-none focus:border-rose-500 text-right font-medium"
                        />
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <label className="text-[10px] text-slate-400 flex items-center justify-between">
                            <span className="text-rose-300">Topo (T)</span>
                            <span className="text-slate-500 font-mono">mm</span>
                          </label>
                          <input
                            type="number"
                            step="0.5"
                            min="0"
                            max="100"
                            value={bleedTopInput}
                            onChange={(e) => handleBleedSideChange('top_mm', e.target.value)}
                            onBlur={handleBleedCommit}
                            onKeyDown={(e) => e.key === 'Enter' && handleBleedCommit()}
                            className="w-full bg-surface-base border border-surface-border rounded px-2 py-1 text-xs font-mono text-white focus:outline-none focus:border-rose-500 text-right font-medium"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] text-slate-400 flex items-center justify-between">
                            <span className="text-rose-300">Direita (R)</span>
                            <span className="text-slate-500 font-mono">mm</span>
                          </label>
                          <input
                            type="number"
                            step="0.5"
                            min="0"
                            max="100"
                            value={bleedRightInput}
                            onChange={(e) => handleBleedSideChange('right_mm', e.target.value)}
                            onBlur={handleBleedCommit}
                            onKeyDown={(e) => e.key === 'Enter' && handleBleedCommit()}
                            className="w-full bg-surface-base border border-surface-border rounded px-2 py-1 text-xs font-mono text-white focus:outline-none focus:border-rose-500 text-right font-medium"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] text-slate-400 flex items-center justify-between">
                            <span className="text-rose-300">Inferior (B)</span>
                            <span className="text-slate-500 font-mono">mm</span>
                          </label>
                          <input
                            type="number"
                            step="0.5"
                            min="0"
                            max="100"
                            value={bleedBottomInput}
                            onChange={(e) => handleBleedSideChange('bottom_mm', e.target.value)}
                            onBlur={handleBleedCommit}
                            onKeyDown={(e) => e.key === 'Enter' && handleBleedCommit()}
                            className="w-full bg-surface-base border border-surface-border rounded px-2 py-1 text-xs font-mono text-white focus:outline-none focus:border-rose-500 text-right font-medium"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] text-slate-400 flex items-center justify-between">
                            <span className="text-rose-300">Esquerda (L)</span>
                            <span className="text-slate-500 font-mono">mm</span>
                          </label>
                          <input
                            type="number"
                            step="0.5"
                            min="0"
                            max="100"
                            value={bleedLeftInput}
                            onChange={(e) => handleBleedSideChange('left_mm', e.target.value)}
                            onBlur={handleBleedCommit}
                            onKeyDown={(e) => e.key === 'Enter' && handleBleedCommit()}
                            className="w-full bg-surface-base border border-surface-border rounded px-2 py-1 text-xs font-mono text-white focus:outline-none focus:border-rose-500 text-right font-medium"
                          />
                        </div>
                      </div>
                    )}

                    {/* Presets de Sangria */}
                    <div className="pt-1.5 space-y-1">
                      <span className="text-[10px] text-slate-400 font-medium block">Presets de Sangria:</span>
                      <div className="grid grid-cols-4 gap-1 font-mono text-[10px]">
                        {[0, 2, 3, 5].map((val) => (
                          <button
                            key={val}
                            type="button"
                            onClick={() => handleApplyBleedPreset(val)}
                            className={`p-1 rounded border transition-colors text-center ${
                              bleedSettings.top_mm === val &&
                              bleedSettings.right_mm === val &&
                              bleedSettings.bottom_mm === val &&
                              bleedSettings.left_mm === val
                                ? 'bg-rose-500/20 border-rose-500 text-rose-300 font-semibold'
                                : 'bg-surface-base hover:bg-surface-hover border-surface-border text-slate-300 hover:text-white'
                            }`}
                          >
                            {val} mm
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Card 2: Margem de Segurança (Safety Margin) */}
              <div className="p-3 rounded-lg bg-surface-subtle border border-surface-border space-y-3">
                <div className="flex items-center justify-between text-[11px] font-semibold text-slate-300">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-500" />
                    <span>MARGEM DE SEGURANÇA</span>
                  </div>
                  <label className="flex items-center gap-1.5 cursor-pointer text-[10px] text-slate-300 select-none">
                    <input
                      type="checkbox"
                      checked={safetySettings.enabled}
                      onChange={handleToggleSafety}
                      className="rounded border-surface-border text-emerald-500 focus:ring-emerald-500/20 bg-surface-base"
                    />
                    <span className={safetySettings.enabled ? 'text-emerald-400 font-medium' : 'text-slate-500'}>
                      {safetySettings.enabled ? 'Ativado' : 'Desativado'}
                    </span>
                  </label>
                </div>

                {safetySettings.enabled && (
                  <div className="space-y-2.5 pt-1 border-t border-surface-border/50">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-slate-400 font-medium">Distância da Margem:</span>
                      <button
                        type="button"
                        onClick={handleToggleSafetyLink}
                        title={safetySettings.linked ? 'Dimensões vinculadas (iguais)' : 'Dimensões independentes'}
                        className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border transition-colors ${
                          safetySettings.linked
                            ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-300'
                            : 'bg-surface-base border-surface-border text-slate-400 hover:text-white'
                        }`}
                      >
                        {safetySettings.linked ? <Link className="w-3 h-3" /> : <Unlink className="w-3 h-3" />}
                        <span>{safetySettings.linked ? 'Vinculado' : 'Independente'}</span>
                      </button>
                    </div>

                    {safetySettings.linked ? (
                      <div className="space-y-1">
                        <label className="text-[10px] text-slate-400 flex items-center justify-between">
                          <span className="font-semibold text-emerald-300">Todos os lados</span>
                          <span className="text-slate-500 font-mono">mm</span>
                        </label>
                        <input
                          type="number"
                          step="0.5"
                          min="0"
                          max={Math.floor(Math.min(doc.dimensions.width_mm, doc.dimensions.height_mm) / 2 - 0.5)}
                          value={safetyUniformInput}
                          onChange={(e) => handleSafetyUniformChange(e.target.value)}
                          onBlur={handleSafetyCommit}
                          onKeyDown={(e) => e.key === 'Enter' && handleSafetyCommit()}
                          className="w-full bg-surface-base border border-surface-border rounded px-2 py-1 text-xs font-mono text-white focus:outline-none focus:border-emerald-500 text-right font-medium"
                        />
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <label className="text-[10px] text-slate-400 flex items-center justify-between">
                            <span className="text-emerald-300">Topo (T)</span>
                            <span className="text-slate-500 font-mono">mm</span>
                          </label>
                          <input
                            type="number"
                            step="0.5"
                            min="0"
                            value={safetyTopInput}
                            onChange={(e) => handleSafetySideChange('top_mm', e.target.value)}
                            onBlur={handleSafetyCommit}
                            onKeyDown={(e) => e.key === 'Enter' && handleSafetyCommit()}
                            className="w-full bg-surface-base border border-surface-border rounded px-2 py-1 text-xs font-mono text-white focus:outline-none focus:border-emerald-500 text-right font-medium"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] text-slate-400 flex items-center justify-between">
                            <span className="text-emerald-300">Direita (R)</span>
                            <span className="text-slate-500 font-mono">mm</span>
                          </label>
                          <input
                            type="number"
                            step="0.5"
                            min="0"
                            value={safetyRightInput}
                            onChange={(e) => handleSafetySideChange('right_mm', e.target.value)}
                            onBlur={handleSafetyCommit}
                            onKeyDown={(e) => e.key === 'Enter' && handleSafetyCommit()}
                            className="w-full bg-surface-base border border-surface-border rounded px-2 py-1 text-xs font-mono text-white focus:outline-none focus:border-emerald-500 text-right font-medium"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] text-slate-400 flex items-center justify-between">
                            <span className="text-emerald-300">Inferior (B)</span>
                            <span className="text-slate-500 font-mono">mm</span>
                          </label>
                          <input
                            type="number"
                            step="0.5"
                            min="0"
                            value={safetyBottomInput}
                            onChange={(e) => handleSafetySideChange('bottom_mm', e.target.value)}
                            onBlur={handleSafetyCommit}
                            onKeyDown={(e) => e.key === 'Enter' && handleSafetyCommit()}
                            className="w-full bg-surface-base border border-surface-border rounded px-2 py-1 text-xs font-mono text-white focus:outline-none focus:border-emerald-500 text-right font-medium"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] text-slate-400 flex items-center justify-between">
                            <span className="text-emerald-300">Esquerda (L)</span>
                            <span className="text-slate-500 font-mono">mm</span>
                          </label>
                          <input
                            type="number"
                            step="0.5"
                            min="0"
                            value={safetyLeftInput}
                            onChange={(e) => handleSafetySideChange('left_mm', e.target.value)}
                            onBlur={handleSafetyCommit}
                            onKeyDown={(e) => e.key === 'Enter' && handleSafetyCommit()}
                            className="w-full bg-surface-base border border-surface-border rounded px-2 py-1 text-xs font-mono text-white focus:outline-none focus:border-emerald-500 text-right font-medium"
                          />
                        </div>
                      </div>
                    )}

                    {/* Presets de Margem */}
                    <div className="pt-1.5 space-y-1">
                      <span className="text-[10px] text-slate-400 font-medium block">Presets de Margem:</span>
                      <div className="grid grid-cols-4 gap-1 font-mono text-[10px]">
                        {[0, 3, 5, 10].map((val) => (
                          <button
                            key={val}
                            type="button"
                            onClick={() => handleApplySafetyPreset(val)}
                            className={`p-1 rounded border transition-colors text-center ${
                              safetySettings.top_mm === val &&
                              safetySettings.right_mm === val &&
                              safetySettings.bottom_mm === val &&
                              safetySettings.left_mm === val
                                ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300 font-semibold'
                                : 'bg-surface-base hover:bg-surface-hover border-surface-border text-slate-300 hover:text-white'
                            }`}
                          >
                            {val} mm
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Card 3: Guias Técnicas (Fase 5.2) */}
              <div className="p-3 rounded-lg bg-surface-subtle border border-surface-border space-y-3">
                <div className="flex items-center justify-between text-[11px] font-semibold text-slate-300">
                  <div className="flex items-center gap-1.5">
                    <Compass className="w-3.5 h-3.5 text-cyan-400" />
                    <span>GUIAS TÉCNICAS</span>
                  </div>
                  <span className="text-[10px] font-mono text-cyan-300">
                    {Object.values(doc.nodes).filter((n) => n.type === 'technical_guide').length} ativas
                  </span>
                </div>

                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        onCreateTechnicalGuide?.({
                          orientation: 'vertical',
                          guidePosition_mm: roundPrecision(doc.dimensions.width_mm / 2, 2),
                          guideRole: 'generic',
                        })
                      }
                      className="flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md bg-cyan-600/20 hover:bg-cyan-600/30 border border-cyan-500/40 text-cyan-200 text-xs font-medium transition-colors"
                    >
                      <SplitSquareVertical className="w-3.5 h-3.5 text-cyan-400" />
                      <span>+ Guia Vertical</span>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        onCreateTechnicalGuide?.({
                          orientation: 'horizontal',
                          guidePosition_mm: roundPrecision(doc.dimensions.height_mm / 2, 2),
                          guideRole: 'generic',
                        })
                      }
                      className="flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md bg-cyan-600/20 hover:bg-cyan-600/30 border border-cyan-500/40 text-cyan-200 text-xs font-medium transition-colors"
                    >
                      <SplitSquareVertical className="w-3.5 h-3.5 text-cyan-400 rotate-90" />
                      <span>+ Guia Horizontal</span>
                    </button>
                  </div>

                  {/* Presets Rápidos de Guias */}
                  <div className="pt-2 border-t border-surface-border/50 space-y-1.5">
                    <span className="text-[10px] text-slate-400 font-medium block">Presets Rápidos:</span>
                    <div className="grid grid-cols-2 gap-1.5 font-mono text-[10px]">
                      <button
                        type="button"
                        onClick={() => {
                          onCreateTechnicalGuide?.({
                            orientation: 'vertical',
                            guidePosition_mm: roundPrecision(doc.dimensions.width_mm / 2, 2),
                            guideRole: 'alignment',
                          });
                        }}
                        className="p-1.5 rounded bg-surface-base hover:bg-surface-hover border border-surface-border text-slate-300 hover:text-white text-center"
                      >
                        Centro Vertical
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          onCreateTechnicalGuide?.({
                            orientation: 'horizontal',
                            guidePosition_mm: roundPrecision(doc.dimensions.height_mm / 2, 2),
                            guideRole: 'alignment',
                          });
                        }}
                        className="p-1.5 rounded bg-surface-base hover:bg-surface-hover border border-surface-border text-slate-300 hover:text-white text-center"
                      >
                        Centro Horizontal
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          onCreateTechnicalGuide?.({
                            orientation: 'vertical',
                            guidePosition_mm: roundPrecision(doc.dimensions.width_mm / 3, 2),
                            guideRole: 'generic',
                          });
                          onCreateTechnicalGuide?.({
                            orientation: 'vertical',
                            guidePosition_mm: roundPrecision((doc.dimensions.width_mm * 2) / 3, 2),
                            guideRole: 'generic',
                          });
                        }}
                        className="p-1.5 rounded bg-surface-base hover:bg-surface-hover border border-surface-border text-slate-300 hover:text-white text-center"
                      >
                        Terços Verticais
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          onCreateTechnicalGuide?.({
                            orientation: 'horizontal',
                            guidePosition_mm: roundPrecision(doc.dimensions.height_mm / 3, 2),
                            guideRole: 'generic',
                          });
                          onCreateTechnicalGuide?.({
                            orientation: 'horizontal',
                            guidePosition_mm: roundPrecision((doc.dimensions.height_mm * 2) / 3, 2),
                            guideRole: 'generic',
                          });
                        }}
                        className="p-1.5 rounded bg-surface-base hover:bg-surface-hover border border-surface-border text-slate-300 hover:text-white text-center"
                      >
                        Terços Horizontais
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Card 4: Telemetria Derivada de Produção (Read-only) */}
              <div className="p-3 rounded-lg bg-surface-subtle border border-surface-border space-y-2">
                <div className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider flex items-center justify-between">
                  <span>Telemetria de Produção</span>
                  <span className="text-[10px] font-mono text-indigo-400">Tempo Real</span>
                </div>
                <div className="space-y-1.5 text-xs">
                  <div className="flex justify-between items-center py-1 border-b border-surface-border/50">
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-sm bg-blue-500" />
                      <span className="text-slate-400">Formato Final (Trim):</span>
                    </div>
                    <span className="font-mono font-medium text-blue-300">
                      {doc.dimensions.width_mm.toFixed(1)} × {doc.dimensions.height_mm.toFixed(1)} mm
                    </span>
                  </div>
                  <div className="flex justify-between items-center py-1 border-b border-surface-border/50">
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-sm bg-rose-500" />
                      <span className="text-slate-400">Com Sangria (Bleed Box):</span>
                    </div>
                    <span className={`font-mono font-medium ${bleedSettings.enabled ? 'text-rose-300' : 'text-slate-500'}`}>
                      {bleedBox.width_mm.toFixed(1)} × {bleedBox.height_mm.toFixed(1)} mm
                    </span>
                  </div>
                  <div className="flex justify-between items-center py-1 border-b border-surface-border/50">
                    <div className="flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-sm bg-emerald-500" />
                      <span className="text-slate-400">Área Segura (Safety Box):</span>
                    </div>
                    <span className={`font-mono font-medium ${safetySettings.enabled ? 'text-emerald-300' : 'text-slate-500'}`}>
                      {safetyBox.width_mm.toFixed(1)} × {safetyBox.height_mm.toFixed(1)} mm
                    </span>
                  </div>
                  <div className="flex justify-between items-center py-1 text-slate-400">
                    <span>Motor de Vetorização:</span>
                    <span className="font-mono text-indigo-300 font-semibold">VTracer (Rust/WASM)</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 3. Aba de Validação de Produção */}
        {activeTab === 'validation' && (
          <div className="space-y-4">
            {/* 1. Status Geral de Produção */}
            <div className={`p-3.5 rounded-lg border flex flex-col gap-2.5 transition-all ${
              activeReport.status === 'blocked'
                ? 'bg-rose-950/40 border-rose-500/60 shadow-sm shadow-rose-500/10'
                : activeReport.status === 'attention'
                ? 'bg-amber-950/40 border-amber-500/60 shadow-sm shadow-amber-500/10'
                : 'bg-emerald-950/40 border-emerald-500/60 shadow-sm shadow-emerald-500/10'
            }`}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  {activeReport.status === 'blocked' ? (
                    <XCircle className="w-5 h-5 text-rose-400 shrink-0" />
                  ) : activeReport.status === 'attention' ? (
                    <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
                  ) : (
                    <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                  )}
                  <div className="min-w-0">
                    <h4 className="text-xs font-bold text-white tracking-wide truncate">
                      {activeReport.status === 'blocked'
                        ? 'Bloqueado para Produção'
                        : activeReport.status === 'attention'
                        ? 'Requer Atenção'
                        : 'Pronto para Produção'}
                    </h4>
                    <p className="text-[10px] text-slate-300 line-clamp-1">
                      {activeReport.status === 'blocked'
                        ? 'Existem erros críticos que impedem a saída gráfica.'
                        : activeReport.status === 'attention'
                        ? 'Existem pontos de atenção que merecem revisão.'
                        : 'Nenhum impedimento técnico detectado.'}
                    </p>
                    {formattedCheckedAt && (
                      <p className="text-[9px] text-slate-400 font-mono mt-0.5">
                        Última checagem: <span className="text-slate-300 font-semibold">{formattedCheckedAt}</span>
                      </p>
                    )}
                  </div>
                </div>
                <button
                  onClick={handleManualVerify}
                  disabled={isVerifying}
                  title="Reexecutar validação de produção gráfica"
                  className={`p-1.5 rounded bg-surface-base/90 hover:bg-surface-hover border border-surface-border text-slate-300 hover:text-white transition-all shrink-0 flex items-center gap-1 text-[10px] font-medium ${
                    isVerifying ? 'opacity-75 cursor-wait' : ''
                  }`}
                >
                  <RefreshCw className={`w-3 h-3 text-indigo-400 ${isVerifying ? 'animate-spin' : ''}`} />
                  <span>{isVerifying ? 'Verificando...' : (verifiedAtNotice ?? 'Verificar')}</span>
                </button>
              </div>

              {/* Contadores */}
              <div className="grid grid-cols-3 gap-1.5 pt-1 border-t border-surface-border/40 text-center font-mono text-[11px]">
                <div className="p-1 rounded bg-rose-500/10 border border-rose-500/20 text-rose-300">
                  <span className="font-bold">{activeReport.errorCount}</span> {activeReport.errorCount === 1 ? 'Erro' : 'Erros'}
                </div>
                <div className="p-1 rounded bg-amber-500/10 border border-amber-500/20 text-amber-300">
                  <span className="font-bold">{activeReport.warningCount}</span> {activeReport.warningCount === 1 ? 'Aviso' : 'Avisos'}
                </div>
                <div className="p-1 rounded bg-cyan-500/10 border border-cyan-500/20 text-cyan-300">
                  <span className="font-bold">{activeReport.infoCount}</span> {activeReport.infoCount === 1 ? 'Info' : 'Infos'}
                </div>
              </div>
            </div>

            {/* 2. Filtros de Severidade */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span className="font-semibold text-slate-300">Diagnóstico Técnico</span>
                <span className="text-[10px] font-mono text-slate-500">
                  {filteredIssues.length} {filteredIssues.length === 1 ? 'item' : 'itens'}
                </span>
              </div>

              <div className="grid grid-cols-4 gap-1 p-0.5 bg-surface-base rounded-md border border-surface-border text-[10px]">
                <button
                  onClick={() => setValidationFilter('all')}
                  className={`py-1 rounded text-center font-medium transition-colors ${
                    validationFilter === 'all'
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Todos ({activeReport.issues.length})
                </button>
                <button
                  onClick={() => setValidationFilter('error')}
                  className={`py-1 rounded text-center font-medium transition-colors ${
                    validationFilter === 'error'
                      ? 'bg-rose-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Erros ({activeReport.errorCount})
                </button>
                <button
                  onClick={() => setValidationFilter('warning')}
                  className={`py-1 rounded text-center font-medium transition-colors ${
                    validationFilter === 'warning'
                      ? 'bg-amber-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Avisos ({activeReport.warningCount})
                </button>
                <button
                  onClick={() => setValidationFilter('info')}
                  className={`py-1 rounded text-center font-medium transition-colors ${
                    validationFilter === 'info'
                      ? 'bg-cyan-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Infos ({activeReport.infoCount})
                </button>
              </div>
            </div>

            {/* 3. Lista de Issues */}
            {filteredIssues.length === 0 ? (
              <div className="p-4 rounded-lg bg-surface-subtle border border-surface-border text-center space-y-2">
                <div className="w-8 h-8 mx-auto rounded-md bg-surface-base border border-surface-border flex items-center justify-center text-emerald-400">
                  <ShieldCheck className="w-4 h-4" />
                </div>
                <p className="text-xs text-slate-300 font-medium">Nenhum apontamento nesta categoria.</p>
                <p className="text-[11px] text-slate-500">
                  O documento atende aos requisitos técnicos validados para esta seção.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredIssues.map((issue) => {
                  const isError = issue.severity === 'error';
                  const isWarning = issue.severity === 'warning';
                  const associatedNode = issue.nodeId ? doc.nodes[issue.nodeId] : undefined;

                  return (
                    <div
                      key={issue.id}
                      className={`p-3 rounded-lg border text-xs space-y-2 transition-all ${
                        isError
                          ? 'bg-rose-950/30 border-rose-500/40 text-rose-200'
                          : isWarning
                          ? 'bg-amber-950/30 border-amber-500/40 text-amber-200'
                          : 'bg-cyan-950/30 border-cyan-500/40 text-cyan-200'
                      }`}
                    >
                      {/* Header do Card de Issue */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span
                            className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded uppercase tracking-wider ${
                              isError
                                ? 'bg-rose-500 text-white'
                                : isWarning
                                ? 'bg-amber-500 text-slate-900'
                                : 'bg-cyan-500 text-slate-900'
                            }`}
                          >
                            {issue.category}
                          </span>
                          <span className="font-semibold text-slate-100 text-xs">
                            {issue.title}
                          </span>
                        </div>
                        <span className="text-[9px] font-mono text-slate-500 shrink-0">
                          {issue.ruleId.split('_')[0]}
                        </span>
                      </div>

                      {/* Mensagem Operacional */}
                      <p className="text-[11px] text-slate-300 leading-relaxed">
                        {issue.message}
                      </p>

                      {/* Sugestão de Ação */}
                      {issue.suggestedAction && (
                        <div className="p-2 rounded bg-surface-base/60 border border-surface-border/50 text-[10px] text-slate-400 flex items-start gap-1.5">
                          <Sparkles className="w-3 h-3 text-indigo-400 shrink-0 mt-0.5" />
                          <span>
                            <strong className="text-slate-300">Sugestão:</strong> {issue.suggestedAction}
                          </span>
                        </div>
                      )}

                      {/* Ação de Navegação (Selecionar Objeto) */}
                      {issue.nodeId && (
                        <div className="pt-1 flex items-center justify-between border-t border-surface-border/40">
                          <span className="text-[10px] text-slate-400 font-mono truncate max-w-[140px]">
                            {associatedNode?.name || issue.nodeId}
                          </span>
                          <button
                            onClick={() => onSelectNode(issue.nodeId!)}
                            className="px-2 py-1 rounded bg-surface-base hover:bg-surface-hover border border-surface-border text-indigo-300 hover:text-white text-[10px] font-medium flex items-center gap-1 transition-colors"
                          >
                            <Crosshair className="w-3 h-3 text-indigo-400" />
                            <span>Selecionar</span>
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer Info */}
      <div className="p-3 border-t border-surface-border bg-surface-subtle text-[10px] text-slate-500 flex items-center justify-between">
        <span className="font-mono text-slate-400">PDM v0.2</span>
        <span className="text-emerald-400 flex items-center gap-1">
          <Check className="w-3 h-3" /> Vetorização Calibrada
        </span>
      </div>
    </aside>
  );
};
