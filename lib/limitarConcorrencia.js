// Roda `tarefas` (array de funções async) respeitando um teto de execuções
// simultâneas. Evita disparar 30 fetches de og:image de uma vez só e estourar
// o maxDuration da function, ou tomar rate limit do provedor de imagem.
export async function limitarConcorrencia(tarefas, maxSimultaneas) {
  const resultados = new Array(tarefas.length)
  let proximoIndice = 0

  async function worker() {
    while (proximoIndice < tarefas.length) {
      const indiceAtual = proximoIndice++
      try {
        resultados[indiceAtual] = await tarefas[indiceAtual]()
      } catch (err) {
        resultados[indiceAtual] = undefined
        console.error('[roxnews] tarefa falhou em limitarConcorrencia:', err.message)
      }
    }
  }

  const workers = Array.from({ length: Math.min(maxSimultaneas, tarefas.length) }, worker)
  await Promise.all(workers)
  return resultados
}
