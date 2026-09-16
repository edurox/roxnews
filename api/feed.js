import { supabase, supabaseComoUsuario, getUsuarioFromRequest } from '../lib/supabaseClient.js'
import {
  buscarNaoVistas,
  salvarNoticia,
  ultimaBuscaFonte,
  marcarBuscaFonte,
  cacheEstaFresco,
  enfileirarSemThumb,
  idDaNoticia,
  tentarAdquirirLockOportunista
} from '../lib/redisClient.js'
import { buscarFonte } from '../lib/rss.js'
import { buscarOgImage } from '../lib/ogImage.js'
import { limitarConcorrencia } from '../lib/limitarConcorrencia.js'
import { processarLoteFilaThumbs } from '../lib/processarFilaThumbs.js'
import { validarImagem } from '../lib/validarImagem.js'

const CONCORRENCIA_OG_IMAGE = 5
const LOTE_ENRIQUECIMENTO_OPORTUNISTA = 2

const TAMANHO_LOTE = 30
const MAX_POR_FONTE_NO_LOTE = 4

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ erro: 'method not allowed' })
  }

  const { tag, offset } = req.query
  const offsetNum = Number(offset) || 0
  const { usuario, token } = await getUsuarioFromRequest(req)

  try {
    // 1. Descobre quais fontes participam (todo o catálogo ativo, menos as bloqueadas do usuário)
    const { data: fontes, error: erroFontes } = await supabase
    .from('fontes_rss')
    .select('*')
    .eq('ativo', true)

    if (erroFontes) throw erroFontes

      let idsBloqueados = new Set()
      let tagsDoUsuario = []
      let supabaseAuth = null
      if (usuario) {
        supabaseAuth = supabaseComoUsuario(token)
        const [
          { data: bloqueadas, error: erroBloqueadas },
          { data: tagsRows, error: erroTags }
        ] = await Promise.all([
          supabaseAuth.from('fontes_bloqueadas').select('fonte_id').eq('usuario_id', usuario.id),
                              supabaseAuth.from('tags_usuario').select('tag').eq('usuario_id', usuario.id)
        ])
        // Importante: erro de query aqui NÃO pode virar "usuário sem tags" —
        // isso mascarava token expirado/RLS/rede como se fosse "mostra tudo",
        // vazando conteúdo fora do filtro do usuário pro feed "tudo".
        if (erroBloqueadas) throw erroBloqueadas
          if (erroTags) throw erroTags

            idsBloqueados = new Set((bloqueadas || []).map((b) => b.fonte_id))
            tagsDoUsuario = (tagsRows || []).map((t) => t.tag.toLowerCase())
      }

      const fontesValidas = fontes.filter((f) => !idsBloqueados.has(f.id))

      // 2. Pra cada fonte, busca RSS só se o cache estiver velho
      await Promise.all(
        fontesValidas.map(async (fonte) => {
          const ultima = await ultimaBuscaFonte(fonte.id)
          if (cacheEstaFresco(ultima)) return

            const noticias = await buscarFonte(fonte)

            // Fase 1: valida a imagem que o RSS trouxe (enclosure/media/img
            // no corpo do post — esse último em especial pode ser qualquer
            // coisa: um badge, um avatar, um ícone quebrado no meio do
            // texto, não necessariamente uma capa de verdade). Quando não
            // passa na validação, tenta og:image da página de destino, que
            // é o campo que o próprio site escolheu como imagem oficial do
            // artigo — muito mais confiável que "primeira <img> do corpo".
            await limitarConcorrencia(
              noticias.map((n) => async () => {
                if (n.imagemUrl && (await validarImagem(n.imagemUrl))) return

                const og = await buscarOgImage(n.link)
                if (og) {
                  n.imagemUrl = og
                  n.imagemFonte = 'og'
                  n.imagemPaginaOrigem = n.link
                } else {
                  // nem o RSS nem og:image se sustentam — não deixa a URL
                  // ruim do RSS passar pro front pra não renderizar quebrada
                  n.imagemUrl = null
                }
              }),
              CONCORRENCIA_OG_IMAGE
            )

            await Promise.all(noticias.map((n) => salvarNoticia(n)))

            // quem continuar sem imagem depois do og:image vai pra fila da
            // Fase 2/3 (heurística e, se configurada, busca guiada por IA)
            await Promise.all(
              noticias
                .filter((n) => !n.imagemUrl)
                .map((n) => enfileirarSemThumb(idDaNoticia(n.link)))
            )

            await marcarBuscaFonte(fonte.id)
        })
      )

      // 3. Busca o próximo lote de notícias que esse usuário ainda não viu.
      //    proximoOffset é a posição real que o Redis varreu no ZSET — não é
      //    o tanto que sobrou depois dos filtros. É isso que devolvemos pro
      //    front usar na próxima chamada (ver comentário em buscarNaoVistas).
      const { noticias: candidatas, proximoOffset, esgotado } = await buscarNaoVistas({
        usuarioId: usuario?.id,
        limite: 90,
        offset: offsetNum
      })
      let resultado = candidatas.filter((n) => !idsBloqueados.has(n.fonteId))

      // 4. Filtro por tag: categoria fixa da fonte OU palavra-chave livre no título/resumo.
      //    Se veio uma tag específica, filtra só por ela. Se é "tudo" (sem tag),
      //    filtra por QUALQUER UMA das tags cadastradas do usuário — "tudo" não é
      //    um feed sem filtro nenhum, é a união de todos os seus interesses.
      // Remove acentos antes de comparar — categoria_padrao no banco às vezes
      // está sem acento (ex: 'programacao') enquanto a tag do usuário foi
      // salva como digitada na tela (ex: 'programação'). Sem isso, a comparação
      // exata falha e o match cai pro texto livre, que quase nunca acha a
      // palavra em português dentro de manchete/resumo em inglês.
      // Categoria é lida AQUI, ao vivo, da tabela fontes_rss — não do que foi
      // congelado dentro da notícia no Redis no momento do fetch do RSS. Isso
      // evita que um ajuste de categoria_padrao no Supabase fique "sem efeito"
      // até o TTL de 30 dias expirar ou a fonte ser buscada de novo.
      const categoriaPorFonte = new Map(
        fontes.map((f) => [f.id, (f.categoria_padrao || '').toLowerCase()])
      )

      function normalizar(s) {
        return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      }

      // Match por borda de palavra (\b), não por substring cru — evita que uma
      // tag curta (ex: "cco", "tech") case escondida dentro de outra palavra
      // ou abreviação do texto sem nenhuma relação real com o assunto.
      function casaComTag(noticia, tagBusca) {
        const categoria = normalizar(categoriaPorFonte.get(noticia.fonteId) || '')
        const texto = normalizar(`${noticia.titulo} ${noticia.resumo}`.toLowerCase())
        const tagNormalizada = normalizar(tagBusca)

        if (categoria === tagNormalizada) return true

          const escapada = tagNormalizada.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          const regex = new RegExp(`\\b${escapada}\\b`, 'i')
          return regex.test(texto)
      }

      if (tag) {
        const tagBusca = tag.toLowerCase()
        resultado = resultado.filter((n) => casaComTag(n, tagBusca))
      } else if (tagsDoUsuario.length > 0) {
        resultado = resultado.filter((n) => tagsDoUsuario.some((t) => casaComTag(n, t)))
      }
      // se o usuário não tem nenhuma tag cadastrada ainda, não tem o que filtrar —
      // mostra tudo mesmo, pra não deixar o feed vazio antes de ele configurar interesses

      // 5. Dilui fontes que publicam demais — evita que uma fonte muito ativa
      //    (ex: DEV Community) tome o lote inteiro só por volume de publicação.
      //    Mantém a ordem de recência dentro do que sobra; se faltar item pra
      //    fechar o lote (poucas fontes ativas nesse trecho), completa com o
      //    excedente pra não devolver menos notícia do que precisa.
      function diluirPorFonte(lista, maxPorFonte, tamanhoLote) {
        const contagem = new Map()
        const aceitas = []
        const excedentes = []

        for (const noticia of lista) {
          const atual = contagem.get(noticia.fonteId) || 0
          if (atual < maxPorFonte) {
            aceitas.push(noticia)
            contagem.set(noticia.fonteId, atual + 1)
          } else {
            excedentes.push(noticia)
          }
        }

        if (aceitas.length < tamanhoLote) {
          aceitas.push(...excedentes.slice(0, tamanhoLote - aceitas.length))
        }

        return aceitas.slice(0, tamanhoLote)
      }

      const lote = diluirPorFonte(resultado, MAX_POR_FONTE_NO_LOTE, TAMANHO_LOTE)

      // Enriquecimento oportunista: no plano Hobby da Vercel, cron só roda
      // 1x/dia (ver vercel.json), o que é lento demais pra escoar a fila de
      // thumbs. Em vez disso, processa um lotezinho aqui, "de carona" num
      // request normal — só quando ninguém mais pegou o lock nos últimos 20s.
      // Isolado em try/catch próprio: se a IA ou o provedor de imagem falhar,
      // isso NUNCA pode derrubar a resposta do feed em si.
      try {
        if (await tentarAdquirirLockOportunista()) {
          await processarLoteFilaThumbs(LOTE_ENRIQUECIMENTO_OPORTUNISTA)
        }
      } catch (err) {
        console.error('[roxnews] enriquecimento oportunista falhou (feed segue normal):', err.message)
      }

      // proximoOffset/esgotado vêm do Redis (posição real no ZSET), não do
      // tamanho do lote filtrado — é isso que deixa a paginação avançar de
      // verdade mesmo quando muita coisa é descartada nos filtros acima.
      return res.status(200).json({ noticias: lote, proximoOffset, esgotado })
  } catch (err) {
    console.error('[roxnews] erro em /api/feed:', err)
    return res.status(500).json({ erro: 'falha ao montar o feed' })
  }
}
