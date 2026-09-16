import { defineStore } from 'pinia'
import { supabase } from 'src/boot/supabase'

const ATRASO_ENVIO_VISTAS_MS = 1500

export const useFeedStore = defineStore('feed', {
  state: () => ({
    noticias: [],
    tagAtiva: null, // null = feed geral
    carregando: false,
    erro: null,
    temMais: true, // false quando um carregarMais() não trouxe nada novo (fim do feed)
    _pendentesVistas: new Set(),
    _timerVistas: null
  }),

  actions: {
    definirTag(tag) {
      this.tagAtiva = tag
      this.noticias = []
      this.temMais = true
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
        // offset real sobre o ZSET no backend — não dependemos mais de
        // "veio algo repetido?" pra decidir que o feed acabou, porque isso
        // dava falso-positivo quando o /api/vistas do lote anterior ainda
        // não tinha sido persistido (ver marcarVista / _enviarVistasPendentes)
        params.set('offset', String(this.noticias.length))

        const resp = await fetch(`/api/feed?${params}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {}
        })
        if (!resp.ok) throw new Error('falha ao carregar feed')

        const json = await resp.json()
        const idsAtuais = new Set(this.noticias.map((n) => n.id))
        const novas = json.noticias.filter((n) => !idsAtuais.has(n.id))
        this.noticias.push(...novas)

        // a própria página veio vazia do servidor -> aí sim acabou de verdade
        if (json.noticias.length === 0) this.temMais = false
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
