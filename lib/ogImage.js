import { validarImagem } from './validarImagem.js'
import { cacheOgImage } from './redisClient.js'

const TIMEOUT_MS = 5000
// og:image e twitter:image quase sempre estão no <head>, que costuma vir
// nos primeiros KB do HTML. Não precisamos (nem queremos) baixar a página
// inteira — sites de notícia às vezes têm HTML de centenas de KB.
const BYTES_MAXIMOS_LIDOS = 60_000

function extrairMeta(html, propriedade) {
  // aceita tanto property="og:image" quanto name="twitter:image", em
  // qualquer ordem dos atributos dentro da tag <meta>
  const regexes = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${propriedade}["'][^>]+content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${propriedade}["']`, 'i')
  ]
  for (const regex of regexes) {
    const match = html.match(regex)
    if (match) return match[1]
  }
  return null
}

function normalizarUrlImagem(url, urlBase) {
  if (!url) return null
  let limpa = url.trim()
  if (!limpa) return null
  try {
    // resolve relativa (ex: "/images/capa.jpg") contra a URL da página
    const resolvida = new URL(limpa, urlBase)
    if (resolvida.protocol !== 'https:' && resolvida.protocol !== 'http:') return null
    if (resolvida.protocol === 'http:') resolvida.protocol = 'https:'
    return resolvida.toString()
  } catch {
    return null
  }
}

// Lê só os primeiros BYTES_MAXIMOS_LIDOS do corpo da resposta e aborta —
// suficiente pro <head>, evita gastar tempo/banda com o artigo inteiro.
async function buscarInicioDoHtml(url, signal) {
  const resp = await fetch(url, {
    signal,
    redirect: 'follow',
    headers: {
      // alguns sites bloqueiam requisições sem um User-Agent que pareça navegador
      'User-Agent': 'Mozilla/5.0 (compatible; RoxNewsBot/1.0; +thumb-scraper)'
    }
  })
  if (!resp.ok || !resp.body) return ''

  const tipo = resp.headers.get('content-type') || ''
  if (!tipo.includes('text/html')) return ''

  const reader = resp.body.getReader()
  const decoder = new TextDecoder()
  let html = ''
  let bytesLidos = 0

  while (bytesLidos < BYTES_MAXIMOS_LIDOS) {
    const { done, value } = await reader.read()
    if (done) break
    bytesLidos += value.length
    html += decoder.decode(value, { stream: true })
    // já achou o fechamento de </head>? pode parar de ler
    if (html.includes('</head>')) break
  }
  reader.cancel().catch(() => {})
  return html
}

// Busca og:image (ou twitter:image como fallback) na página de destino da
// notícia. Nunca lança erro — página fora do ar, timeout, ou sem meta tag
// simplesmente resulta em null, e quem chama segue pro próximo fallback.
export async function buscarOgImage(link) {
  if (!link) return null

  const cacheado = await cacheOgImage.ler(link)
  if (cacheado !== undefined) return cacheado || null

  let resultado = null
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    const html = await buscarInicioDoHtml(link, controller.signal)
    clearTimeout(timer)

    if (html) {
      const candidata =
        extrairMeta(html, 'og:image:secure_url') ||
        extrairMeta(html, 'og:image') ||
        extrairMeta(html, 'twitter:image')

      const normalizada = normalizarUrlImagem(candidata, link)
      if (normalizada && (await validarImagem(normalizada))) {
        resultado = normalizada
      }
    }
  } catch (err) {
    console.error(`[roxnews] falha ao buscar og:image de ${link}:`, err.message)
  }

  // cacheia inclusive o "não achou" (string vazia), pra não tentar de novo
  // a cada refresh de fonte enquanto o link continuar circulando no feed
  await cacheOgImage.gravar(link, resultado || '')
  return resultado
}
