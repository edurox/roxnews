import {
  redis,
  atualizarImagemNoticia,
  cacheBuscaImagem,
  cotaIAExcedida,
  registrarUsoIA,
  retirarLoteSemThumb,
  enfileirarSemThumb
} from './redisClient.js'
import { buscarImagemPorQuery, queryHeuristicaDoTitulo } from './buscaImagem.js'
import { gerarQueryImagem } from './ia/gerarQueryImagem.js'
import { buscarOgImage } from './ogImage.js'
import { imagemEhAceitavel } from './imagemEhAceitavel.js'

const COTA_IA_DIARIA = Number(process.env.COTA_IA_DIARIA || 300)

// Resolve a thumb de UMA notícia já enfileirada, tentando nessa ordem:
// og:image da página (o campo que o PRÓPRIO site marca como imagem oficial
// do artigo) -> cache de busca -> IA (se dentro da cota) -> heurística ->
// nada. og:image entra primeiro e roda aqui (fora do request de
// /api/feed) de propósito: envolve baixar a página inteira e depois uns KB
// da imagem pra medir dimensão — caro o bastante pra ter causado
// FUNCTION_INVOCATION_TIMEOUT quando rodava inline pra toda notícia nova.
async function resolverThumb(id) {
  const dados = await redis.hgetall(`noticia:${id}`)
  if (!dados) return { id, resultado: 'notícia expirou' }
  if (dados.imagemUrl) return { id, resultado: 'já tinha imagem (corrida com outro processo)' }

  const og = await buscarOgImage(dados.link)
  if (og && (await imagemEhAceitavel(og, dados.fonteId))) {
    await atualizarImagemNoticia(id, {
      imagemUrl: og,
      imagemFonte: 'og',
      imagemPaginaOrigem: dados.link
    })
    return { id, resultado: 'achou via og:image' }
  }

  let queries = null
  let sensivel = false

  const cotaEstourada = await cotaIAExcedida(COTA_IA_DIARIA)
  if (!cotaEstourada) {
    const geradas = await gerarQueryImagem({
      titulo: dados.titulo,
      resumo: dados.resumo,
      fonteNome: dados.fonteNome
    })
    if (geradas) {
      await registrarUsoIA()
      queries = geradas.queries
      sensivel = geradas.sensivel
    }
  }

  if (sensivel) {
    await atualizarImagemNoticia(id, { imagemFonte: 'sem-busca-sensivel' })
    return { id, resultado: 'sensível — sem busca automática' }
  }

  if (!queries || queries.length === 0) {
    const heuristica = queryHeuristicaDoTitulo(dados.titulo)
    queries = heuristica ? [heuristica] : []
  }

  for (const query of queries) {
    const cacheado = await cacheBuscaImagem.ler(query)
    if (cacheado !== undefined) {
      if (cacheado) {
        await atualizarImagemNoticia(id, {
          imagemUrl: cacheado.url,
          imagemFonte: 'ia',
          imagemPaginaOrigem: cacheado.paginaOrigem,
          imagemAutor: cacheado.autor,
          imagemLicenca: cacheado.licenca
        })
        return { id, resultado: `achou via cache (query: ${query})` }
      }
      continue
    }

    const achada = await buscarImagemPorQuery(query)
    await cacheBuscaImagem.gravar(query, achada)

    if (achada) {
      await atualizarImagemNoticia(id, {
        imagemUrl: achada.url,
        imagemFonte: 'ia',
        imagemPaginaOrigem: achada.paginaOrigem,
        imagemAutor: achada.autor,
        imagemLicenca: achada.licenca
      })
      return { id, resultado: `achou (query: ${query})` }
    }
  }

  return { id, resultado: 'nenhuma imagem encontrada' }
}

// Deixa margem dentro do maxDuration de 30s configurado em vercel.json.
// Cada item agora pode envolver 2 requests de rede reais (og:image da
// página + os KB da imagem pra medir dimensão) além da chamada de IA/busca
// — então nem sempre cabe processar o lote inteiro dentro do orçamento.
const ORCAMENTO_MS = 25_000

// Tira até `quantidade` ids da fila e resolve um por um. Sequencial de
// propósito: cada item pode chamar a API de IA, e paralelizar isso só
// aumenta a chance de tomar 429 de todo mundo junto.
//
// Verifica o orçamento de tempo ANTES de começar cada item (nunca no meio
// de um — cada resolverThumb já tem seus próprios timeouts internos que
// limitam o pior caso de UM item). Se estourar, devolve pra fila os ids que
// ainda não foram processados, em vez de descartar silenciosamente — a
// próxima chamada (outro request oportunista, ou o cron) continua de onde
// parou.
export async function processarLoteFilaThumbs(quantidade) {
  const inicio = Date.now()
  const ids = await retirarLoteSemThumb(quantidade)
  const resultados = []

  for (let i = 0; i < ids.length; i++) {
    if (Date.now() - inicio > ORCAMENTO_MS) {
      await Promise.all(ids.slice(i).map(enfileirarSemThumb))
      resultados.push({
        id: null,
        resultado: `parou em ${i}/${ids.length} por orçamento de tempo — resto devolvido pra fila`
      })
      break
    }
    resultados.push(await resolverThumb(ids[i]))
  }

  return resultados
}
