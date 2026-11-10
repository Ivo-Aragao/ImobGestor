# Deploy na Vercel sem Docker

O repositório utiliza dois projetos Vercel: frontend (`frontend`) e backend (`backend`). O PostgreSQL deve ser gerenciado (Neon recomendado).

## Backend

- Root Directory: `backend`.
- O arquivo `backend/index.js` exporta a aplicação Express por `export default app`.
- A Vercel detecta o entry point Express e o executa como função serverless. Não use `app.listen()` no entry point de produção; o `app.listen()` fica isolado em `src/dev-server.js` para desenvolvimento local.
- Build Command: `npm run db:generate`.
- Configure as variáveis de `backend/.env.example` no painel Vercel.
- O `backend/vercel.json` agenda o cron diário.

## Frontend

- Root Directory: `frontend`.
- Framework: Vite; Build Command `npm run build`; Output Directory `dist`.
- `frontend/vercel.json` encaminha `/api/*` para o domínio do backend. Substitua `SUBSTITUA-PELA-URL-DO-BACKEND` pelo domínio real após publicar a API.
- Depois de alterar o destino do proxy, faça novo deploy do frontend.

## Banco de dados

Use `DATABASE_URL` pooled para a aplicação e `DIRECT_URL` direta para migrações. Execute `prisma migrate dev` localmente para criar e versionar a migração inicial. Depois, publique a pasta `prisma/migrations` no Git e use `prisma migrate deploy` no ambiente de implantação.

Não é necessário Docker. Para desenvolvimento local, use PostgreSQL instalado no Windows ou um banco Neon separado de produção.
