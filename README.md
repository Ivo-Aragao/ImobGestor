# ImobGestor — Vercel Edition (sem Docker)

Plataforma SaaS multiempresa para gestão de regularização imobiliária. Esta edição foi ampliada para incluir equipe/permissões, agenda, financeiro, relatórios, modelos de documentos, notificações, auditoria, configurações do escritório, administração SaaS e rotina diária de lembretes. **Não inclui aplicativo Android/iOS nativo**; o acesso móvel é pela interface web responsiva.

## Requisitos

- Node.js 20 ou superior
- npm 10 ou superior
- PostgreSQL gerenciado (Neon recomendado) ou PostgreSQL instalado localmente no Windows
- VS Code (opcional)
- Conta Vercel para publicação
- Bucket privado S3 compatível (Cloudflare R2 recomendado) para uploads

Não é necessário Docker.

## 1. Instalação local no Windows

Na raiz `imobgestor`:

```powershell
npm install
Copy-Item backend/.env.example backend/.env
Copy-Item frontend/.env.example frontend/.env
```

Edite `backend/.env` e configure `DATABASE_URL`, `DIRECT_URL` e `JWT_SECRET`. Para usar o Neon, cole as duas URLs fornecidas pelo painel do Neon. Não use aspas extras além das que já constam no exemplo, e nunca publique o `.env` no Git.

Gere um segredo forte:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Para desenvolvimento local sem Docker, use um PostgreSQL instalado no Windows ou o banco Neon. Não é necessário executar `docker compose`.

Gere e valide o Prisma Client:

```powershell
npm run db:validate
npm run db:generate
```

Crie as tabelas no banco de desenvolvimento e os planos iniciais:

```powershell
cd backend
npm run db:migrate -- --name fase1_completa
cd ..
npm run db:seed
```

Inicie o backend e frontend juntos:

```powershell
npm run dev
```

- Frontend: `http://localhost:5173`
- API: `http://localhost:4000`
- Health check: `http://localhost:4000/health`

O Vite encaminha `/api/*` para `localhost:4000`; o Axios usa `/api/v1` como caminho padrão.

## 2. Variáveis de ambiente do backend

Veja `backend/.env.example`. As variáveis principais:

- `DATABASE_URL`: conexão pooled usada pela aplicação.
- `DIRECT_URL`: conexão direta usada pelas migrações Prisma.
- `JWT_SECRET`: segredo aleatório forte, diferente entre desenvolvimento e produção.
- `FRONTEND_URL`: origem do frontend; pode receber origens separadas por vírgula.
- `APP_PUBLIC_URL`: URL pública do frontend usada nos convites e recuperação de senha.
- `ADMIN_EMAILS`: e-mails que terão acesso ao painel administrativo global, separados por vírgula.
- `ALLOW_PUBLIC_SIGNUP`: em produção mantenha `false`; em desenvolvimento o cadastro é permitido.
- `CRON_SECRET`: segredo para proteger a rotina diária.
- `RESEND_API_KEY` e `MAIL_FROM`: e-mail transacional.
- `S3_BUCKET`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`: storage privado S3/R2.

O envio de e-mails usa a API REST do Resend e não exige domínio para testes locais. Para produção, configure um remetente/domínio verificado conforme as regras do provedor.

## 3. Configuração do Cloudflare R2

Crie um bucket **privado**, gere credenciais de acesso e preencha as variáveis S3 no backend. Não torne o bucket público. A aplicação gera URLs assinadas com validade curta. O navegador envia o arquivo diretamente ao storage, sem passar o conteúdo pelo servidor Express.

Até configurar o bucket, as funções de upload/download responderão com `503` de armazenamento não configurado. Isso é intencional.

## 4. Deploy na Vercel

Publique o mesmo repositório em dois projetos Vercel:

### Projeto frontend

- Root Directory: `frontend`
- Framework: Vite
- Build Command: `npm run build`
- Output Directory: `dist`
- Variável `VITE_API_URL`: deixe vazia para usar o proxy `/api`.
- Edite `frontend/vercel.json` e substitua `SUBSTITUA-PELA-URL-DO-BACKEND` pela URL final do projeto backend.

### Projeto backend

- Root Directory: `backend`
- Framework preset: Other
- Build Command: `npm run db:generate`
- Install Command: `npm install`
- Entry point: `index.js` na raiz do backend; não configure um segundo entry point em `api/index.js`.
- O entrypoint da API é `backend/index.js`, que exporta a aplicação Express. Com o Root Directory em `backend`, a Vercel detecta o app Express automaticamente e o publica como uma função serverless.
- Configure todas as variáveis de `backend/.env.example` no painel Vercel do backend.
- `FRONTEND_URL` deve conter a URL do frontend publicada.
- `APP_PUBLIC_URL` deve ser a URL do frontend publicada.
- Configure `DATABASE_URL` e `DIRECT_URL` com as URLs do Neon.
- Configure `ADMIN_EMAILS` com seu e-mail.
- Configure `CRON_SECRET` com um segredo forte.

Depois de publicar o backend, atualize `frontend/vercel.json` com a URL real e faça novo deploy do frontend.

### Migrações de produção

Execute migrações controladamente antes de liberar a nova versão:

```powershell
npm run db:deploy
```

O comando deve rodar com `DATABASE_URL` e `DIRECT_URL` válidas no ambiente administrativo/local seguro. Não execute `prisma migrate dev` em produção.

## 5. Administração SaaS

Adicione seu e-mail à variável `ADMIN_EMAILS` do backend. Entre normalmente no ImobGestor e abra `/platform-admin`. O backend valida o e-mail; esconder o link na interface não é considerado proteção.

Crie os planos iniciais com:

```powershell
npm run db:seed
```

O painel permite visualizar escritórios, ativar/suspender tenants, criar planos e atribuir planos/estados de assinatura. **Cobrança recorrente automática e webhooks de pagamento ainda dependem da escolha e implementação de um gateway**; a atribuição manual de plano não processa pagamentos.

## 6. Rotina diária

`backend/vercel.json` agenda `/api/v1/cron/daily` todos os dias às 11:00 UTC (08:00 em America/Fortaleza). A Vercel envia o segredo configurado como `CRON_SECRET` no cabeçalho de autorização. A rotina cria notificações para tarefas e compromissos do dia seguinte e tenta enviar e-mail quando o Resend estiver configurado.

Teste a rota em ambiente de homologação e confirme o funcionamento do Cron no plano Vercel contratado antes de depender dos lembretes.

## 7. Módulos incluídos nesta entrega

- Autenticação, recuperação de senha e aceitação de convites de equipe.
- Clientes e imóveis, incluindo campos específicos para imóvel rural (CAR, INCRA, CCIR, ITR, NIRF/CIB e georreferenciamento).
- Catálogo de serviços personalizáveis e procedimentos com cópia de versões do modelo.
- Documentos em storage privado S3/R2, solicitações e publicação controlada no portal.
- Portal independente do cliente, com ativação por convite, upload de documentos, solicitações de atendimento e troca de mensagens com o escritório.
- Equipe, convites, funções, permissões por funcionalidade e ativação/desativação de vínculo no escritório. O menu interno respeita as permissões retornadas pela API.
- Agenda mensal, compromissos e prazos internos.
- Financeiro básico: receitas, despesas, parcelas identificadas e baixa manual.
- Dashboard ampliado, relatórios por serviço/status e resumo mensal.
- Modelos de documentos com campos variáveis, pré-visualização e exportação HTML para impressão.
- Notificações internas, e-mail transacional opcional, histórico de auditoria.
- Administração SaaS, planos, assinaturas manuais e suspensão de escritórios.
- Rotina diária para lembretes de tarefas, compromissos e vencimento de documentos.
- Regras configuráveis de automação por evento, com notificações, e-mails e criação automática de tarefas.

## 8. Limites conhecidos / próximas integrações

A versão não inclui app nativo Android/iOS.

- Assinatura eletrônica: a tela de integrações mostra o estado, mas a integração operacional depende da escolha do provedor (Clicksign, D4Sign, DocuSign etc.) e implementação do adaptador/webhooks correspondente.
- Pagamentos: planos e assinaturas podem ser administrados, mas não há cobrança recorrente automática, gateway ou conciliação implementada.
- Fontes públicas/cartórios: não há integração automática com INCRA/SIGEF, Receita, cartórios ou outros órgãos; cada API precisa ser avaliada quanto à disponibilidade, autorização e regras de uso.
- Modelos de documentos: exportação HTML para impressão; não há geração DOCX/PDF com assinatura digital nesta entrega.
- Notificações: a rotina diária é baseada em Vercel Cron; é preciso verificar o Cron no plano contratado e testar o segredo.
- Segurança: antes de produção, faça revisão independente, teste de isolamento multi-tenant, antivírus no fluxo de arquivos, backup/restauração, política de retenção e revisão LGPD.

## 9. Segurança e práticas

- Nunca compartilhe `.env` nem credenciais do Neon/R2/Resend.
- Nunca deixe o bucket público.
- Não use dados reais de clientes até validar os fluxos e a segurança.
- O cadastro público deve ficar desativado em produção (`ALLOW_PUBLIC_SIGNUP=false`). Prefira convites.
- O painel `/platform-admin` só é autorizado pelo backend para e-mails em `ADMIN_EMAILS`.
- A tabela `Membership` permite desativar o acesso de um usuário a um escritório sem desativar sua conta global.
- Verifique RLS/isolamento, exportação e exclusão antes de lançar.


Consulte `docs/ESCOPO-ENTREGA.md` para ver o que foi incluído, o que depende de fornecedores externos e quais validações ainda devem ser feitas antes de produção.
