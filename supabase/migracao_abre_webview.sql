-- Adiciona a flag de "essa fonte abre em webview ou não" direto no catálogo.
-- É uma característica do site (ele bloqueia iframe ou não), não uma preferência
-- pessoal — por isso fica compartilhada entre quem usa o app, e não por usuário.
--
-- Rode isso se seu banco já existia antes dessa mudança. Se você está montando
-- o banco do zero, não precisa: o schema.sql principal já inclui essa coluna.

alter table fontes_rss
  add column if not exists abre_webview boolean not null default true;

-- Autenticado pode atualizar o catálogo (só essa flag, na prática — controlado pela API).
-- Como é um app pessoal/pequeno, não vale a pena criar policy por coluna aqui.
-- Se você já rodou isso antes (ou já criou essa policy manualmente), o CREATE
-- abaixo vai falhar com "already exists" — nesse caso pode ignorar o erro.
create policy "fontes: autenticado atualiza" on fontes_rss
  for update using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
