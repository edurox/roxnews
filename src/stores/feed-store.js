import { defineStore } from 'pinia'
import { supabase } from 'src/boot/supabase'

const ATRASO_ENVIO_VISTAS_MS = 1500

export const useFeedStore = defineStore('feed', {
  state: () => ({
    noticias: [],
    tagAtiva: null, // null = feed geral
    carregando: false,
    erro: null,
    temMais: true, // false só quando o backend confirma que o ZSET acabou de verdade (esgotado)
  _cursor: 0, // posição real no Redis — NÃO é noticias.length (ver comentário em carregarMais)
  _pendentesVistas: new Set(),
                _timerVistas: null
  }),

  actions: {
    definirTag(tag) {
      this.tagAtiva = tag
      this.noticias = []
      this.temMais = true
      this._cursor = 0
      this.carregarMais()
    },

    async carregarMais() {
      // já sabemos que acabou, ou já tem uma busca em andamento — não duplica
      if (!this.temMais || this.carregando) return

        this.carregando = true
        this.erro = null
        try {
          const { data: sessao } = await supabase.auth.getSession()
          const token = sessao?.session?.access_token

          const params = new URLSearchParams()
          if (this.tagAtiva) params.set('tag', this.tagAtiva)
            // Usa o cursor real devolvido pelo backend (proximoOffset), não
            // noticias.length. noticias.length é quanto sobrou depois de
            // bloqueio de fonte + filtro de tag + diluição — sempre menor ou
            // igual ao que o Redis realmente examinou. Se usássemos esse
            // número aqui, a paginação avança mais devagar do que a posição
            // real no ZSET, e depois de um tempo fica presa reciclando pra
            // sempre a mesma janela de itens do topo (já todos vistos ou já
            // descartados), mesmo havendo muito mais notícia mais funda no
            // feed — é isso que fazia o feed "parar de aparecer".
            params.set('offset', String(this._cursor))

            const resp = await fetch(`/api/feed?${params}`, {
              headers: token ? { Authorization: `Bearer ${token}` } : {}
            })
            if (!resp.ok) throw new Error('falha ao carregar feed')

              const json = await resp.json()
              if (typeof json.proximoOffset === 'number') this._cursor = json.proximoOffset

                const idsAtuais = new Set(this.noticias.map((n) => n.id))
                const novas = json.noticias.filter((n) => !idsAtuais.has(n.id))
                this.noticias.push(...novas)

                if (json.esgotado) {
                  // o backend confirma: não tem mais nada no ZSET a partir daqui — acabou de verdade
                  this.temMais = false
                } else if (json.noticias.length === 0) {
                  // essa janela específica não tinha nada que batesse com o filtro
                  // atual, mas ainda pode ter mais notícia mais pra frente no feed
                  // (o cursor já avançou pra lá). Busca a próxima janela na hora,
                  // em vez de mostrar "acabou" prematuramente.
                  this.carregando = false
                  await this.carregarMais()
                  return
                }
        } catch (err) {
          this.erro = err.message
        } finally {
          this.carregando = false
        }
    },

    // Chamado pelo IntersectionObserver do card quando ele realmente
    // aparece na tela — não quando só chega na resposta da API.
    marcarVista(id) {
      this._pendentesVistas.add(id)
      if (this._timerVistas) clearTimeout(this._timerVistas)
        this._timerVistas = setTimeout(() => this._enviarVistasPendentes(), ATRASO_ENVIO_VISTAS_MS)
    },

    async _enviarVistasPendentes() {
      if (this._pendentesVistas.size === 0) return
        const ids = Array.from(this._pendentesVistas)
        this._pendentesVistas.clear()

        const { data: sessao } = await supabase.auth.getSession()
        const token = sessao?.session?.access_token
        if (!token) return

          try {
            await fetch('/api/vistas', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`
              },
              body: JSON.stringify({ ids })
            })
          } catch {
            // se falhar, sem problema — a notícia simplesmente pode aparecer de novo depois
          }
    },

    async bloquearFonte(fonteId) {
      const { data: sessao } = await supabase.auth.getSession()
      const token = sessao?.session?.access_token
      if (!token) return

        await fetch('/api/fontes-bloqueadas', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({ fonteId })
        })

        this.noticias = this.noticias.filter((n) => n.fonteId !== fonteId)
    }
  }
})
