<template>
  <div ref="cardRef" class="rox-card" @click="$emit('abrir', noticia)">
    <div class="rox-thumb-wrap">
      <img
        v-if="noticia.imagemUrl && !imagemComErro"
        :src="noticia.imagemUrl"
        class="rox-thumb"
        alt=""
        loading="lazy"
        decoding="async"
        referrerpolicy="no-referrer"
        @error="imagemComErro = true"
      >
      <div v-else class="rox-thumb-fallback">
        <img
          v-if="faviconUrl"
          :src="faviconUrl"
          class="rox-thumb-favicon"
          alt=""
          loading="lazy"
          referrerpolicy="no-referrer"
          @error="faviconComErro = true"
        >
      </div>

      <a
        v-if="noticia.imagemFonte === 'ia' && noticia.imagemPaginaOrigem"
        class="rox-badge-ia"
        :href="noticia.imagemPaginaOrigem"
        target="_blank"
        rel="noopener"
        :title="`Imagem ilustrativa escolhida por IA${noticia.imagemAutor ? ` · foto de ${noticia.imagemAutor}` : ''} — toque para ver a fonte`"
        @click.stop
      >
        <q-icon name="auto_awesome" size="11px" />
        img: IA
      </a>
    </div>

    <div class="q-pa-md">
      <div class="rox-meta-row q-mb-xs">
        <span class="rox-meta">{{ noticia.fonteNome }}</span>
        <span class="rox-meta">·</span>
        <span class="rox-meta">{{ horaFormatada }}</span>
        <q-chip
          v-if="ehRegional"
          dense
          class="rox-tag-chip rox-tag-chip--regional q-ml-sm"
          label="regional"
        />
      </div>

      <div class="rox-headline text-h6">{{ noticia.titulo }}</div>

      <div class="rox-summary q-mt-xs">
        <span>{{ resumoExibido }}</span>
        <a
          v-if="resumoEhLongo"
          class="rox-ver-mais"
          @click.stop="expandido = !expandido"
        >
          {{ expandido ? ' ver menos' : ' ver mais' }}
        </a>
      </div>

      <div class="row items-center q-mt-sm">
        <q-btn
          flat
          dense
          round
          icon="visibility_off"
          size="sm"
          :title="`Não mostrar mais notícias de ${noticia.fonteNome}`"
          @click.stop="confirmarBloqueio"
        />
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useQuasar } from 'quasar'

const LIMITE_RESUMO = 180

const props = defineProps({
  noticia: { type: Object, required: true }
})

const emit = defineEmits(['abrir', 'bloquear-fonte', 'vista'])

const $q = useQuasar()
const expandido = ref(false)
const imagemComErro = ref(false)
const faviconComErro = ref(false)
const cardRef = ref(null)
let observer = null

// Fallback pra fontes que simplesmente não mandam imagem no RSS (ex: Hacker
// News, que é um agregador de links externos — não tem enclosure, media:content
// nem <img> no corpo, porque o destino é uma página qualquer, não um artigo
// deles). Em vez de deixar o quadrado vazio, usa o favicon do domínio de
// destino. Funciona pra qualquer fonte assim, sem precisar cadastrar caso a caso.
const faviconUrl = computed(() => {
  if (faviconComErro.value) return null
  try {
    const dominio = new URL(props.noticia.link).hostname
    return `https://www.google.com/s2/favicons?sz=128&domain=${dominio}`
  } catch {
    return null
  }
})

const horaFormatada = computed(() => {
  const d = new Date(props.noticia.publicadoEm)
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
})

const ehRegional = computed(() =>
  (props.noticia.fonteId || '').includes('chapeco') ||
  (props.noticia.categoria || '').includes('regional')
)

const resumoEhLongo = computed(() => (props.noticia.resumo || '').length > LIMITE_RESUMO)

const resumoExibido = computed(() => {
  const texto = props.noticia.resumo || ''
  if (expandido.value || !resumoEhLongo.value) return texto
  return texto.slice(0, LIMITE_RESUMO).trimEnd() + '…'
})

function confirmarBloqueio() {
  $q.dialog({
    dark: true,
    title: 'Ocultar fonte',
    message: `Não mostrar mais notícias de ${props.noticia.fonteNome}? Dá pra desfazer depois em Configurações.`,
    cancel: { flat: true, color: 'grey' },
    ok: { flat: true, color: 'primary', label: 'Ocultar' },
    persistent: true
  }).onOk(() => {
    emit('bloquear-fonte', props.noticia.fonteId)
  })
}

// Só considera "vista" quando o card realmente fica visível na tela por um
// tempinho — evita marcar como visto algo que só chegou na resposta da API
// mas o usuário nunca rolou até ver.
onMounted(() => {
  if (typeof IntersectionObserver === 'undefined' || !cardRef.value) return

  let timer = null
  observer = new IntersectionObserver(
    ([entrada]) => {
      if (entrada.isIntersecting) {
        timer = setTimeout(() => {
          emit('vista', props.noticia.id)
          observer?.disconnect()
        }, 600)
      } else if (timer) {
        clearTimeout(timer)
        timer = null
      }
    },
    { threshold: 0.6 }
  )
  observer.observe(cardRef.value)
})

onBeforeUnmount(() => {
  observer?.disconnect()
})
</script>

<style scoped>
.rox-card {
  cursor: pointer;
  overflow: hidden;
}

.rox-thumb-wrap {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  border-bottom: 1px solid var(--rox-line);
}

.rox-badge-ia {
  position: absolute;
  right: 8px;
  bottom: 8px;
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 3px 7px;
  border-radius: 4px;
  background: rgba(25, 23, 18, 0.78);
  backdrop-filter: blur(2px);
  color: var(--rox-ink-soft);
  font-family: var(--rox-font-meta);
  font-size: 10px;
  letter-spacing: 0.2px;
  text-decoration: none;
  transition: color 0.15s ease;
}

.rox-badge-ia:hover {
  color: var(--rox-ink);
}

.rox-thumb {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

/* gap em vez de q-gutter-xs (margem negativa desalinhava a linha em 4px) */
.rox-meta-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.rox-meta-row :deep(.q-chip) {
  margin: 0 0 0 8px;
}

.rox-thumb-fallback {
  width: 100%;
  height: 100%;
  background: var(--rox-surface-raised);
  display: flex;
  align-items: center;
  justify-content: center;
}

.rox-thumb-favicon {
  width: 40px;
  height: 40px;
  opacity: 0.6;
}

.rox-ver-mais {
  color: var(--rox-accent);
  cursor: pointer;
  white-space: nowrap;
  font-size: 0.9em;
}
</style>
