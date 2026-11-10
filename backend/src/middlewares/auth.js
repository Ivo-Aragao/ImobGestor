
import { prisma } from '../lib/prisma.js';
import { verifySession } from '../lib/tokens.js';
import { AppError } from '../lib/errors.js';

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/',
};

function handleInvalidSession(req, res) {
  res.clearCookie('imob_session', cookieOptions);

  return res.status(401).json({
    error: 'Sua sessão expirou ou é inválida. Faça login novamente.',
    code: 'INVALID_SESSION',
  });
}

export async function requireUser(req, res, next) {
  try {
    const token = req.cookies?.imob_session;

    if (!token) {
      throw new AppError(401, 'Faça login para continuar.');
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
        return handleInvalidSession(req, res);
      }

      throw error;
    }

    if (
      payload.type !== 'user' ||
      !payload.sub ||
      !payload.tenantId
    ) {
      return handleInvalidSession(req, res);
    }

    const membership = await prisma.membership.findFirst({
      where: {
        userId: payload.sub,
        tenantId: payload.tenantId,
        tenant: {
          status: 'ACTIVE',
        },
        user: {
          status: 'ACTIVE',
        },
        isActive: true,
      },
      select: {
        id: true,
        role: true,
        permissions: true,
        tenantId: true,
        userId: true,
      },
    });

    if (!membership) {
      throw new AppError(
        403,
        'Acesso ao escritório não autorizado.'
      );
    }

    req.auth = {
      type: 'user',
      userId: membership.userId,
      tenantId: membership.tenantId,
      role: membership.role,
      permissions: membership.permissions,
    };

    next();

  } catch (error) {
    next(error);
  }
}

export function requireRoles(...roles) {
  return (req, res, next) => {
    if (!req.auth || !roles.includes(req.auth.role)) {
      return next(
        new AppError(
          403,
          'Você não tem permissão para esta operação.'
        )
      );
    }

    next();
  };
}
