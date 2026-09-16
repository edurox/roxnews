// Usa um LLM (via OpenRouter) só pra traduzir título+resumo em bons termos
// de busca de imagem em inglês. A IA NUNCA devolve uma URL de imagem — ela
// erraria/inventaria URL com muita confiança. Quem resolve a URL de verdade
// é lib/buscaImagem.js, consultando provedores de imagem reais.

const TIMEOUT_MS = 12000

const MODELOS = [
  'google/gemma-4-26b-a4b-it:free',
  'openrouter/free'
]

const PROMPT_SISTEMA = `Você recebe título e resumo de uma notícia e devolve termos de busca de imagem em inglês para ilustrar o assunto, mesmo que de forma genérica (ex: um artigo técnico sobre filas de retry pode usar "server room" ou "computer code screen" — não precisa ser uma imagem literal do assunto, só minimamente relacionada).

Responda APENAS com um JSON no formato exato:
{"queries": ["termo mais específico", "termo mais genérico"], "sensivel": false}

Regras:
- 2 a 3 queries em inglês, da mais específica pra mais genérica, cada uma com 2 a 4 palavras.
- Se o assunto for abstrato ou técnico sem imagem óbvia, use um conceito visual relacionado (ex: "cloud computing", "software code", "data center").
- "sensivel" deve ser true se a notícia trata de violência, morte, acidente, crime, doença grave, tragédia ou tema similar onde uma imagem ilustrativa automática seria inadequada. Nesse caso, "queries" pode vir vazio.
- Não inclua nada além do JSON.`

function tentarParsearJson(texto) {
  if (!texto) return null
  // alguns modelos pequenos embrulham a resposta em \`\`\`json ... \`\`\` mesmo
  // quando instruídos a não fazer isso
  const limpo = texto.replace(/```json|```/g, '').trim()
  try {
    return JSON.parse(limpo)
  } catch {
    return null
  }
}

// Retorna { queries: string[], sensivel: boolean } ou null se a chamada
// falhar ou a resposta vier em formato inesperado — nesses casos, quem
// chama deve cair pra queryHeuristicaDoTitulo.
export async function gerarQueryImagem({ titulo, resumo, fonteNome }) {
  const chave = process.env.OPENROUTER_API_KEY
  if (!chave) return null

  const resumoTruncado = (resumo || '').slice(0, 400)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${chave}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        models: MODELOS,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: PROMPT_SISTEMA },
          { role: 'user', content: `Fonte: ${fonteNome}\nTítulo: ${titulo}\nResumo: ${resumoTruncado}` }
        ],
        max_tokens: 200
      })
    })

    if (!resp.ok) {
      console.error('[roxnews] OpenRouter respondeu', resp.status, await resp.text().catch(() => ''))
      return null
    }

    const json = await resp.json()
    const texto = json?.choices?.[0]?.message?.content
    const parsed = tentarParsearJson(texto)

    if (!parsed || !Array.isArray(parsed.queries)) return null

    return {
      queries: parsed.queries.filter((q) => typeof q === 'string' && q.trim()).slice(0, 3),
      sensivel: Boolean(parsed.sensivel)
    }
  } catch (err) {
    console.error('[roxnews] falha ao chamar OpenRouter:', err.message)
    return null
  } finally {
    clearTimeout(timer)
  }
}
