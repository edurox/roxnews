<template>
  <q-page class="q-pa-md rox-page">
    <div class="row items-center q-mb-md rox-top-bar">
      <div class="rox-meta col">feed</div>
      <q-btn
        flat
        round
        dense
        icon="refresh"
        :loading="feed.carregando"
        title="Buscar o que há de novo"
        @click="atualizar"
      />
    </div>

    <div class="row q-gutter-xs q-mb-md items-center">
      <q-chip
        clickable
        :class="['rox-tag-chip', !feed.tagAtiva && 'rox-tag-chip--ativa']"
        label="tudo"
        @click="feed.definirTag(null)"
      />
      <q-chip
        v-for="tag in tagsVisiveis"
        :key="tag.id"
        clickable
        :class="['rox-tag-chip', feed.tagAtiva === tag.tag && 'rox-tag-chip--ativa']"
        :label="tag.tag"
        @click="feed.definirTag(tag.tag)"
      />
      <q-btn
        v-if="tags.length > limiteTagsVisiveis"
        flat
        dense
        round
        size="sm"
        :icon="tagsExpandidas ? 'expand_less' : 'expand_more'"
        @click="tagsExpandidas = !tagsExpandidas"
      />
    </div>

    <div class="q-mb-lg" />

    <div v-if="feed.erro" class="rox-summary q-mb-md">
      Não deu pra carregar o feed agora. {{ feed.erro }}
    </div>

    <div v-if="!feed.carregando && feed.noticias.length === 0" class="rox-summary q-pa-xl text-center">
      Nada novo por aqui com esse filtro. Você já viu tudo que tinha, ou tenta outra tag.
    </div>

    <q-infinite-scroll :offset="400" :disable="!feed.temMais" @load="carregarProximoLote">
      <div class="column q-gutter-md">
        <NewsCard
          v-for="noticia in feed.noticias"
          :key="noticia.id"
          :noticia="noticia"
          @abrir="abrirNoticia"
          @bloquear-fonte="feed.bloquearFonte"
          @vista="feed.marcarVista"
        />
      </div>

      <template #loading>
        <div class="row justify-center q-my-lg">
          <q-spinner-dots color="primary" size="40px" />
        </div>
      </template>
    </q-infinite-scroll>

    <div v-if="!feed.temMais && feed.noticias.length > 0" class="rox-meta text-center q-my-lg">
      é isso — sem notícia nova por enquanto
    </div>

    <NewsWebview v-model="webviewAberta" :noticia="noticiaSelecionada" />
  </q-page>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useFeedStore } from 'src/stores/feed-store'
import { supabase } from 'src/boot/supabase'
import NewsCard from 'components/NewsCard.vue'
import NewsWebview from 'components/NewsWebview.vue'

const feed = useFeedStore()
const tags = ref([])
const webviewAberta = ref(false)
const noticiaSelecionada = ref(null)

const limiteTagsVisiveis = 3
const tagsExpandidas = ref(false)
const tagsVisiveis = computed(() =>
  tagsExpandidas.value ? tags.value : tags.value.slice(0, limiteTagsVisiveis)
)

function atualizar() {
  feed.noticias = []
  feed.temMais = true
  feed.carregarMais()
}

// chamado pelo q-infinite-scroll conforme o usuário rola a página
async function carregarProximoLote(index, done) {
  await feed.carregarMais()
  done(!feed.temMais)
}

function abrirNoticia(noticia) {
  noticiaSelecionada.value = noticia
  webviewAberta.value = true
}

async function carregarTags() {
  const { data: sessao } = await supabase.auth.getSession()
  const token = sessao?.session?.access_token
  if (!token) return

  const resp = await fetch('/api/tags', {
    headers: { Authorization: `Bearer ${token}` }
  })
  if (resp.ok) {
    const json = await resp.json()
    tags.value = json.tags
  }
}

onMounted(() => {
  feed.carregarMais()
  carregarTags()
})
</script>

<style scoped>
.rox-page {
  max-width: 640px;
  margin: 0 auto;
}

:deep(.rox-tag-chip--ativa) {
  border-color: var(--rox-accent);
  color: var(--rox-accent);
}
</style>
