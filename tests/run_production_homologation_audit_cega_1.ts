import { createDocument, addVectorGroup } from '../src/core/pdm/document';
import { buildVectorGroupFromSvg } from '../src/core/vectorizer/svgParser';

const PROD_URL = 'https://prexyon-agent-10-production.up.railway.app';

console.log('=== INICIANDO HOMOLOGAÇÃO EM PRODUÇÃO (COMMIT 71f4631) ===\n');

async function sendChatRequest(payload: any, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await new Promise((r) => setTimeout(r, 300));
      const res = await fetch(`${PROD_URL}/api/agent/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.status === 502 && attempt < retries) {
        console.warn(`[HTTP 502] Tentando novamente (tentativa ${attempt}/${retries})...`);
        await new Promise((r) => setTimeout(r, 2000 * attempt));
        continue;
      }
      const status = res.status;
      const json = await res.json();
      return { status, json };
    } catch (err: any) {
      if (attempt < retries) {
        console.warn(`[Erro de rede] Tentando novamente (tentativa ${attempt}/${retries}): ${err.message}`);
        await new Promise((r) => setTimeout(r, 2000 * attempt));
        continue;
      }
      throw err;
    }
  }
  throw new Error('Falha no sendChatRequest após tentativas.');
}

async function runHomologation() {
  try {
    // ----------------------------------------------------
    // TESTE 1: P0-01 — INNER CONTOURS
    // ----------------------------------------------------
    console.log('--- 1. P0-01: INNER CONTOURS ---');
    let doc1 = createDocument({ width_mm: 100, height_mm: 100 });
    const svgString = `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
      <path d="M 0 0 L 100 0 L 100 100 L 0 100 Z M 20 20 L 40 20 L 40 40 L 20 40 Z" fill="#000000" />
    </svg>`;
    const { groupNode: vg1, pathNodes: pn1 } = buildVectorGroupFromSvg({
      svgString,
      name: 'Arte Vetorial',
      physicalWidth_mm: 50,
      physicalHeight_mm: 50,
      position_mm: { x: 10, y: 10 },
    });
    doc1 = addVectorGroup(doc1, vg1, pn1);

    const cutNode1: any = {
      id: 'cut-1',
      name: 'Faca de Corte',
      type: 'cut_contour',
      sourceNodeId: vg1.id,
      offset_mm: 2.0,
      joinStyle: 'round',
      includeInnerContours: true,
      contours: [],
      physicalWidth_mm: 54,
      physicalHeight_mm: 54,
      position_mm: { x: 8, y: 8 },
      visible: true,
    };
    doc1 = {
      ...doc1,
      nodes: { ...doc1.nodes, [cutNode1.id]: cutNode1 },
      rootNodeIds: [...doc1.rootNodeIds, cutNode1.id],
    };

    const req1 = await sendChatRequest({
      message: 'sem os cortes de dentro',
      doc: doc1,
      options: { selectedNodeId: cutNode1.id },
      selectedNodeId: cutNode1.id,
    });

    console.log('P0-01 req1 HTTP:', req1.status);
    console.log('P0-01 reply:', req1.json.reply);
    const finalDoc1 = req1.json.doc;
    const cutFinal1 = finalDoc1?.nodes?.['cut-1'];
    console.log('P0-01 cutFinal1:', cutFinal1);
    const cutCount1 = Object.values(finalDoc1?.nodes || {}).filter((n: any) => n.type === 'cut_contour').length;

    const p0_01_pass =
      req1.status === 200 &&
      cutFinal1 &&
      cutFinal1.includeInnerContours === false &&
      cutCount1 === 1 &&
      req1.json.reply.toLowerCase().includes('sem cortes internos');

    console.log(`P0-01 STATUS: ${p0_01_pass ? 'PASS ✓' : 'FAIL ✗'}`);
    if (!p0_01_pass) throw new Error('P0-01 reprovado');

    // ----------------------------------------------------
    // TESTE 2: P0-02 — ALTURA VS LARGURA
    // ----------------------------------------------------
    console.log('\n--- 2. P0-02: ALTURA VS LARGURA ---');
    let doc2 = createDocument({ width_mm: 200, height_mm: 200 });
    const { groupNode: vg2, pathNodes: pn2 } = buildVectorGroupFromSvg({
      svgString,
      name: 'Retângulo 100x50',
      physicalWidth_mm: 100,
      physicalHeight_mm: 50,
      position_mm: { x: 10, y: 10 },
    });
    doc2 = addVectorGroup(doc2, vg2, pn2);

    const req2 = await sendChatRequest({
      message: 'quero isso com 4 cm de altura proporcional, espelha e cria o branco por baixo para DTF UV',
      doc: doc2,
      selectedNodeId: vg2.id,
    });

    console.log('P0-02 req2 HTTP:', req2.status);
    console.log('P0-02 reply:', req2.json.reply);
    const finalDoc2 = req2.json.doc;
    const vgFinal2 = finalDoc2?.nodes?.[vg2.id];

    const p0_02_pass =
      req2.status === 200 &&
      finalDoc2?.profileId === 'dtf-uv' &&
      vgFinal2 &&
      Math.abs(vgFinal2.physicalHeight_mm - 40) < 1.0 &&
      vgFinal2.physicalWidth_mm !== 40 &&
      (finalDoc2?.separations?.white || finalDoc2?.separations?.WHITE) &&
      req2.json.reply.toLowerCase().includes('base branca');

    console.log(`P0-02 height=40mm width=${vgFinal2?.physicalWidth_mm}mm: ${p0_02_pass ? 'PASS ✓' : 'FAIL ✗'}`);
    if (!p0_02_pass) throw new Error('P0-02 reprovado');

    // ----------------------------------------------------
    // TESTE 3: P1-01 — VOCABULÁRIO RASTER
    // ----------------------------------------------------
    console.log('\n--- 3. P1-01: VOCABULÁRIO RASTER ---');
    let doc3 = createDocument({ width_mm: 100, height_mm: 100 });
    const clientReceipt3 = {
      action: 'vectorize_raster',
      status: 'success',
      resultNodeId: 'vg-client-1',
      timestamp: Date.now(),
    };

    const { groupNode: vg3, pathNodes: pn3 } = buildVectorGroupFromSvg({
      svgString,
      name: 'Vetor do Cliente',
      physicalWidth_mm: 50,
      physicalHeight_mm: 50,
      position_mm: { x: 10, y: 10 },
    });
    vg3.id = 'vg-client-1';
    doc3 = addVectorGroup(doc3, vg3, pn3);

    const req3 = await sendChatRequest({
      message: 'converte em curvas',
      doc: doc3,
      selectedNodeId: vg3.id,
      clientExecutionReceipts: [clientReceipt3],
    });

    console.log('P1-01 req3 HTTP:', req3.status);
    console.log('P1-01 reply:', req3.json.reply);

    const p1_01_pass = req3.status === 200 && req3.json.reply.toLowerCase().includes('vetor');
    console.log(`P1-01 STATUS: ${p1_01_pass ? 'PASS ✓' : 'FAIL ✗'}`);
    if (!p1_01_pass) throw new Error('P1-01 reprovado');

    // ----------------------------------------------------
    // TESTE 4: P1-02 — MULTI-STEP COMPLETENESS
    // ----------------------------------------------------
    console.log('\n--- 4. P1-02: MULTI-STEP COMPLETENESS ---');
    let doc4 = createDocument({ width_mm: 200, height_mm: 200 });
    const { groupNode: vg4, pathNodes: pn4 } = buildVectorGroupFromSvg({
      svgString,
      name: 'Arte para Multi-Step',
      physicalWidth_mm: 100,
      physicalHeight_mm: 100,
      position_mm: { x: 10, y: 10 },
    });
    doc4 = addVectorGroup(doc4, vg4, pn4);

    const req4A = await sendChatRequest({
      message: 'deixa com 60 mm de largura proporcional, centraliza e ajusta a prancheta com 3 mm de margem',
      doc: doc4,
      selectedNodeId: vg4.id,
    });

    console.log('P1-02 req4A HTTP:', req4A.status);
    console.log('P1-02 req4A reply:', req4A.json.reply);
    const finalDoc4A = req4A.json.doc;
    const vgFinal4A = finalDoc4A?.nodes?.[vg4.id];

    const p1_02_pass =
      req4A.status === 200 &&
      vgFinal4A &&
      Math.abs(vgFinal4A.physicalWidth_mm - 60) < 1.0 &&
      finalDoc4A.dimensions.width_mm === 66 &&
      finalDoc4A.dimensions.height_mm === 66;

    console.log(`P1-02 TESTE A (width=60, artboard=66x66): ${p1_02_pass ? 'PASS ✓' : 'FAIL ✗'}`);
    if (!p1_02_pass) throw new Error('P1-02 reprovado');

    // ----------------------------------------------------
    // TESTE 5: P1-03 — AUTOFIX OPERATIONAL TRUTH
    // ----------------------------------------------------
    console.log('\n--- 5. P1-03: AUTOFIX OPERATIONAL TRUTH ---');
    let doc5 = createDocument({ width_mm: 100, height_mm: 100 });
    doc5.profileId = 'generic-sticker';

    const req5 = await sendChatRequest({
      message: 'arruma isso',
      doc: doc5,
    });

    console.log('P1-03 req5 HTTP:', req5.status);
    console.log('P1-03 reply:', req5.json.reply);

    const p1_03_pass =
      req5.status === 200 &&
      req5.json.reply.includes('Nenhuma correção automática e segura estava disponível') &&
      !req5.json.reply.includes('aplicada com sucesso');

    console.log(`P1-03 STATUS: ${p1_03_pass ? 'PASS ✓' : 'FAIL ✗'}`);
    if (!p1_03_pass) throw new Error('P1-03 reprovado');

    // ----------------------------------------------------
    // TESTE 6: REGRESSÕES RÁPIDAS (RIP_CONTROLLED)
    // ----------------------------------------------------
    console.log('\n--- 6. REGRESSÕES RÁPIDAS (RIP_CONTROLLED) ---');
    let doc6 = createDocument({ width_mm: 100, height_mm: 100 });
    doc6.profileId = 'dtf-uv';
    doc6.productionSettings = {
      ...doc6.productionSettings,
      dtfUv: {
        whiteUnderbasePolicy: 'RIP_CONTROLLED',
        clearVarnishMode: 'DISABLED',
      },
    };
    const { groupNode: vg6, pathNodes: pn6 } = buildVectorGroupFromSvg({
      svgString,
      name: 'DTF RIP Test',
      physicalWidth_mm: 50,
      physicalHeight_mm: 50,
      position_mm: { x: 10, y: 10 },
    });
    doc6 = addVectorGroup(doc6, vg6, pn6);

    const req6 = await sendChatRequest({
      message: 'prepara isso para dtf uv',
      doc: doc6,
      selectedNodeId: vg6.id,
    });

    console.log('Regressões req6 HTTP:', req6.status);
    console.log('Regressões reply:', req6.json.reply);
    const finalDoc6 = req6.json.doc;
    const hasFictitiousWhite = Boolean(finalDoc6?.separations?.white || finalDoc6?.separations?.WHITE);

    const reg_pass = req6.status === 200 && !hasFictitiousWhite;
    console.log(`REGRESSÕES STATUS: ${reg_pass ? 'PASS ✓' : 'FAIL ✗'}`);
    if (!reg_pass) throw new Error('Regressões reprovadas');

    // ----------------------------------------------------
    // TESTE 7: ESTABILIDADE (/health)
    // ----------------------------------------------------
    console.log('\n--- 7. ESTABILIDADE ---');
    const healthRes = await fetch(`${PROD_URL}/health`);
    const healthJson = await healthRes.json();
    console.log('Healthcheck status:', healthRes.status, healthJson);

    const stab_pass = healthRes.status === 200 && healthJson.status === 'ok';
    console.log(`ESTABILIDADE STATUS: ${stab_pass ? 'PASS ✓' : 'FAIL ✗'}`);
    if (!stab_pass) throw new Error('Estabilidade reprovada');

  } catch (err: any) {
    console.error('\nFALHA DURANTE A HOMOLOGAÇÃO:', err.message);
    process.exit(1);
  }

  console.log('\n==================================================');
  console.log('TODOS OS TESTES DE HOMOLOGAÇÃO FORAM APROVADOS! ✓');
  console.log('==================================================');
}

runHomologation();
