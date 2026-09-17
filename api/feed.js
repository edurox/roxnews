import { supabase, supabaseComoUsuario, getUsuarioFromRequest } from '../lib/supabaseClient.js'
import {
  buscarNaoVistas,
  buscarNoticiasPorIds,
  salvarNoticia,
  ultimaBuscaFonte,
  marcarBuscaFonte,
  cacheEstaFresco,
  enfileirarSemThumb,
  idDaNoticia,
  tentarAdquirirLockOportunista,
  contarUsoImagemPorFonte
} from '../lib/redisClient.js'
import { buscarFonte } from '../lib/rss.js'
import { limitarConcorrencia } from '../lib/limitarConcorrencia.js'
import { processarLoteFilaThumbs, resolverThumbsAoVivo } from '../lib/processarFilaThumbs.js'
import { imagemPassaChecagensRapidas } from '../lib/imagemEhAceitavel.js'
import { idiomaPermitido } from '../lib/filtroIdioma.js'

const CONCORRENCIA_OG_IMAGE = 5
const LOTE_ENRIQUECIMENTO_OPORTUNISTA = 2

const TAMANHO_LOTE = 30
const MAX_POR_FONTE_NO_LOTE = 8

// Teto de tempo pra resolução AO VIVO de thumbs dentro deste request (ver
// resolverThumbsAoVivo em lib/processarFilaThumbs.js). Separado do
// ORCAMENTO_OPORTUNISTA_MS (que é pro processamento "de carona" da fila de
// fundo) porque este aqui é o caminho PRINCIPAL agora: resolve exatamente as
// notícias que estão prestes a fechar a página atual, não a fila inteira.
const ORCAMENTO_RESOLUCAO_AO_VIVO_MS = 15_000

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ erro: 'method not allowed' })
  }

  const inicioRequest = Date.now()
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

            // Fase 1 (só o RÁPIDO, dentro do request): aceita a imagem do
            // RSS se ela passar nome-de-arquivo + HEAD + reuso pela fonte —
            // nenhum desses baixa o corpo da imagem, então é seguro rodar
            // pra toda notícia nova sem arriscar travar a resposta.
            //
            // og:image e a checagem de dimensão REAL (que baixa uns KB de
            // verdade) foram tirados de aqui de propósito: rodar isso
            // inline, pra toda notícia nova, foi o que causou
            // FUNCTION_INVOCATION_TIMEOUT. Quem não passa aqui vai pra
            // fila:sem-thumb e é resolvido em background — og:image
            // primeiro, heurística/IA depois — em lib/processarFilaThumbs.js.
            await limitarConcorrencia(
              noticias.map((n) => async () => {
                if (n.imagemUrl && (await imagemPassaChecagensRapidas(n.imagemUrl, fonte.id))) {
                  n.imagemFonte = 'rss'
                  return
                }
                n.imagemUrl = null
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

      // 3. Busca notícias que esse usuário ainda não viu, ATÉ juntar um lote
      //    cheio de gente que já tem imagem — em vez de pegar só uma janela
      //    fixa e devolver uma página fina quando o topo do feed (mais
      //    recente) tem muita notícia ainda sem thumb.
      //
      //    Quem não tem imagem AINDA não é descartado nem pulado: é
      //    resolvido AO VIVO aqui mesmo (ver resolverThumbsAoVivo em
      //    lib/processarFilaThumbs.js), porque essas são exatamente as
      //    notícias prestes a entrar nesta página — vale a pena gastar
      //    tempo com elas, ao contrário de pré-processar a fila inteira em
      //    background sem saber o que vai ser visto. O scroll do usuário dá
      //    folga de sobra pro tempo que isso leva.
      //
      //    Só quem realmente não resolveu dentro do orçamento desta leva
      //    (ORCAMENTO_RESOLUCAO_AO_VIVO_MS) fica de fora — e nesse caso cai
      //    na fila:sem-thumb como rede de segurança/retry (cron ou uma
      //    leva ao vivo futura pegam de novo), não é perdido. Quem ficou de
      //    fora aqui NÃO é marcado como visto (isso só acontece quando o
      //    client renderiza o card de verdade, via api/vistas.js) — só não
      //    entra NESSE offset; reaparece normalmente numa varredura futura
      //    do ZSET assim que tiver imagem.
      //
      //    MAX_TENTATIVAS limita quantas rodadas de busca fazemos: cada
      //    rodada envolve leitura no Redis mais, no pior caso, uma leva de
      //    resolução ao vivo — por isso também checamos o orçamento total do
      //    request entre rodadas, pra nunca estourar o maxDuration da
      //    function por acumular rodada atrás de rodada.
      // 3a. Filtro por tag: categoria fixa da fonte OU palavra-chave livre no título/resumo.
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

      // Usada dentro do laço de backfill abaixo — precisa decidir "essa notícia
      // sobrevive ao filtro de tag?" ANTES de decidirmos se já juntamos lote
      // suficiente, senão o laço para cedo demais (ver comentário grande do
      // laço logo abaixo).
      function passaFiltroTag(noticia) {
        if (tag) {
          return casaComTag(noticia, tag.toLowerCase())
        }
        if (tagsDoUsuario.length > 0) {
          return tagsDoUsuario.some((t) => casaComTag(noticia, t))
        }
        // sem tag específica e sem tags cadastradas: não tem o que filtrar —
        // mostra tudo mesmo, pra não deixar o feed vazio antes de configurar interesses
        return true
      }

      const MAX_TENTATIVAS_BACKFILL = 6
      const ORCAMENTO_TOTAL_BACKFILL_MS = 18_000

      let offsetAtual = offsetNum
      let candidatasProntas = []
      let proximoOffset = offsetNum
      let esgotado = false

      for (let tentativa = 0; tentativa < MAX_TENTATIVAS_BACKFILL; tentativa++) {
        if (Date.now() - inicioRequest > ORCAMENTO_TOTAL_BACKFILL_MS) break

          const pagina = await buscarNaoVistas({
            usuarioId: usuario?.id,
            limite: 90,
            offset: offsetAtual
          })

          proximoOffset = pagina.proximoOffset
          esgotado = pagina.esgotado

          // O filtro de tag entra JUNTO com fonte bloqueada e idioma, aqui dentro
          // do laço — não depois que o laço já decidiu que tem lote suficiente.
          // Se filtrássemos só depois (como era antes), o laço parava assim que
          // achasse 30 notícias com imagem de QUALQUER assunto, descartava a
          // maioria no filtro de tag, e nunca voltava a buscar mais fundo no
          // Redis pra compensar — é isso que fazia uma tag como "tech" mostrar
          // só 10-15 notícias mesmo tendo dezenas no Redis: o laço já tinha
          // desistido de buscar antes do filtro de tag entrar em ação.
          const elegiveis = pagina.noticias.filter(
            (n) => !idsBloqueados.has(n.fonteId) && idiomaPermitido(n) && passaFiltroTag(n)
          )

          const comImagem = elegiveis.filter((n) => n.imagemUrl)
          const semImagem = elegiveis.filter((n) => !n.imagemUrl)

          candidatasProntas.push(...comImagem)

          // só resolve ao vivo o suficiente pra fechar o lote (com uma margem,
          // já que nem toda tentativa de resolução acha imagem) — não gasta
          // tempo/cota de IA resolvendo notícia que nem vai entrar na página
          const faltam = TAMANHO_LOTE - candidatasProntas.length
          const orcamentoRestante = ORCAMENTO_RESOLUCAO_AO_VIVO_MS - (Date.now() - inicioRequest)

          if (faltam > 0 && semImagem.length > 0 && orcamentoRestante > 0) {
            const paraResolver = semImagem.slice(0, faltam * 2)
            await resolverThumbsAoVivo(
              paraResolver.map((n) => n.id),
                                       orcamentoRestante
            )

            // recarrega do Redis pra pegar o imagemUrl que acabou de ser
            // gravado por resolverThumbsAoVivo (a notícia em `semImagem` ainda
            // tem o snapshot de antes da resolução)
            const relidas = await buscarNoticiasPorIds(paraResolver.map((n) => n.id))
            candidatasProntas.push(...relidas.filter((n) => n && n.imagemUrl))
          }

          offsetAtual = proximoOffset

          if (esgotado || candidatasProntas.length >= TAMANHO_LOTE) break
      }

      // resultado já sai filtrado por fonte bloqueada + idioma + tag, porque
      // esses três critérios agora entram dentro do laço de backfill acima
      // (ver passaFiltroTag) — é isso que garante que o laço só para quando
      // realmente juntou notícias suficientes que sobrevivem a todos os filtros.
      const resultado = candidatasProntas

      // 4. Dilui E intercala fontes — evita tanto uma fonte muito ativa
      //    tomar o lote inteiro (teto por fonte) quanto várias notícias
      //    seguidas da mesma fonte aparecerem juntas no feed (round-robin).
      //
      //    `resultado` já vem ordenado por recência (mais nova primeiro).
      //    Group by fonteId preserva essa ordem DENTRO de cada grupo. O
      //    round-robin pega a próxima notícia de cada fonte por vez, na
      //    ordem em que as fontes apareceram pela primeira vez em
      //    `resultado` (ou seja, a fonte com a notícia mais recente joga
      //    primeiro a cada rodada) — assim o feed continua favorecendo o
      //    que é mais novo no geral, só sem empilhar a mesma fonte.
      function diluirEIntercalarPorFonte(lista, maxPorFonte, tamanhoLote) {
        const porFonte = new Map()

        for (const noticia of lista) {
          let grupo = porFonte.get(noticia.fonteId)
          if (!grupo) {
            grupo = []
            porFonte.set(noticia.fonteId, grupo)
          }
          if (grupo.length < maxPorFonte) grupo.push(noticia)
        }

        const ordemFontes = [...porFonte.keys()]
        const intercalado = []

        for (let indice = 0; intercalado.length < tamanhoLote; indice++) {
          let adicionouAlgo = false
          for (const fonteId of ordemFontes) {
            const grupo = porFonte.get(fonteId)
            if (indice < grupo.length) {
              intercalado.push(grupo[indice])
              adicionouAlgo = true
              if (intercalado.length >= tamanhoLote) break
            }
          }
          // nenhuma fonte tinha mais nada nessa rodada — todas as fontes
          // esgotaram o próprio teto/estoque, não tem mais o que intercalar
          if (!adicionouAlgo) break
        }

        return intercalado
      }

      const lote = diluirEIntercalarPorFonte(resultado, MAX_POR_FONTE_NO_LOTE, TAMANHO_LOTE)

      // Enriquecimento oportunista: agora é só uma rede de segurança extra
      // pra escoar fila:sem-thumb (itens que a resolução ao vivo acima não
      // deu conta a tempo, ou notícia que ninguém pediu recentemente) — o
      // caminho principal de resolver thumb passou a ser a resolução AO VIVO
      // do passo 3, não este bloco. Continua isolado em try/catch próprio:
      // se falhar, isso NUNCA pode derrubar a resposta do feed em si.
      //
      // Usa só o tempo que sobrou dentro de um teto global do request
      // (ORCAMENTO_TOTAL_REQUEST_MS), nunca um orçamento fixo próprio — é
      // isso que evita somar com a resolução ao vivo e estourar os 30s de
      // maxDuration da function.
      const ORCAMENTO_TOTAL_REQUEST_MS = 26_000
      const orcamentoOportunista = ORCAMENTO_TOTAL_REQUEST_MS - (Date.now() - inicioRequest)

      if (orcamentoOportunista > 1_000) {
        try {
          if (await tentarAdquirirLockOportunista()) {
            await Promise.race([
              processarLoteFilaThumbs(LOTE_ENRIQUECIMENTO_OPORTUNISTA),
                               new Promise((resolve) => setTimeout(resolve, orcamentoOportunista))
            ])
          }
        } catch (err) {
          console.error('[roxnews] enriquecimento oportunista falhou (feed segue normal):', err.message)
        }
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
