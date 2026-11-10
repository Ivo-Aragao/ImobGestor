import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { AppError, asyncHandler } from '../lib/errors.js';
import { hashPassword, verifyPassword, validatePassword } from '../lib/password.js';
import { signSession } from '../lib/tokens.js';
import { createHash, randomBytes } from 'node:crypto';
import { sendEmail, escapeHtml } from '../lib/mailer.js';
import { requireUser } from '../middlewares/auth.js';

const router = Router();
const cookieBase = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/',
  ...(process.env.COOKIE_DOMAIN ? { domain: process.env.COOKIE_DOMAIN } : {}),
};

router.post('/register', asyncHandler(async (req, res) => {
  const schema = z.object({
    tenantName: z.string().trim().min(2).max(120),
    name: z.string().trim().min(2).max(120),
    email: z.string().trim().email().transform(v => v.toLowerCase()),
    password: z.string(),
  });
  const input = schema.parse(req.body);
  const passwordError = validatePassword(input.password);
  if (passwordError) throw new AppError(400, passwordError);
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) throw new AppError(409, 'Este e-mail já possui uma conta.');

  const passwordHash = await hashPassword(input.password);
  const publicSignupAllowed = process.env.NODE_ENV !== 'production' || process.env.ALLOW_PUBLIC_SIGNUP === 'true';
  const result = await prisma.$transaction(async tx => {
    const userCount = await tx.user.count();
    if (!publicSignupAllowed && userCount > 0) {
      throw new AppError(403, 'O cadastro público está desativado. Solicite um convite ao administrador da plataforma.');
    }
    const tenant = await tx.tenant.create({ data: { name: input.tenantName } });
    const user = await tx.user.create({ data: { name: input.name, email: input.email, passwordHash } });
    const membership = await tx.membership.create({ data: { tenantId: tenant.id, userId: user.id, role: 'OWNER' } });
    const initialPlan = await tx.plan.findUnique({ where: { slug: 'inicial' } });
    if (initialPlan) {
      const trialEnd = new Date(Date.now() + 14 * 86400000);
      await tx.subscription.create({ data: { tenantId: tenant.id, planId: initialPlan.id, status: 'TRIAL', trialEndsAt: trialEnd, currentPeriodEnd: trialEnd } });
    }
    return { tenant, user, membership };
  }, { isolationLevel: 'Serializable' });

  const isPlatformAdmin = (process.env.ADMIN_EMAILS || '').split(',').map(x => x.trim().toLowerCase()).includes(input.email);
  const token = signSession({ type: 'user', sub: result.user.id, tenantId: result.tenant.id });
  res.cookie('imob_session', token, { ...cookieBase, maxAge: 8 * 60 * 60 * 1000 });
  res.status(201).json({
    user: { id: result.user.id, name: result.user.name, email: result.user.email, role: result.membership.role, isPlatformAdmin },
    tenant: { id: result.tenant.id, name: result.tenant.name },
  });
}));

router.post('/login', asyncHandler(async (req, res) => {
  const schema = z.object({ email: z.string().email().transform(v => v.toLowerCase()), password: z.string().min(1), tenantId: z.string().optional() });
  const input = schema.parse(req.body);
  const user = await prisma.user.findUnique({
    where: { email: input.email },
    include: { memberships: { include: { tenant: true } } },
  });
  if (!user || user.status !== 'ACTIVE' || !(await verifyPassword(input.password, user.passwordHash))) {
    throw new AppError(401, 'E-mail ou senha inválidos.');
  }
  const memberships = user.memberships.filter(m => m.tenant.status === 'ACTIVE' && m.isActive);
  if (!memberships.length) throw new AppError(403, 'Sua conta não possui escritório ativo.');
  if (memberships.length > 1 && !input.tenantId) return res.status(409).json({ error: 'Selecione o escritório para continuar.', memberships: memberships.map(m => ({ tenantId: m.tenantId, tenantName: m.tenant.name, role: m.role })) });
  const membership = input.tenantId ? memberships.find(m => m.tenantId === input.tenantId) : memberships[0];
  if (!membership) throw new AppError(403, 'Você não pertence ao escritório selecionado.');
  const token = signSession({ type: 'user', sub: user.id, tenantId: membership.tenantId });
  res.cookie('imob_session', token, { ...cookieBase, maxAge: 8 * 60 * 60 * 1000 });
  res.json({
    user: { id: user.id, name: user.name, email: user.email, role: membership.role, isPlatformAdmin: (process.env.ADMIN_EMAILS || '').split(',').map(x => x.trim().toLowerCase()).includes(user.email.toLowerCase()) },
    tenant: { id: membership.tenant.id, name: membership.tenant.name },
  });
}));

router.post('/forgot-password', asyncHandler(async (req, res) => {
  const input = z.object({ email: z.string().email().transform(v => v.toLowerCase()) }).parse(req.body);
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  // Respond identically whether or not the account exists.
  if (user && user.status === 'ACTIVE') {
    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    await prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash, expiresAt: new Date(Date.now() + 30 * 60 * 1000) } });
    const url = `${process.env.APP_PUBLIC_URL || process.env.FRONTEND_URL || 'http://localhost:5173'}/reset-password?token=${rawToken}`;
    try { await sendEmail({ to: user.email, subject: 'Recuperação de senha — ImobGestor', text: `Para criar uma nova senha, acesse: ${url}. O link expira em 30 minutos.`, html: `<p>Solicitação de recuperação de senha.</p><p><a href="${escapeHtml(url)}">Criar nova senha</a></p><p>O link expira em 30 minutos.</p>` }); }
    catch (error) { console.error('[password-reset-email]', error.message); }
    if (process.env.NODE_ENV !== 'production') res.locals.developmentResetUrl = url;
  }
  res.json({ message: 'Se o e-mail estiver cadastrado, enviaremos as instruções de recuperação.', ...(res.locals.developmentResetUrl ? { developmentResetUrl: res.locals.developmentResetUrl } : {}) });
}));

router.post('/reset-password', asyncHandler(async (req, res) => {
  const input = z.object({ token: z.string().min(32), password: z.string() }).parse(req.body);
  const passwordError = validatePassword(input.password);
  if (passwordError) throw new AppError(400, passwordError);
  const tokenHash = createHash('sha256').update(input.token).digest('hex');
  const record = await prisma.passwordResetToken.findFirst({ where: { tokenHash, usedAt: null, expiresAt: { gt: new Date() } } });
  if (!record) throw new AppError(400, 'Link inválido ou expirado. Solicite uma nova recuperação.');
  const passwordHash = await hashPassword(input.password);
  await prisma.$transaction([
    prisma.user.update({ where: { id: record.userId }, data: { passwordHash } }),
    prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
    prisma.passwordResetToken.updateMany({ where: { userId: record.userId, usedAt: null, id: { not: record.id } }, data: { usedAt: new Date() } }),
  ]);
  res.json({ message: 'Senha alterada com sucesso. Faça login com a nova senha.' });
}));

router.post('/accept-team-invite', asyncHandler(async (req, res) => {
  const input = z.object({ token: z.string().min(32), name: z.string().trim().min(2).max(120).optional(), password: z.string().optional() }).parse(req.body);
  const tokenHash = createHash('sha256').update(input.token).digest('hex');
  const invite = await prisma.teamInvite.findFirst({ where: { tokenHash, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } }, include: { tenant: true } });
  if (!invite || invite.tenant.status !== 'ACTIVE') throw new AppError(400, 'Convite inválido, revogado ou expirado. Solicite um novo convite.');
  let user = await prisma.user.findUnique({ where: { email: invite.email } });
  if (user && user.status !== 'ACTIVE') throw new AppError(403, 'Esta conta está inativa. Entre em contato com o administrador da plataforma.');
  if (!user) {
    const passwordError = validatePassword(input.password || '');
    if (passwordError) throw new AppError(400, passwordError);
    if (!input.name) throw new AppError(400, 'Informe seu nome para concluir o cadastro.');
  }
  const result = await prisma.$transaction(async tx => {
    if (!user) user = await tx.user.create({ data: { name: input.name, email: invite.email, passwordHash: await hashPassword(input.password) } });
    const existing = await tx.membership.findUnique({ where: { tenantId_userId: { tenantId: invite.tenantId, userId: user.id } } });
    if (!existing) await tx.membership.create({ data: { tenantId: invite.tenantId, userId: user.id, role: invite.role, permissions: invite.permissions } });
    else if (!existing.isActive) await tx.membership.update({ where: { id: existing.id }, data: { isActive: true, role: invite.role, permissions: invite.permissions } });
    await tx.teamInvite.update({ where: { id: invite.id }, data: { acceptedAt: new Date() } });
    return user;
  });
  const token = signSession({ type: 'user', sub: result.id, tenantId: invite.tenantId });
  res.cookie('imob_session', token, { ...cookieBase, maxAge: 8 * 60 * 60 * 1000 });
  res.status(201).json({ user: { id: result.id, name: result.name, email: result.email }, tenant: { id: invite.tenant.id, name: invite.tenant.name } });
}));

router.post('/logout', (req, res) => {
  res.clearCookie('imob_session', cookieBase);
  res.status(204).end();
});

router.get('/me', requireUser, asyncHandler(async (req, res) => {
  // Esta rota é protegida no router principal por requireUser.
  const user = await prisma.user.findUnique({ where: { id: req.auth.userId }, select: { id: true, name: true, email: true } });
  const tenant = await prisma.tenant.findUnique({ where: { id: req.auth.tenantId }, select: { id: true, name: true } });
  res.json({ user: { ...user, role: req.auth.role, permissions: req.auth.permissions || {}, isPlatformAdmin: (process.env.ADMIN_EMAILS || '').split(',').map(x => x.trim().toLowerCase()).includes(user.email.toLowerCase()) }, tenant });
}));

export default router;
