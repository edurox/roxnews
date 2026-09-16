# ROXNEWS

Feed de notícias curado, sem doomscrolling. Título + resumo + imagem + link
pra fonte original, filtrado pelas suas tags de interesse, com botão pra
bloquear fontes que você não quer mais ver.

Stack: **Quasar (Vue)** no front, **Vercel Functions (Node)** na API,
**Supabase** pra login/tags/fontes bloqueadas, **Upstash Redis** como
cache do feed (ZSET por timestamp, permite paginar por dia).

## 1. Setup do Supabase

1. Crie um projeto em supabase.com (plano free).
2. Vá em **SQL Editor** e rode o conteúdo de `supabase/schema.sql`.
   Isso cria as tabelas, RLS e já popula um catálogo inicial de fontes RSS.
3. Em **Authentication > Providers**, confirme que **Email** está habilitado
   com "Confirm email" ligado — é o que faz o magic link funcionar.
4. Em **Project Settings > API**, copie a `Project URL` e a `anon public key`.

> **Importante**: as URLs de RSS no seed (`schema.sql`) foram escolhidas com
> base em pesquisa, mas eu não testei cada uma ao vivo — antes de rodar de
> verdade, abra cada `url_rss` no navegador e confirme que ainda retorna um
> XML válido. Feeds mudam de endereço com frequência.

## 2. Setup do Upstash Redis

1. Crie um banco Redis em upstash.com (plano free).
2. Na aba **REST API** do banco, copie `UPSTASH_REDIS_REST_URL` e
   `UPSTASH_REDIS_REST_TOKEN`.

## 3. Variáveis de ambiente

Copie `.env.example` para `.env` e preencha com os valores do Supabase e
Upstash. As mesmas variáveis precisam ser cadastradas no dashboard da
Vercel (**Project Settings > Environment Variables**) antes do deploy.

## 4. Rodando local

```bash
npm install
npm run dev
```

Isso sobe o front do Quasar. As rotas `/api/*` só funcionam de verdade
rodando via `vercel dev` (instale a CLI da Vercel: `npm i -g vercel`,
depois `vercel dev`), já que localmente o `quasar dev` sozinho não executa
as serverless functions.

## 5. Deploy

```bash
vercel
```

Ou conecte o repositório do GitHub direto no dashboard da Vercel — o
`vercel.json` já aponta o build e a pasta de output do Quasar.

## Estrutura

```
api/                  → Vercel Functions (Node) — feed, tags, fontes bloqueadas
lib/                  → clientes compartilhados (Supabase, Redis, parser de RSS)
src/
  boot/               → inicialização do Pinia e Supabase no front
  components/         → NewsCard, NewsWebview (dialog de leitura)
  layouts/            → MainLayout
  pages/              → IndexPage (feed), SettingsPage, LoginPage
  stores/             → feed-store (Pinia)
supabase/schema.sql   → schema completo + seed de fontes
```

## Próximos passos sugeridos

- Ajustar e testar as `url_rss` reais do seed.
- Adicionar mais fontes (BR e EN) por categoria conforme seus interesses.
- Ajustar o casamento de tag → notícia: hoje é palavra-chave simples no
  título/resumo (mais categoria fixa da fonte); se ficar fraco, dá pra evoluir
  pra busca por similaridade semântica depois.
- O feed não é mais paginado por dia: cada notícia mostrada fica marcada como
  "vista" (Redis, por usuário) e não volta a aparecer. "Carregar mais" busca
  o próximo lote do que ainda não foi visto. Isso só funciona de verdade
  logado — sem login, o backend não tem como saber o que já foi mostrado.
