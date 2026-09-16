// Detecta imagens que provavelmente são ícone/logo/avatar/capa-padrão da
// fonte — não uma foto real do artigo. Usado tanto pra imagem vinda do RSS
// (enclosure/media/<img> no corpo) quanto pra og:image, ANTES de aceitar
// qualquer uma como thumb. Sem isso, esses casos passam a validação normal
// (são um image/* de tamanho normal) e nunca caem na fila de heurística/IA.
//
// "cropped-NOME-WxH" é o padrão que o próprio WordPress usa quando o dono
// do site cadastra um "site icon" em Configurações > Geral — o core recorta
// e prefixa o arquivo com "cropped-" automaticamente. Pode ter dimensão
// grande o suficiente pra passar no filtro de tamanho mínimo (ex: 512x270),
// então o nome do arquivo é o único jeito de pegar esse caso.
const PADRAO_NOME_GENERICO = /(favicon|apple-touch-icon|\/cropped-|\/logo(?:[._-]|$)|[._-]logo(?:[._-]|$)|\/icons?\/|[._-]icon(?:[._-]|$)|\/icon(?:[._-]|$)|avatar|placeholder|default[._-]?(cover|social|image|thumb)|og[._-]?default|social[._-]?default|sprite|brand[._-]?mark|site[._-]?icon)/i

export function imagemPareceGenericaPeloNome(url) {
  if (!url) return false
    try {
      const caminho = new URL(url).pathname
      return PADRAO_NOME_GENERICO.test(caminho)
    } catch {
      return false
    }
}
