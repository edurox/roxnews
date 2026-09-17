import { validarImagem } from './validarImagem.js'
import { imagemPareceGenericaPeloNome } from './imagemGenerica.js'
import { imagemEhPequenaDemais } from './dimensaoImagem.js'
import { contarUsoImagemPorFonte } from './redisClient.js'

// Filtros RÁPIDOS: nome do arquivo (regex, de graça) + validarImagem (HEAD —
// content-type e tamanho em bytes) + reuso pela mesma fonte (1 round-trip no
// Redis). Nenhum baixa o CORPO da imagem — seguro rodar de forma síncrona
// dentro do request de /api/feed pra toda notícia nova, sem risco de travar
// a resposta mesmo com muitas fontes stale de uma vez.
export async function imagemPassaChecagensRapidas(url, fonteId) {
  if (!url) return false
  if (imagemPareceGenericaPeloNome(url)) return false
  if (!(await validarImagem(url))) return false
  const usos = await contarUsoImagemPorFonte(fonteId, url)
  return usos <= 1
}

// Checagem COMPLETA: tudo acima + dimensão REAL da imagem (baixa uns KB de
// verdade pra medir largura/altura). Esse último passo é o mais caro dos
// quatro filtros — por isso só roda em background (fila de enriquecimento,
// api/processarFilaThumbs.js), nunca inline no request de /api/feed. Rodar
// isso pra toda notícia nova, sincronamente, foi o que causou
// FUNCTION_INVOCATION_TIMEOUT quando testamos.
export async function imagemEhAceitavel(url, fonteId) {
  if (!(await imagemPassaChecagensRapidas(url, fonteId))) return false
  if (await imagemEhPequenaDemais(url)) return false
  return true
}
