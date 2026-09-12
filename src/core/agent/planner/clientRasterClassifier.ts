/**
 * Prexyon Agent — Client Raster Classifier
 *
 * Classifica a intenção do usuário para pré-execução de operações raster
 * no lado do cliente (Client Raster Bridge) antes de enviar o payload para a API server-side.
 */

export interface ClientRasterIntents {
  wantsVectorize: boolean;
  wantsCutOrVectorize: boolean;
  wantsRemoveBg: boolean;
  wantsWhiteUnderbase: boolean;
  wantsClearArtwork: boolean;
}

/**
 * Classifica intenções raster do cliente com vocabulário expandido em português.
 */
export function detectClientRasterIntents(message: string): ClientRasterIntents {
  if (!message || typeof message !== 'string') {
    return {
      wantsVectorize: false,
      wantsCutOrVectorize: false,
      wantsRemoveBg: false,
      wantsWhiteUnderbase: false,
      wantsClearArtwork: false,
    };
  }

  const textLower = message.toLowerCase().trim();

  const wantsVectorize =
    textLower.includes('vetor') ||
    textLower.includes('vector') ||
    textLower.includes('vetoriz') ||
    textLower.includes('vectoriz') ||
    textLower.includes('converter em vetor') ||
    textLower.includes('converter para vetor') ||
    textLower.includes('transforme em vetor') ||
    textLower.includes('transformar em vetor') ||
    textLower.includes('converta em vetor') ||
    textLower.includes('converte em curvas') ||
    textLower.includes('convertem em curvas') ||
    textLower.includes('passa em curvas') ||
    textLower.includes('passar em curvas') ||
    textLower.includes('faz o traçado') ||
    textLower.includes('faz o traco') ||
    textLower.includes('fazer o traçado') ||
    textLower.includes('fazer o traco') ||
    textLower.includes('traça essa logo') ||
    textLower.includes('traca essa logo') ||
    textLower.includes('traçar logo') ||
    textLower.includes('tracar logo') ||
    textLower.includes('traçar') ||
    textLower.includes('tracar') ||
    textLower.includes('faz a silhueta') ||
    textLower.includes('fazer a silhueta') ||
    textLower.includes('gerar vetor') ||
    textLower.includes('gere vetor');

  const wantsCutOrVectorize =
    wantsVectorize ||
    textLower.includes('faca') ||
    textLower.includes('corte') ||
    textLower.includes('sangria') ||
    textLower.includes('contorno') ||
    textLower.includes('adesivo') ||
    (textLower.includes('prepare') && textLower.includes('produção')) ||
    (textLower.includes('prepare') && textLower.includes('producao'));

  const wantsRemoveBg =
    textLower.includes('remove o fundo') ||
    textLower.includes('remover fundo') ||
    textLower.includes('remover o fundo') ||
    textLower.includes('remove fundo') ||
    textLower.includes('tira o fundo') ||
    textLower.includes('tira fundo') ||
    textLower.includes('tira o branco de trás') ||
    textLower.includes('tira o branco de tras') ||
    textLower.includes('deixa o fundo transparente') ||
    textLower.includes('deixar fundo transparente') ||
    textLower.includes('fundo transparente') ||
    textLower.includes('apaga o fundo') ||
    textLower.includes('apagar o fundo') ||
    textLower.includes('apaga fundo') ||
    textLower.includes('limpa o fundo') ||
    textLower.includes('limpar o fundo') ||
    textLower.includes('limpa fundo') ||
    textLower.includes('deleta o fundo') ||
    textLower.includes('deletar o fundo') ||
    textLower.includes('deleta fundo') ||
    textLower.includes('sem fundo') ||
    textLower.includes('sem o fundo');

  const wantsWhiteUnderbase =
    textLower.includes('branco por baixo') ||
    textLower.includes('base branca') ||
    textLower.includes('cria o branco') ||
    textLower.includes('criar o branco') ||
    textLower.includes('gerar branco') ||
    textLower.includes('gere o branco') ||
    textLower.includes('camada de branco') ||
    textLower.includes('camada branca') ||
    textLower.includes('passa branco') ||
    textLower.includes('coloca branco');

  const wantsClearArtwork =
    textLower.includes('verniz só na arte') ||
    textLower.includes('verniz so na arte') ||
    textLower.includes('clear artwork') ||
    textLower.includes('verniz somente onde') ||
    textLower.includes('verniz na arte') ||
    textLower.includes('verniz sobre a arte');

  return {
    wantsVectorize,
    wantsCutOrVectorize,
    wantsRemoveBg,
    wantsWhiteUnderbase,
    wantsClearArtwork,
  };
}
