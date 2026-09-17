<template>
  <q-page class="q-pa-md rox-page">
    <q-pull-to-refresh @refresh="atualizar">
      <div class="rox-tag-row q-mb-md">
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
        <div class="rox-feed-list">
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
    </q-pull-to-refresh>

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

async function atualizar(done) {
  feed.noticias = []
  feed.temMais = true
  // sem isso, o pull-to-refresh limpava a lista na tela mas continuava
  // pedindo notícia a partir de onde o usuário tinha parado de rolar —
  // ignorando tudo que entrou no topo do feed desde então. É isso que
  // fazia parecer que "não tem nada novo": o cursor nunca voltava pro
  // topo do ZSET pra olhar de novo.
  feed._cursor = 0
  try {
    await feed.carregarMais()
  } finally {
    done()
  }
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

/* gap em vez de q-gutter-*: as classes de gutter do Quasar usam margem
   negativa no wrapper + margem positiva nos filhos, o que empurra cada card
   16px pra direita numa pilha vertical e estoura o layout no mobile. */
.rox-feed-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.rox-tag-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

/* q-chip vem com margin: 4px por padrão; zera pra quem controla o
   espaçamento ser só o gap */
.rox-tag-row :deep(.q-chip) {
  margin: 0;
}

:deep(.rox-tag-chip--ativa) {
  border-color: var(--rox-accent);
  color: var(--rox-accent);
}
</style>
