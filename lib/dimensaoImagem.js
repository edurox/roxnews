import { imageSize } from 'image-size'

// Mede a largura/altura REAL de uma imagem — pega ícone/logo que passou
// pelas checagens anteriores (nome de arquivo, content-type, ainda não
// repetido pra fonte) mas continua sendo pequeno de verdade. O HEAD de
// validarImagem.js não denuncia isso: um PNG 512x512 com bastante fundo
// sólido (caso comum de logo) pode pesar só uns poucos KB, passando fácil
// do corte de "não é pixel de tracking".
//
// Único filtro que baixa bytes reais do arquivo (os outros são HEAD/regex),
// então é sempre o ÚLTIMO a rodar em imagemEhAceitavel — só paga esse custo
// quem já passou nos filtros mais baratos.

const TIMEOUT_MS = 4000
// 256KB cobre o cabeçalho de dimensão de praticamente qualquer PNG/GIF/WEBP
// (fica nos primeiros bytes) e também JPEG com EXIF/thumbnail embutido
// antes do marcador SOF — não precisa do arquivo inteiro pra saber o tamanho.
const BYTES_MAXIMOS_LIDOS = 262_144

const LARGURA_MINIMA = 320
const ALTURA_MINIMA = 180

async function medirImagem(url) {
  if (!url) return null

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      // 206 é o esperado; servidor que ignora Range manda 200 com o arquivo
      // inteiro — os dois casos servem, só limitamos a LEITURA do corpo
      headers: { Range: `bytes=0-${BYTES_MAXIMOS_LIDOS - 1}` }
    })
    if (!resp.ok || !resp.body) return null

    const reader = resp.body.getReader()
    const pedacos = []
    let bytesLidos = 0
    while (bytesLidos < BYTES_MAXIMOS_LIDOS) {
      const { done, value } = await reader.read()
      if (done) break
      pedacos.push(value)
      bytesLidos += value.length
    }
    reader.cancel().catch(() => {})

    if (!pedacos.length) return null
    const buffer = Buffer.concat(pedacos.map((p) => Buffer.from(p)))

    const dimensoes = imageSize(buffer)
    if (!dimensoes?.width || !dimensoes?.height) return null
    return { largura: dimensoes.width, altura: dimensoes.height }
  } catch {
    // arquivo truncado (esperado, já que só lemos os primeiros KB em
    // formatos progressivos), formato não suportado, timeout, etc. — não
    // sabemos o tamanho de verdade, quem chama decide o que fazer com "não sei"
    return null
  } finally {
    clearTimeout(timer)
  }
}

// true = pequena demais, rejeita. false = ou é grande o suficiente, ou não
// deu pra medir (nesse caso NÃO bloqueia por tamanho — é melhor deixar uma
// imagem que não conseguimos medir passar do que rejeitar candidatas boas
// por falha de rede/timeout no probe).
export async function imagemEhPequenaDemais(url) {
  const dimensoes = await medirImagem(url)
  if (!dimensoes) return false
  return dimensoes.largura < LARGURA_MINIMA || dimensoes.altura < ALTURA_MINIMA
}
