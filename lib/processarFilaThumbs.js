import { redis, atualizarImagemNoticia, cacheBuscaImagem, cotaIAExcedida, registrarUsoIA, retirarLoteSemThumb } from './redisClient.js'
import { buscarImagemPorQuery, queryHeuristicaDoTitulo } from './buscaImagem.js'
import { gerarQueryImagem } from './ia/gerarQueryImagem.js'

const COTA_IA_DIARIA = Number(process.env.COTA_IA_DIARIA || 300)

// Resolve a thumb de UMA notícia já enfileirada, tentando nessa ordem:
// cache de busca -> IA (se dentro da cota) -> heurística -> nada.
async function resolverThumb(id) {
  const dados = await redis.hgetall(`noticia:${id}`)
  if (!dados) return { id, resultado: 'notícia expirou' }
  if (dados.imagemUrl) return { id, resultado: 'já tinha imagem (corrida com outro processo)' }

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

// Tira até `quantidade` ids da fila e resolve um por um. Sequencial de
// propósito: cada item pode chamar a API de IA, e paralelizar isso só
// aumenta a chance de tomar 429 de todo mundo junto.
export async function processarLoteFilaThumbs(quantidade) {
  const ids = await retirarLoteSemThumb(quantidade)
  const resultados = []
  for (const id of ids) {
    resultados.push(await resolverThumb(id))
  }
  return resultados
}
