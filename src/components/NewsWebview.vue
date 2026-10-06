<template>
  <q-dialog :model-value="modelValue" maximized @update:model-value="$emit('update:modelValue', $event)">
    <q-card class="rox-webview-card">
      <q-toolbar class="rox-header">
        <q-toolbar-title class="rox-meta">{{ noticia?.fonteNome }}</q-toolbar-title>
        <q-btn flat round dense icon="open_in_new" :href="noticia?.link" target="_blank" />
        <q-btn flat round dense icon="close" v-close-popup />
      </q-toolbar>

      <q-linear-progress v-if="carregando" indeterminate color="primary" />

      <div v-if="noticia && noticia.abreWebview !== false && !falhouEmbed" class="rox-iframe-wrap">
        <iframe
          :src="noticia.link"
          class="rox-iframe"
          @load="aoCarregarIframe"
          @error="marcarBloqueio"
          referrerpolicy="no-referrer"
        />

        <!--
          Muitos sites bloqueiam ser exibidos num iframe (X-Frame-Options / CSP)
          sem disparar nenhum evento de erro em JS — o iframe simplesmente fica
          em branco. Por isso, além da detecção por timeout abaixo, deixamos
          esse botão sempre à mão pra abrir no navegador se a página não
          aparecer direito.
        -->
        <q-btn
          class="rox-abrir-fora"
          color="primary"
          icon="open_in_new"
          label="Abrir no navegador"
          :href="noticia.link"
          target="_blank"
          unelevated
          no-caps
        />
      </div>

      <div
        v-else-if="noticia && (falhouEmbed || noticia.abreWebview === false)"
        class="rox-fallback column items-center justify-center q-pa-xl"
      >
        <p class="rox-summary text-center">
          Essa fonte não permite abrir dentro do app. Abra direto no site original.
        </p>
        <q-btn
          color="primary"
          label="Abrir notícia"
          icon="open_in_new"
          :href="noticia.link"
          target="_blank"
          unelevated
        />
      </div>
    </q-card>
  </q-dialog>
</template>

<script setup>
import { ref, watch } from 'vue'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  noticia: { type: Object, default: null }
})

const emit = defineEmits(['update:modelValue', 'bloqueio-detectado'])

const carregando = ref(true)
const falhouEmbed = ref(false)

// Limiar de "carregou rápido demais pra ser a página de verdade": um site de
// notícia de verdade (com anúncio, tracker, imagem) não termina de carregar
// em menos de ~800ms. Quando o Firefox bloqueia por X-Frame-Options/CSP, ele
// renderiza a PRÓPRIA tela de erro dentro do iframe e dispara @load como se
// fosse um carregamento normal — isso teoricamente deveria ser quase
// instantâneo, então usamos o tempo decorrido pra desconfiar.
const LIMIAR_CARGA_SUSPEITA_MS = 800
// Teto pro caso do Chrome, que costuma deixar o iframe em branco sem
// disparar @load nem @error quando bloqueia — sem isso, ficaríamos esperando
// pra sempre.
const TIMEOUT_SEM_RESPOSTA_MS = 5000

let inicioCarregamento = 0
let timeoutId = null

function marcarBloqueio() {
  if (falhouEmbed.value) return // já marcado, evita emitir duas vezes
  falhouEmbed.value = true
  carregando.value = false
  if (timeoutId) clearTimeout(timeoutId)
  if (props.noticia) emit('bloqueio-detectado', props.noticia.fonteId)
}

function aoCarregarIframe() {
  const decorrido = Date.now() - inicioCarregamento
  if (decorrido < LIMIAR_CARGA_SUSPEITA_MS) {
    marcarBloqueio()
    return
  }
  carregando.value = false
}

// Se a fonte já está marcada como "não abre em webview" (catálogo), nem
// tenta o iframe — vai direto pro fallback, sem esperar nada de novo. Só
// dispara o evento de "detectei agora" quando isso ainda NÃO era conhecido,
// pra não ficar reenviando a mesma notificação toda vez que a pessoa abre
// outra notícia da mesma fonte.
watch(
  () => props.noticia,
  (novaNoticia) => {
    if (!novaNoticia) return
    if (timeoutId) clearTimeout(timeoutId)

    if (novaNoticia.abreWebview === false) {
      carregando.value = false
      falhouEmbed.value = false // o v-else-if já cobre abreWebview === false
      return
    }

    carregando.value = true
    falhouEmbed.value = false
    inicioCarregamento = Date.now()
    timeoutId = setTimeout(() => {
      if (carregando.value) marcarBloqueio()
    }, TIMEOUT_SEM_RESPOSTA_MS)
  },
  { immediate: true }
)
</script>

<style scoped>
.rox-webview-card {
  background: var(--rox-bg);
  display: flex;
  flex-direction: column;
  height: 100vh;
}

.rox-iframe-wrap {
  position: relative;
  flex: 1;
  display: flex;
}

.rox-iframe {
  flex: 1;
  border: none;
  width: 100%;
}

.rox-abrir-fora {
  position: absolute;
  right: 16px;
  bottom: 16px;
  z-index: 1;
}

.rox-fallback {
  flex: 1;
}
</style>
