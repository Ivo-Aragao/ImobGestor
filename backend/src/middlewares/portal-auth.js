
import { prisma } from '../lib/prisma.js';
import { verifySession } from '../lib/tokens.js';
import { AppError } from '../lib/errors.js';

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/',
};

export async function requirePortalAccount(req, res, next) {
  try {
    const token = req.cookies?.imob_portal_session;

    if (!token) {
      throw new AppError(
        401,
        'Entre no portal para continuar.'
      );
    }

    let payload;

    try {
      payload = verifySession(token);
    } catch (error) {
      if (
        error.name === 'JsonWebTokenError' ||
        error.name === 'TokenExpiredError' ||
        error.name === 'NotBeforeError'
      ) {
        res.clearCookie(
          'imob_portal_session',
          cookieOptions
        );

        return res.status(401).json({
          error: 'Sua sessão do portal expirou. Entre novamente.',
          code: 'INVALID_PORTAL_SESSION',
        });
      }

      throw error;
    }

    if (
      payload.type !== 'portal' ||
      !payload.sub ||
      !payload.tenantId
    ) {
      res.clearCookie(
        'imob_portal_session',
        cookieOptions
      );

      return res.status(401).json({
        error: 'Sessão do portal inválida.',
        code: 'INVALID_PORTAL_SESSION',
      });
    }

    const account = await prisma.portalAccount.findFirst({
      where: {
        id: payload.sub,
        tenantId: payload.tenantId,
        status: 'ACTIVE',
        tenant: {
          status: 'ACTIVE',
        },
      },
      select: {
        id: true,
        tenantId: true,
        clientId: true,
        email: true,
      },
    });

    if (!account) {
      throw new AppError(
        403,
        'Conta do portal inativa.'
      );
    }

    req.portal = account;

    next();

  } catch (error) {
    next(error);
  }
}
