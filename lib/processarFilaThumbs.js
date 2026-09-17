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
import { limitarConcorrencia } from './limitarConcorrencia.js'

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

// ---------------------------------------------------------------------------
// Resolução AO VIVO, dentro do próprio request de /api/feed — em vez de
// pré-processar a fila inteira em background e torcer pro cron/oportunista
// darem conta do volume, resolve só o que está prestes a ser mostrado nesta
// página. O scroll do usuário dá folga de sobra: cada card fica visível por
// segundos, tempo de sobra pra terminar uma busca de imagem que leva no
// máximo TIMEOUT_ITEM_AO_VIVO_MS.
//
// Paraleliza (CONCORRENCIA_RESOLUCAO_AO_VIVO por vez) porque aqui, ao
// contrário do cron, o número de itens é pequeno (só o necessário pra fechar
// uma página) — o risco de 429 em cascata na IA é bem menor que paralelizar
// a fila inteira.
//
// Cada item tem um teto de tempo individual: se estourar, não trava os
// outros nem a resposta — o item só não entra nesta leva e volta pra
// fila:sem-thumb, que passa a servir de rede de segurança/retry em vez de
// caminho principal. (Os fetches em andamento não são de fato abortados,
// só paramos de esperar por eles — mas isso é aceitável: não seguram a
// resposta, e o resultado deles, se chegar depois, é descartado.)
const TIMEOUT_ITEM_AO_VIVO_MS = 9_000
const CONCORRENCIA_RESOLUCAO_AO_VIVO = 6

export async function resolverThumbsAoVivo(ids, orcamentoMs) {
  const inicio = Date.now()
  const resolvidos = []

  await limitarConcorrencia(
    ids.map((id) => async () => {
      // orçamento global também: se já estourou o tempo total dado a essa
      // leva, nem começa mais itens novos — só devolve pra fila
      if (Date.now() - inicio > orcamentoMs) {
        await enfileirarSemThumb(id)
        resolvidos.push({ id, ok: false, resultado: 'sem tempo nesta leva' })
        return
      }

      const resultado = await Promise.race([
        resolverThumb(id).then((r) => ({ ...r, ok: true })),
        new Promise((resolve) =>
          setTimeout(() => resolve({ id, ok: false, resultado: 'timeout ao vivo' }), TIMEOUT_ITEM_AO_VIVO_MS)
        )
      ])

      if (!resultado.ok) {
        await enfileirarSemThumb(id)
      }
      resolvidos.push(resultado)
    }),
    CONCORRENCIA_RESOLUCAO_AO_VIVO
  )

  return resolvidos
}
