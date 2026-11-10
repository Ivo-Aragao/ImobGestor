import { prisma } from './prisma.js';

export async function writeAudit(req, action, entityType, entityId = null, metadata = undefined) {
  if (!req.auth?.tenantId) return;
  try {
    await prisma.auditLog.create({
      data: {
        tenantId: req.auth.tenantId,
        userId: req.auth.userId ?? null,
        action,
        entityType,
        entityId,
        metadata,
        ipAddress: req.ip?.slice(0, 64),
      },
    });
  } catch (error) {
    // A falha de auditoria deve ser observada, mas não deve expor dados ao usuário.
    console.error('Falha ao gravar auditoria:', error.message);
  }
}
