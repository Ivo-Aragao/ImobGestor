
import { Router } from 'express';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { google } from 'googleapis';
import { rateLimit } from 'express-rate-limit';

import { prisma } from '../lib/prisma.js';
import { AppError, asyncHandler } from '../lib/errors.js';
import { requireUser } from '../middlewares/auth.js';
import { encryptSecret, decryptSecret } from '../lib/secure-secrets.js';
import { sendEmail } from '../lib/mailer.js';

const router = Router();

const PROVIDER = 'GOOGLE_GMAIL';
const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.send';

const GOOGLE_IDENTITY_SCOPES = [
  'openid',
  'email',
];

const testLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 3,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});

function getOAuthClient() {
  const {
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI,
  } = process.env;

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI) {
    throw new AppError(503, 'As credenciais OAuth do Google não estão configuradas.');
  }

  return new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI
  );
}

function getStateSecret() {
  const secret = process.env.GOOGLE_OAUTH_STATE_SECRET || '';

  if (secret.length < 32) {
    throw new AppError(503, 'A chave de segurança OAuth não está configurada corretamente.');
  }

  return secret;
}

function createSignedState(payload) {
  const encoded = Buffer
    .from(JSON.stringify(payload))
    .toString('base64url');

  const signature = createHmac('sha256', getStateSecret())
    .update(encoded)
    .digest('base64url');

  return `${encoded}.${signature}`;
}

function verifySignedState(state) {
  if (typeof state !== 'string') {
    throw new AppError(400, 'Estado OAuth ausente.');
  }

  const parts = state.split('.');

  if (parts.length !== 2) {
    throw new AppError(400, 'Estado OAuth inválido.');
  }

  const [encoded, suppliedSignature] = parts;

  const expectedSignature = createHmac('sha256', getStateSecret())
    .update(encoded)
    .digest();

  const actualSignature = Buffer.from(suppliedSignature, 'base64url');

  if (
    actualSignature.length !== expectedSignature.length ||
    !timingSafeEqual(actualSignature, expectedSignature)
  ) {
    throw new AppError(400, 'Assinatura do estado OAuth inválida.');
  }

  let payload;

  try {
    payload = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf8')
    );
  } catch {
    throw new AppError(400, 'Dados do estado OAuth inválidos.');
  }

  const age = Date.now() - Number(payload.issuedAt);

  if (
    !payload.userId ||
    !payload.tenantId ||
    !payload.nonce ||
    age < 0 ||
    age > 10 * 60 * 1000
  ) {
    throw new AppError(400, 'A autorização expirou. Inicie novamente a conexão.');
  }

  return payload;
}

/**
 * Somente o proprietário autorizado da plataforma
 * pode conectar ou remover a conta global.
 */
async function requireIntegrationOwner(req, res, next) {
  try {
    if (req.auth?.role !== 'OWNER') {
      throw new AppError(403, 'Somente o proprietário pode gerenciar esta integração.');
    }

    const authorizedEmail = process.env.INTEGRATIONS_ADMIN_EMAIL
      ?.trim()
      .toLowerCase();

    if (!authorizedEmail) {
      throw new AppError(503, 'Configure INTEGRATIONS_ADMIN_EMAIL no backend.');
    }

    const user = await prisma.user.findUnique({
      where: { id: req.auth.userId },
      select: { email: true },
    });

    if (user?.email?.toLowerCase() !== authorizedEmail) {
      throw new AppError(403, 'Esta conta não está autorizada a gerenciar integrações.');
    }

    next();
  } catch (error) {
    next(error);
  }
}

function frontendResult(status) {
  const base = process.env.FRONTEND_URL || 'http://localhost:5173';
  const url = new URL('/integrations', base);

  url.searchParams.set('google', status);

  return url.toString();
}

/**
 * Status das integrações.
 */
router.get(
  '/status',
  requireUser,
  asyncHandler(async (_req, res) => {
    const credential = await prisma.integrationCredential.findUnique({
      where: { provider: PROVIDER },
      select: {
        accountEmail: true,
        connectedAt: true,
      },
    });

    res.json({
      email: Boolean(credential),
      emailConnected: Boolean(credential),
      emailAddress: credential?.accountEmail || null,
      emailConnectedAt: credential?.connectedAt || null,

      // O Vercel Blob será ativado em uma próxima etapa.
      storage: false,

      electronicSignature: Boolean(
        process.env.SIGNATURE_PROVIDER_URL &&
        process.env.SIGNATURE_PROVIDER_TOKEN
      ),

      paymentGateway: Boolean(process.env.PAYMENT_PROVIDER_TOKEN),

      publicData: {
        pncp: false,
        incra: false,
        registry: false,
      },
    });
  })
);

/**
 * Inicia a conexão com o Google.
 */
router.get(
  '/google/connect',
  requireUser,
  requireIntegrationOwner,
  asyncHandler(async (req, res) => {
    const oauth = getOAuthClient();

    const state = createSignedState({
      userId: req.auth.userId,
      tenantId: req.auth.tenantId,
      issuedAt: Date.now(),
      nonce: randomBytes(24).toString('hex'),
    });

    const url = oauth.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent',
  include_granted_scopes: true,
  scope: [
    GMAIL_SCOPE,
    ...GOOGLE_IDENTITY_SCOPES,
  ],
  state,
});

    res.json({ url });
  })
);

/**
 * Recebe o retorno da autorização do Google.
 * A validação do state substitui a necessidade de
 * exigir novamente o cookie de sessão neste callback.
 */
router.get(
  '/google/callback',
  asyncHandler(async (req, res) => {
    try {
      if (req.query.error) {
        throw new Error('A autorização do Google foi cancelada.');
      }

      const code = String(req.query.code || '');
      const state = String(req.query.state || '');

      if (!code) {
        throw new Error('Código de autorização não recebido.');
      }

      const payload = verifySignedState(state);

      // Confirma que quem iniciou a autorização continua
      // sendo o proprietário ativo do escritório.
      const membership = await prisma.membership.findFirst({
        where: {
          userId: payload.userId,
          tenantId: payload.tenantId,
          role: 'OWNER',
          isActive: true,
          tenant: { status: 'ACTIVE' },
          user: { status: 'ACTIVE' },
        },
        select: { id: true },
      });

      if (!membership) {
        throw new Error('O proprietário que iniciou a conexão não está mais autorizado.');
      }

      const owner = await prisma.user.findUnique({
        where: { id: payload.userId },
        select: { email: true },
      });

      const adminEmail = process.env.INTEGRATIONS_ADMIN_EMAIL
        ?.trim()
        .toLowerCase();

      if (!owner || owner.email?.toLowerCase() !== adminEmail) {
        throw new Error('Conta administrativa não autorizada.');
      }

      const oauth = getOAuthClient();
      const { tokens } = await oauth.getToken(code);

      const previous = await prisma.integrationCredential.findUnique({
        where: { provider: PROVIDER },
      });

      // O Google pode não retornar um refresh_token em
      // reconexões. Nesse caso, preservamos o anterior.
      const refreshToken =
        tokens.refresh_token ||
        (previous
          ? decryptSecret(previous.encryptedRefreshToken)
          : null);

      if (!refreshToken) {
        throw new Error(
          'O Google não forneceu autorização offline. Tente conectar novamente.'
        );
      }

      oauth.setCredentials({
        ...tokens,
        refresh_token: refreshToken,
      });

      // Identifica a conta Google pelo OpenID Connect.
// Não precisamos de acesso aos metadados da caixa postal.
const googleIdentity = google.oauth2({
  version: 'v2',
  auth: oauth,
});

const { data: profile } = await googleIdentity.userinfo.get();

const accountEmail = profile.email
  ?.trim()
  .toLowerCase();

if (!accountEmail || profile.verified_email !== true) {
  throw new Error(
    'Não foi possível confirmar o endereço da conta Google.'
  );
}

      const expectedEmail = process.env.GOOGLE_SENDER_EMAIL
        ?.trim()
        .toLowerCase();

      if (expectedEmail && accountEmail !== expectedEmail) {
        throw new Error(
          'A conta Google autorizada não corresponde ao GOOGLE_SENDER_EMAIL.'
        );
      }

      await prisma.integrationCredential.upsert({
        where: { provider: PROVIDER },

        create: {
          provider: PROVIDER,
          encryptedRefreshToken: encryptSecret(refreshToken),
          accountEmail,
          connectedByUserId: payload.userId,
        },

        update: {
          encryptedRefreshToken: encryptSecret(refreshToken),
          accountEmail,
          connectedByUserId: payload.userId,
          connectedAt: new Date(),
        },
      });

      return res.redirect(303, frontendResult('connected'));

    } catch (error) {
      console.error('[google-oauth-callback]', error.message);

      return res.redirect(303, frontendResult('error'));
    }
  })
);

/**
 * Envia um e-mail de teste para o proprietário.
 */
router.post(
  '/google/test',
  requireUser,
  requireIntegrationOwner,
  testLimiter,
  asyncHandler(async (req, res) => {
    const owner = await prisma.user.findUnique({
      where: { id: req.auth.userId },
      select: { email: true },
    });

    if (!owner?.email) {
      throw new AppError(400, 'Não foi encontrado um e-mail para o usuário.');
    }

    const result = await sendEmail({
      to: owner.email,
      subject: 'Teste de integração Gmail — ImobGestor',
      text: 'A integração do Gmail com o ImobGestor está funcionando corretamente.',
      html: `
        <div style="font-family:Arial,sans-serif;padding:24px;color:#26332e">
          <h2 style="color:#174d3d">Integração concluída!</h2>
          <p>O ImobGestor conseguiu enviar esta mensagem pela sua conta Google.</p>
          <p>Sua integração Gmail está funcionando.</p>
        </div>
      `,
    });

    if (!result.sent) {
      throw new AppError(503, 'Gmail não está conectado. Conecte sua conta primeiro.');
    }

    res.json({
      sent: true,
      message: 'E-mail de teste enviado com sucesso.',
      to: owner.email,
      messageId: result.id,
    });
  })
);

/**
 * Desconecta a conta Google.
 */
router.delete(
  '/google',
  requireUser,
  requireIntegrationOwner,
  asyncHandler(async (_req, res) => {
    const credential = await prisma.integrationCredential.findUnique({
      where: { provider: PROVIDER },
    });

    if (credential) {
      try {
        const oauth = getOAuthClient();
        const refreshToken = decryptSecret(
          credential.encryptedRefreshToken
        );

        await oauth.revokeToken(refreshToken);
      } catch (error) {
        console.warn(
          '[google-disconnect] Não foi possível revogar no Google:',
          error.message
        );
      }

      await prisma.integrationCredential.delete({
        where: { provider: PROVIDER },
      });
    }

    res.json({
      disconnected: true,
      message: 'Conta Google desconectada do ImobGestor.',
    });
  })
);

export default router;
