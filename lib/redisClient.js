import { Redis } from '@upstash/redis'
import { createHash } from 'crypto'

export const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN
})

// Id determinístico da notícia a partir do link — evita duplicar ao reprocessar o mesmo RSS.
export function idDaNoticia(link) {
  return createHash('sha1').update(link).digest('hex').slice(0, 16)
}

const TTL_NOTICIA_SEGUNDOS = 60 * 60 * 24 * 30 // 30 dias
const JANELA_CACHE_MINUTOS = 15
const CHAVE_FEED_GLOBAL = 'feed:global'

// Guarda uma notícia (hash) + índice no ZSET global, ordenado por data de publicação.
export async function salvarNoticia(noticia) {
  const id = idDaNoticia(noticia.link)
  const scoreMs = new Date(noticia.publicadoEm).getTime() || Date.now()

  await redis.hset(`noticia:${id}`, {
    titulo: noticia.titulo,
    resumo: noticia.resumo,
    imagemUrl: noticia.imagemUrl || '',
    // 'rss' | 'og' | 'ia' | 'favicon' | 'sem-busca-sensivel' — de onde veio a
    // thumb. Só 'ia' acende a flag de atribuição no card.
    imagemFonte: noticia.imagemFonte || (noticia.imagemUrl ? 'rss' : ''),
    // pra onde o toque na flag de atribuição abre: página do artigo (og) ou
    // página da foto no banco de imagens (ia)
    imagemPaginaOrigem: noticia.imagemPaginaOrigem || '',
    imagemAutor: noticia.imagemAutor || '',
    imagemLicenca: noticia.imagemLicenca || '',
    link: noticia.link,
    fonteId: noticia.fonteId,
    fonteNome: noticia.fonteNome,
    categoria: noticia.categoria || '',
    publicadoEm: noticia.publicadoEm,
      idioma: noticia.idioma
  })
  await redis.expire(`noticia:${id}`, TTL_NOTICIA_SEGUNDOS)
  await redis.zadd(CHAVE_FEED_GLOBAL, { score: scoreMs, member: id })

  return id
}

// Busca as N notícias mais recentes que o usuário ainda não viu.
//
// Devolve também `proximoOffset` e `esgotado`, porque o offset que entra aqui
// é uma posição CRUA no ZSET, mas o que sobrevive (noticias) pode ser bem
// menor depois que quem chamou filtra por fonte bloqueada, tag e diluição.
// Se o chamador usasse "quantas notícias sobraram na tela" como próximo
// offset (como a store fazia antes), a paginação avança mais devagar do que
// realmente examinou o ZSET, e acaba ficando presa reciclando pra sempre a
// mesma janela de itens perto do topo depois que eles são todos marcados
// como vistos — mesmo havendo muito mais notícia mais funda no Redis.
// `proximoOffset` é sempre `offset + quantidade de ids crus examinados`,
// então o cursor avança de verdade a cada chamada, não importa quanto foi
// descartado depois. `esgotado` só fica true quando o ZSET realmente não
// tem mais nada a partir dali (fim de fato do feed).
export async function buscarNaoVistas({ usuarioId, limite = 30, offset = 0 }) {
  // pega um lote maior de candidatas (mais recentes primeiro) pra filtrar as já vistas
  const candidatosIds = await redis.zrange(CHAVE_FEED_GLOBAL, '+inf', '-inf', {
    byScore: true,
    rev: true,
    offset,
    count: limite * 5
  })

  const proximoOffset = offset + candidatosIds.length
  const esgotado = candidatosIds.length === 0

  if (!candidatosIds.length) {
    return { noticias: [], proximoOffset, esgotado }
  }

  let idsNaoVistos = candidatosIds
  if (usuarioId) {
    const chaveVistas = `vistas:${usuarioId}`
    const pipeline = redis.pipeline()
    candidatosIds.forEach((id) => pipeline.sismember(chaveVistas, id))
    const resultadosVisto = await pipeline.exec()
    idsNaoVistos = candidatosIds.filter((_, i) => !resultadosVisto[i])
  }

  const idsFinais = idsNaoVistos.slice(0, limite)
  if (!idsFinais.length) {
    return { noticias: [], proximoOffset, esgotado }
  }

  const pipeline = redis.pipeline()
  idsFinais.forEach((id) => pipeline.hgetall(`noticia:${id}`))
  const resultados = await pipeline.exec()

  const noticias = resultados
  .map((noticia, i) => (noticia ? { id: idsFinais[i], ...noticia } : null))
  .filter(Boolean)

  return { noticias, proximoOffset, esgotado }
}

// Atualiza só os campos de imagem de uma notícia que já existe no Redis —
// usado pelo processador de fila (Fase 2/3), que resolve a thumb bem depois
// do RSS original ter sido salvo. hset em campos específicos não mexe no
// resto do hash nem reseta o TTL de 30 dias.
export async function atualizarImagemNoticia(id, { imagemUrl, imagemFonte, imagemPaginaOrigem, imagemAutor, imagemLicenca }) {
  const existe = await redis.exists(`noticia:${id}`)
  if (!existe) return false

  await redis.hset(`noticia:${id}`, {
    imagemUrl: imagemUrl || '',
    imagemFonte: imagemFonte || '',
    imagemPaginaOrigem: imagemPaginaOrigem || '',
    imagemAutor: imagemAutor || '',
    imagemLicenca: imagemLicenca || ''
  })
  return true
}

// Marca notícias como vistas por um usuário (chamado depois de servir um lote).
export async function marcarComoVistas(usuarioId, ids) {
  if (!usuarioId || !ids.length) return
    const chave = `vistas:${usuarioId}`
    await redis.sadd(chave, ...ids)
    await redis.expire(chave, TTL_NOTICIA_SEGUNDOS)
}

// Controle de "última busca" por fonte, pra decidir se serve do cache ou refaz o fetch do RSS.
export async function ultimaBuscaFonte(fonteId) {
  return redis.get(`fonte:${fonteId}:ultima_busca`)
}

export async function marcarBuscaFonte(fonteId) {
  await redis.set(`fonte:${fonteId}:ultima_busca`, Date.now())
}

export function cacheEstaFresco(timestampMs) {
  if (!timestampMs) return false
    const minutosPassados = (Date.now() - Number(timestampMs)) / 1000 / 60
    return minutosPassados < JANELA_CACHE_MINUTOS
}

// ---------------------------------------------------------------------------
// Fase 1 — cache de og:image por link (evita re-scrapear a mesma página de
// destino toda vez que a fonte é atualizada, já que o mesmo link pode
// continuar "fresco" por várias janelas de 15 min enquanto está no topo do feed)
// ---------------------------------------------------------------------------

const TTL_CACHE_OG_SEGUNDOS = 60 * 60 * 24 * 14 // 14 dias

function chaveOgImage(link) {
  return `og-image:${idDaNoticia(link)}`
}

export const cacheOgImage = {
  // retorna: string (achou), '' (já tentou e não achou), ou undefined (nunca tentou)
  async ler(link) {
    const valor = await redis.get(chaveOgImage(link))
    return valor === null ? undefined : valor
  },
  async gravar(link, urlOuVazio) {
    await redis.set(chaveOgImage(link), urlOuVazio, { ex: TTL_CACHE_OG_SEGUNDOS })
  }
}

// ---------------------------------------------------------------------------
// Fase 2 — fila de notícias sem thumb depois da tentativa de og:image
// ---------------------------------------------------------------------------

const CHAVE_FILA_SEM_THUMB = 'fila:sem-thumb'

export async function enfileirarSemThumb(id) {
  await redis.lpush(CHAVE_FILA_SEM_THUMB, id)
}

// Tira até `quantidade` ids do fim da fila (FIFO: entra por lpush, sai por rpop)
export async function retirarLoteSemThumb(quantidade) {
  const ids = []
  // @upstash/redis expõe rpop simples (sem COUNT) de forma confiável entre
  // versões — um loop pequeno é mais previsível aqui do que depender de
  // RPOP key count, que só existe em Redis 6.2+/REST mais recente.
  for (let i = 0; i < quantidade; i++) {
    const id = await redis.rpop(CHAVE_FILA_SEM_THUMB)
    if (!id) break
    ids.push(id)
  }
  return ids
}

export async function tamanhoFilaSemThumb() {
  return redis.llen(CHAVE_FILA_SEM_THUMB)
}

// ---------------------------------------------------------------------------
// Fase 2/3 — cache de busca de imagem por query (heurística ou gerada por IA)
// ---------------------------------------------------------------------------

const TTL_CACHE_BUSCA_SEGUNDOS = 60 * 60 * 24 * 7 // 7 dias
const TTL_CACHE_BUSCA_NEGATIVO_SEGUNDOS = 60 * 60 * 24 // 1 dia — pode valer tentar de novo amanhã

function chaveCacheBusca(query) {
  return `busca-imagem:${idDaNoticia(query.toLowerCase().trim())}`
}

export const cacheBuscaImagem = {
  // retorna objeto salvo, null (tentou e não achou nada), ou undefined (nunca tentou)
  async ler(query) {
    const valor = await redis.get(chaveCacheBusca(query))
    if (valor === null) return undefined
    return valor === '' ? null : JSON.parse(valor)
  },
  async gravar(query, resultado) {
    if (!resultado) {
      await redis.set(chaveCacheBusca(query), '', { ex: TTL_CACHE_BUSCA_NEGATIVO_SEGUNDOS })
      return
    }
    await redis.set(chaveCacheBusca(query), JSON.stringify(resultado), { ex: TTL_CACHE_BUSCA_SEGUNDOS })
  }
}

// ---------------------------------------------------------------------------
// Fase 3 — anti-repetição: evita usar a mesma foto em cards próximos no feed
// ---------------------------------------------------------------------------

const CHAVE_IMAGENS_RECENTES = 'imagens-ia:recentes'
const MAX_IMAGENS_RECENTES = 50

export async function imagemUsadaRecentemente(url) {
  const recentes = await redis.lrange(CHAVE_IMAGENS_RECENTES, 0, -1)
  return recentes.includes(url)
}

export async function registrarImagemRecente(url) {
  await redis.lpush(CHAVE_IMAGENS_RECENTES, url)
  await redis.ltrim(CHAVE_IMAGENS_RECENTES, 0, MAX_IMAGENS_RECENTES - 1)
}

// ---------------------------------------------------------------------------
// Fase 3 — cota diária de chamadas de IA, pra parar de tentar (e evitar 429
// em cascata) assim que um teto configurável é atingido
// ---------------------------------------------------------------------------

function chaveCotaIA() {
  const hoje = new Date().toISOString().slice(0, 10) // YYYY-MM-DD
  return `cota-ia:${hoje}`
}

export async function cotaIAExcedida(limiteDiario) {
  const usado = Number((await redis.get(chaveCotaIA())) || 0)
  return usado >= limiteDiario
}

export async function usoIAHoje() {
  return Number((await redis.get(chaveCotaIA())) || 0)
}

export async function registrarUsoIA() {
  const chave = chaveCotaIA()
  const novoValor = await redis.incr(chave)
  if (novoValor === 1) {
    await redis.expire(chave, 60 * 60 * 26) // um pouco mais que 24h, margem de fuso
  }
}

// ---------------------------------------------------------------------------
// Detecta imagem "genérica da fonte": a mesma URL reaparecendo em notícias
// diferentes da mesma fonte é sinal quase certo de logo/ícone/capa padrão do
// feed, não uma foto real do artigo — uma foto de capa de verdade não se
// repete entre artigos diferentes. Complementa a checagem por nome de
// arquivo (lib/imagemGenerica.js), que não pega URL sem palavra-chave óbvia.
// ---------------------------------------------------------------------------

const TTL_CONTAGEM_IMAGEM_FONTE_SEGUNDOS = 60 * 60 * 24 * 14 // 14 dias

// Retorna quantas vezes (incluindo essa) essa URL exata já foi aceita como
// thumb pra essa fonte. usos === 1 -> primeira vez, deixa passar. usos > 1
// -> reaproveitada, quem chama deve rejeitar.
export async function contarUsoImagemPorFonte(fonteId, url) {
  const chave = `imagem-fonte:${fonteId}`
  const campo = idDaNoticia(url)
  const usos = await redis.hincrby(chave, campo, 1)
  if (usos === 1) await redis.expire(chave, TTL_CONTAGEM_IMAGEM_FONTE_SEGUNDOS)
  return usos
}

// ---------------------------------------------------------------------------
// Enriquecimento oportunista: já que o plano Hobby da Vercel só libera cron
// 1x/dia, o grosso do trabalho da fila roda "de carona" dentro de requests
// normais do /api/feed. SET ... NX é atômico — só UM entre vários requests
// concorrentes consegue o lock, os outros pulam. Isso evita que 10 usuários
// dando pull-to-refresh ao mesmo tempo disparem 10 rodadas de chamada de IA
// simultâneas.
// ---------------------------------------------------------------------------

const CHAVE_LOCK_OPORTUNISTA = 'lock:enriquecimento-oportunista'
const JANELA_LOCK_SEGUNDOS = 20

export async function tentarAdquirirLockOportunista() {
  const resultado = await redis.set(CHAVE_LOCK_OPORTUNISTA, '1', { nx: true, ex: JANELA_LOCK_SEGUNDOS })
  return resultado === 'OK'
}
