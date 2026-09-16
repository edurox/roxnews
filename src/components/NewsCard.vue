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
    </div>

    <div class="q-pa-md">
      <div class="row items-center q-gutter-xs q-mb-xs">
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
  width: 100%;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  border-bottom: 1px solid var(--rox-line);
}

.rox-thumb {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
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
