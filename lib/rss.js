import Parser from 'rss-parser'

const parser = new Parser({
  timeout: 8000,
  customFields: {
    item: [
      ['media:content', 'mediaContent'],
      ['media:thumbnail', 'mediaThumbnail'],
      ['enclosure', 'enclosure']
    ]
  }
})

// Alguns feeds mandam um único objeto { $: {...} }, outros mandam um array
// deles (ex: media:content com várias resoluções) — aceita os dois casos.
function pegarUrlDeCampoMedia(campo) {
  if (!campo) return null
  const itens = Array.isArray(campo) ? campo : [campo]
  for (const item of itens) {
    const url = item?.['$']?.url
    if (url) return url
  }
  return null
}

function normalizarUrlImagem(url) {
  if (!url) return null
  let limpa = url.trim()
  if (!limpa) return null
  // protocolo relativo (//exemplo.com/img.jpg) -> força https
  if (limpa.startsWith('//')) limpa = `https:${limpa}`
  // http puro numa página https quebra por mixed content — força https
  if (limpa.startsWith('http://')) limpa = `https://${limpa.slice('http://'.length)}`
  if (!/^https:\/\//i.test(limpa)) return null
  return limpa
}

function extrairImagem(item) {
  const candidata =
    item.enclosure?.url ||
    pegarUrlDeCampoMedia(item.mediaContent) ||
    pegarUrlDeCampoMedia(item.mediaThumbnail) ||
    extrairImagemDoHtml(item)

  return normalizarUrlImagem(candidata)
}

// fallback: tenta achar a primeira <img> dentro do HTML do resumo/conteúdo
function extrairImagemDoHtml(item) {
  const html = item['content:encoded'] || item.content || item.summary || ''
  const match = html.match(/<img[^>]+src=["']([^"'>]+)["']/i)
  return match ? match[1] : null
}

function limparResumo(item) {
  const bruto = item.contentSnippet || item.summary || item.title || ''
  return bruto.replace(/\s+/g, ' ').trim().slice(0, 280)
}

// Busca e normaliza os itens de uma fonte RSS. Nunca lança erro pra fora —
// uma fonte fora do ar não pode derrubar o feed inteiro.
export async function buscarFonte(fonte) {
  try {
    const feed = await parser.parseURL(fonte.url_rss)
    return feed.items.map((item) => ({
      titulo: (item.title || '').trim(),
      resumo: limparResumo(item),
      imagemUrl: extrairImagem(item),
      link: item.link,
      fonteId: fonte.id,
      fonteNome: fonte.nome,
      categoria: fonte.categoria_padrao || '',
      publicadoEm: item.isoDate || item.pubDate || new Date().toISOString(),
      idioma: fonte.idioma
    }))
  } catch (err) {
    console.error(`[roxnews] falha ao buscar fonte ${fonte.id}:`, err.message)
    return []
  }
}
