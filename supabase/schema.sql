-- ROXNEWS — schema Supabase
-- Rode isso no SQL editor do seu projeto Supabase.

-- Catálogo de fontes RSS conhecidas pelo sistema (você popula isso manualmente ou via seed)
create table if not exists fontes_rss (
  id text primary key,              -- slug curto, ex: 'bbc-brasil', 'clicrdc'
  nome text not null,               -- ex: 'BBC Brasil'
  url_rss text not null,
  idioma text not null default 'pt-br',  -- 'pt-br' | 'en'
  categoria_padrao text,            -- 'tecnologia' | 'jogos' | 'regional-chapeco' | 'geral' etc
  ativo boolean not null default true
);

-- Tags de interesse do usuário (texto livre, casado por palavra-chave no título/resumo)
create table if not exists tags_usuario (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id) on delete cascade,
  tag text not null,
  created_at timestamptz not null default now(),
  unique (usuario_id, tag)
);

-- Fontes que o usuário bloqueou ("não mostrar mais dessa fonte")
create table if not exists fontes_bloqueadas (
  usuario_id uuid not null references auth.users(id) on delete cascade,
  fonte_id text not null references fontes_rss(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (usuario_id, fonte_id)
);

-- Fontes que o usuário efetivamente segue (se vazio, assume-se "todas as ativas")
create table if not exists fontes_seguidas (
  usuario_id uuid not null references auth.users(id) on delete cascade,
  fonte_id text not null references fontes_rss(id) on delete cascade,
  primary key (usuario_id, fonte_id)
);

-- Row Level Security: cada usuário só mexe nos próprios dados
alter table tags_usuario enable row level security;
alter table fontes_bloqueadas enable row level security;
alter table fontes_seguidas enable row level security;

create policy "tags: dono le/escreve" on tags_usuario
  for all using (auth.uid() = usuario_id) with check (auth.uid() = usuario_id);

create policy "bloqueadas: dono le/escreve" on fontes_bloqueadas
  for all using (auth.uid() = usuario_id) with check (auth.uid() = usuario_id);

create policy "seguidas: dono le/escreve" on fontes_seguidas
  for all using (auth.uid() = usuario_id) with check (auth.uid() = usuario_id);

-- fontes_rss é público pra leitura (catálogo), sem RLS de escrita pro usuário comum
alter table fontes_rss enable row level security;
create policy "fontes: leitura publica" on fontes_rss
  for select using (true);

-- Seed inicial de fontes (ajuste/complemente depois de validar os RSS reais)
insert into fontes_rss (id, nome, url_rss, idioma, categoria_padrao) values
  ('bbc-brasil', 'BBC Brasil', 'https://www.bbc.com/portuguese/index.xml', 'pt-br', 'geral'),
  ('g1', 'G1', 'https://g1.globo.com/rss/g1/', 'pt-br', 'geral'),
  ('clicrdc', 'ClicRDC', 'https://clicrdc.com.br/feed/', 'pt-br', 'regional-chapeco'),
  ('diregional', 'Diário do Iguaçu', 'https://diregional.com.br/feed/', 'pt-br', 'regional-chapeco'),
  ('theverge', 'The Verge', 'https://www.theverge.com/rss/index.xml', 'en', 'tecnologia'),
  ('hackernews', 'Hacker News (front page)', 'https://hnrss.org/frontpage', 'en', 'programacao')
on conflict (id) do nothing;
