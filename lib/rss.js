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
// Devolve também largura/altura quando o próprio feed já declara isso nos
// atributos da tag (comum em media:content/media:thumbnail) — dá pra
// rejeitar um ícone pequeno sem baixar um byte da imagem.
function pegarDeCampoMedia(campo) {
  if (!campo) return null
  const itens = Array.isArray(campo) ? campo : [campo]
  for (const item of itens) {
    const atributos = item?.['$']
    if (atributos?.url) {
      return {
        url: atributos.url,
        largura: Number(atributos.width) || null,
        altura: Number(atributos.height) || null
      }
    }
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

// Tamanho mínimo declarado pra aceitar sem checagem adicional. Bem mais
// baixo que o mínimo usado na checagem completa (ver lib/dimensaoImagem.js)
// de propósito: aqui só queremos descartar de cara um ícone/thumbnail óbvio
// que o PRÓPRIO feed já declara pequeno — qualquer coisa maior ainda passa
// pelas checagens de nome/reuso normalmente.
const LARGURA_MINIMA_DECLARADA = 150
const ALTURA_MINIMA_DECLARADA = 150

function extrairImagem(item) {
  const doEnclosure = item.enclosure?.url
    ? { url: item.enclosure.url, largura: null, altura: null }
    : null
  const candidata =
    doEnclosure || pegarDeCampoMedia(item.mediaContent) || pegarDeCampoMedia(item.mediaThumbnail)

  if (candidata) {
    const { largura, altura } = candidata
    if (largura && altura && (largura < LARGURA_MINIMA_DECLARADA || altura < ALTURA_MINIMA_DECLARADA)) {
      // o próprio feed já diz que é um ícone/thumbnail — nem tenta, cai pro
      // fallback de <img> no corpo (que pode ser uma foto de verdade) ou,
      // se não achar nada, vai pra fila de og:image/heurística/IA
      return normalizarUrlImagem(extrairImagemDoHtml(item))
    }
    return normalizarUrlImagem(candidata.url)
  }

  return normalizarUrlImagem(extrairImagemDoHtml(item))
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
