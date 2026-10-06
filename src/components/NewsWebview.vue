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
          @load="carregando = false"
          @error="falhouEmbed = true"
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

// Se a fonte já está marcada como "não abre em webview" (catálogo), nem
// tenta o iframe — vai direto pro fallback, sem o usuário esperar o timeout
// de novo. Só dispara o evento de "detectei agora" quando isso ainda NÃO
// era conhecido, pra não ficar reenviando a mesma notificação toda vez que
// a pessoa abre outra notícia da mesma fonte.
watch(
  () => props.noticia,
  (novaNoticia) => {
    if (!novaNoticia) return

    if (novaNoticia.abreWebview === false) {
      carregando.value = false
      falhouEmbed.value = false // o v-else-if já cobre abreWebview === false
      return
    }

    carregando.value = true
    falhouEmbed.value = false
    setTimeout(() => {
      if (carregando.value) {
        falhouEmbed.value = true
        emit('bloqueio-detectado', novaNoticia.fonteId)
      }
    }, 5000)
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
