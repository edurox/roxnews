// Valida uma URL de imagem antes de aceitá-la como thumb — usado tanto pelo
// scraper de og:image quanto pela busca de imagem (heurística ou via IA).
// Nunca lança erro: URL inválida ou inacessível simplesmente retorna false,
// pra quem chama seguir pro próximo fallback sem se preocupar com exceção.

const TIMEOUT_MS = 4000
const TAMANHO_MINIMO_BYTES = 3000 // corta pixel de tracking / ícone minúsculo

export async function validarImagem(url) {
  if (!url) return false

  let controller
  try {
    controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

    const resp = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      redirect: 'follow'
    })
    clearTimeout(timer)

    if (!resp.ok) return false

    const tipo = resp.headers.get('content-type') || ''
    if (!tipo.startsWith('image/')) return false

    // nem toda origem manda content-length no HEAD — se não vier, deixa passar
    // (o corte por tamanho é um bônus, não uma garantia)
    const tamanho = Number(resp.headers.get('content-length') || 0)
    if (tamanho > 0 && tamanho < TAMANHO_MINIMO_BYTES) return false

    return true
  } catch {
    return false
  }
}
