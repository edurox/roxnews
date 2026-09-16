import { redis, retirarLoteSemThumb, atualizarImagemNoticia, cacheBuscaImagem, cotaIAExcedida, registrarUsoIA } from '../lib/redisClient.js'
import { buscarImagemPorQuery, queryHeuristicaDoTitulo } from '../lib/buscaImagem.js'
import { gerarQueryImagem } from '../lib/ia/gerarQueryImagem.js'

const TAMANHO_LOTE_PADRAO = 8
const LIMITE_LOTE_MAXIMO = 20
const COTA_IA_DIARIA = Number(process.env.COTA_IA_DIARIA || 300)

// Resolve a thumb de UMA notícia já enfileirada, tentando nessa ordem:
// cache de busca -> IA (se dentro da cota) -> heurística -> nada.
// Sempre atualiza o hash no Redis, inclusive quando não achou nada, porque
// atualizarImagemNoticia só mexe nos campos de imagem — não reseta o TTL
// nem o resto da notícia.
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
      continue // cache negativo — já sabemos que essa query não dá em nada
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

  // nada deu certo — não reenfileira; o card continua com favicon até que
  // uma próxima passagem (se você rodar o processador de novo manualmente
  // sobre esse id) tente de novo. Evita loop infinito de retrabalho.
  return { id, resultado: 'nenhuma imagem encontrada' }
}

export default async function handler(req, res) {
  // protege o endpoint: só quem tem o segredo (cron da Vercel ou você
  // manualmente) pode disparar isso, senão qualquer um esvazia sua fila
  const segredoEsperado = process.env.CRON_SECRET
  const autorizacao = req.headers['authorization']
  if (segredoEsperado && autorizacao !== `Bearer ${segredoEsperado}`) {
    return res.status(401).json({ erro: 'não autorizado' })
  }

  const quantidade = Math.min(Number(req.query.quantidade) || TAMANHO_LOTE_PADRAO, LIMITE_LOTE_MAXIMO)

  try {
    const ids = await retirarLoteSemThumb(quantidade)
    const resultados = []
    // sequencial de propósito: cada item pode chamar a API de IA, e
    // paralelizar isso só aumenta a chance de tomar 429 de todo mundo junto
    for (const id of ids) {
      resultados.push(await resolverThumb(id))
    }

    return res.status(200).json({ processados: resultados.length, resultados })
  } catch (err) {
    console.error('[roxnews] erro em /api/enriquecer-thumbs:', err)
    return res.status(500).json({ erro: 'falha ao processar fila de thumbs' })
  }
}
