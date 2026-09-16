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
// Sem recorte por dia: só o que ainda não apareceu pra ele.
export async function buscarNaoVistas({ usuarioId, limite = 30 }) {
  // pega um lote maior de candidatas (mais recentes primeiro) pra filtrar as já vistas
  const candidatosIds = await redis.zrange(CHAVE_FEED_GLOBAL, '+inf', '-inf', {
    byScore: true,
    rev: true,
    offset: 0,
    count: limite * 5
  })
  if (!candidatosIds.length) return []

  let idsNaoVistos = candidatosIds
  if (usuarioId) {
    const chaveVistas = `vistas:${usuarioId}`
    const pipeline = redis.pipeline()
    candidatosIds.forEach((id) => pipeline.sismember(chaveVistas, id))
    const resultadosVisto = await pipeline.exec()
    idsNaoVistos = candidatosIds.filter((_, i) => !resultadosVisto[i])
  }

  const idsFinais = idsNaoVistos.slice(0, limite)
  if (!idsFinais.length) return []

  const pipeline = redis.pipeline()
  idsFinais.forEach((id) => pipeline.hgetall(`noticia:${id}`))
  const resultados = await pipeline.exec()

  return resultados
    .map((noticia, i) => (noticia ? { id: idsFinais[i], ...noticia } : null))
    .filter(Boolean)
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
