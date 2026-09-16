import { validarImagem } from './validarImagem.js'
import { imagemUsadaRecentemente, registrarImagemRecente } from './redisClient.js'

const TIMEOUT_MS = 5000

const STOPWORDS = new Set([
  'the', 'a', 'an', 'of', 'in', 'on', 'for', 'to', 'and', 'or', 'is', 'are',
  'how', 'what', 'why', 'with', 'your', 'you', 'de', 'da', 'do', 'das', 'dos',
  'que', 'para', 'com', 'uma', 'um', 'os', 'as', 'no', 'na', 'e', 'é'
])

// Fallback sem IA (e fallback de erro da IA): pega as palavras mais longas
// do título, ignorando stopwords óbvias. Não é sofisticado, mas já resolve
// bem casos com nome próprio ou termo técnico específico no título.
export function queryHeuristicaDoTitulo(titulo) {
  const palavras = (titulo || '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((p) => p.length > 2 && !STOPWORDS.has(p.toLowerCase()))
    .sort((a, b) => b.length - a.length)
    .slice(0, 4)

  return palavras.join(' ')
}

async function buscarComTimeout(url, headers) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const resp = await fetch(url, { signal: controller.signal, headers })
    if (!resp.ok) return null
    return await resp.json()
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

// Openverse (Wikimedia) — sem API key, acervo CC. Primeira tentativa por ter
// menor atrito e cobrir bem tanto conceito genérico quanto entidade nomeada.
async function buscarOpenverse(query) {
  const url = `https://api.openverse.org/v1/images/?q=${encodeURIComponent(query)}&license_type=all-cc&page_size=6&mature=false`
  const json = await buscarComTimeout(url)
  const resultados = json?.results || []

  return resultados.map((r) => ({
    url: r.url,
    paginaOrigem: r.foreign_landing_url || r.url,
    autor: r.creator || 'desconhecido',
    licenca: r.license ? r.license.toUpperCase() : 'desconhecida',
    largura: r.width,
    altura: r.height
  }))
}

// Pexels — precisa de PEXELS_API_KEY (grátis). Fotos de melhor qualidade
// visual, mas com termo de atribuição próprio.
async function buscarPexels(query) {
  const key = process.env.PEXELS_API_KEY
  if (!key) return []

  const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=6&orientation=landscape`
  const json = await buscarComTimeout(url, { Authorization: key })
  const resultados = json?.photos || []

  return resultados.map((r) => ({
    url: r.src?.large,
    paginaOrigem: r.url,
    autor: r.photographer || 'desconhecido',
    licenca: 'Pexels License',
    largura: r.width,
    altura: r.height
  }))
}

const PROVEDORES = [buscarOpenverse, buscarPexels]

function candidataEhAceitavel(candidata) {
  if (!candidata?.url) return false
  // corta imagem muito estreita/alta que ficaria com um corte estranho no
  // .rox-thumb-wrap (aspect-ratio 16/9 + object-fit: cover)
  if (candidata.largura && candidata.altura) {
    const proporcao = candidata.largura / candidata.altura
    if (proporcao < 0.7 || proporcao > 2.6) return false
  }
  return true
}

// Busca uma imagem relevante pra `query`, tentando os provedores em ordem
// até achar uma candidata válida, ainda não usada recentemente, e com URL
// que realmente responde como imagem (validarImagem). Retorna null se nada
// servir — quem chama decide o que fazer (favicon, por exemplo).
export async function buscarImagemPorQuery(query) {
  if (!query || !query.trim()) return null

  for (const provedor of PROVEDORES) {
    let candidatas = []
    try {
      candidatas = await provedor(query)
    } catch (err) {
      console.error('[roxnews] provedor de imagem falhou:', err.message)
      continue
    }

    for (const candidata of candidatas.filter(candidataEhAceitavel)) {
      if (await imagemUsadaRecentemente(candidata.url)) continue
      if (!(await validarImagem(candidata.url))) continue

      await registrarImagemRecente(candidata.url)
      return candidata
    }
  }

  return null
}
