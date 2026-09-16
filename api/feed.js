import { supabase, supabaseComoUsuario, getUsuarioFromRequest } from '../lib/supabaseClient.js'
import {
  buscarNaoVistas,
  salvarNoticia,
  ultimaBuscaFonte,
  marcarBuscaFonte,
  cacheEstaFresco
} from '../lib/redisClient.js'
import { buscarFonte } from '../lib/rss.js'

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
        await Promise.all(noticias.map((n) => salvarNoticia(n)))
        await marcarBuscaFonte(fonte.id)
      })
    )

    // 3. Busca o próximo lote de notícias que esse usuário ainda não viu
    const candidatas = await buscarNaoVistas({ usuarioId: usuario?.id, limite: 90, offset: offsetNum })
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
    function casaComTag(noticia, tagBusca) {
      const categoria = normalizar(categoriaPorFonte.get(noticia.fonteId) || '')
      const texto = normalizar(`${noticia.titulo} ${noticia.resumo}`.toLowerCase())
      const tagNormalizada = normalizar(tagBusca)
      return categoria === tagNormalizada || texto.includes(tagNormalizada)
    }

    if (tag) {
      const tagBusca = tag.toLowerCase()
      resultado = resultado.filter((n) => casaComTag(n, tagBusca))
    } else if (tagsDoUsuario.length > 0) {
      resultado = resultado.filter((n) => tagsDoUsuario.some((t) => casaComTag(n, t)))
    }
    // se o usuário não tem nenhuma tag cadastrada ainda, não tem o que filtrar —
    // mostra tudo mesmo, pra não deixar o feed vazio antes de ele configurar interesses

    const lote = resultado.slice(0, 30)

    return res.status(200).json({ noticias: lote })
  } catch (err) {
    console.error('[roxnews] erro em /api/feed:', err)
    return res.status(500).json({ erro: 'falha ao montar o feed' })
  }
}
