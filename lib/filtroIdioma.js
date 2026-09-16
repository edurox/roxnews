// Restringe o feed a inglês e português-BR. Dois filtros, não só um:
//
// 1. campo `idioma` da notícia (vem de fontes_rss.idioma, cadastrado no
//    Supabase) — corta de cara qualquer fonte registrada com outro idioma.
// 2. script do texto do título+resumo — corta mesmo que a fonte esteja
//    cadastrada como 'en'/'pt-br' mas o RSS de fato traga item em outro
//    idioma (fonte multilíngue, ou simplesmente cadastro errado). Cobre
//    hindi/devanagari e os outros scripts indianos mais comuns, além de
//    CJK e árabe/persa como bônus — qualquer coisa fora do latino básico.
const IDIOMAS_PERMITIDOS = new Set(['en', 'pt-br', 'pt'])

const SCRIPT_NAO_LATINO = new RegExp(
  '[' +
    '\u0900-\u097F' + // devanagari (hindi, marata, etc.)
    '\u0980-\u09FF' + // bengali
    '\u0A00-\u0A7F' + // gurmukhi (punjabi)
    '\u0A80-\u0AFF' + // gujarati
    '\u0B00-\u0B7F' + // oriya
    '\u0B80-\u0BFF' + // tâmil
    '\u0C00-\u0C7F' + // telugu
    '\u0C80-\u0CFF' + // kannada
    '\u0D00-\u0D7F' + // malayalam
    '\u0600-\u06FF' + // árabe/persa
    '\u4E00-\u9FFF' + // han (chinês)
    '\u3040-\u30FF' + // japonês (hiragana/katakana)
    '\uAC00-\uD7AF' + // hangul (coreano)
    ']'
)

export function idiomaPermitido(noticia) {
  const idioma = (noticia.idioma || '').toLowerCase().trim()
  if (idioma && !IDIOMAS_PERMITIDOS.has(idioma)) return false

  const texto = `${noticia.titulo || ''} ${noticia.resumo || ''}`
  return !SCRIPT_NAO_LATINO.test(texto)
}
