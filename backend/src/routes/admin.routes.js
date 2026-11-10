import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { AppError, asyncHandler } from '../lib/errors.js';
import { requireUser } from '../middlewares/auth.js';
import { createHash, randomBytes } from 'node:crypto';
import { sendEmail, escapeHtml } from '../lib/mailer.js';

const router = Router();
router.use(requireUser);
const allowedAdmins = new Set((process.env.ADMIN_EMAILS || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean));
router.use(asyncHandler(async (req, _res, next) => {
  const user = await prisma.user.findUnique({ where: { id: req.auth.userId }, select: { email: true } });
  if (!user || !allowedAdmins.has(user.email.toLowerCase())) throw new AppError(403, 'Acesso restrito ao administrador da plataforma. Configure ADMIN_EMAILS.');
  next();
}));

router.get('/overview', asyncHandler(async (_req, res) => {
  const [tenants, activeTenants, users, clients, cases, plans, subscriptions] = await Promise.all([
    prisma.tenant.count(), prisma.tenant.count({ where: { status: 'ACTIVE' } }), prisma.user.count(), prisma.client.count(), prisma.case.count(), prisma.plan.count(), prisma.subscription.count(),
  ]);
  res.json({ tenants, activeTenants, users, clients, cases, plans, subscriptions });
}));
router.post('/tenants', asyncHandler(async (req, res) => {
  const input = z.object({
    name: z.string().trim().min(2).max(120),
    legalName: z.string().max(180).optional().nullable(),
    document: z.string().max(30).optional().nullable(),
    email: z.string().email().transform(v => v.toLowerCase()),
    phone: z.string().max(40).optional().nullable(),
    ownerName: z.string().trim().min(2).max(120),
    ownerEmail: z.string().email().transform(v => v.toLowerCase()),
    planId: z.string().min(1),
  }).parse(req.body);
  const plan = await prisma.plan.findFirst({ where: { id: input.planId, isActive: true } });
  if (!plan) throw new AppError(404, 'Plano ativo não encontrado.');
  const rawToken = randomBytes(32).toString('hex');
  const tokenHash = createHash('sha256').update(rawToken).digest('hex');
  const trialEnd = new Date(Date.now() + 14 * 86400000);
  const tenant = await prisma.$transaction(async tx => {
    const created = await tx.tenant.create({ data: { name: input.name, legalName: input.legalName, document: input.document, email: input.email, phone: input.phone } });
    await tx.subscription.create({ data: { tenantId: created.id, planId: plan.id, status: 'TRIAL', trialEndsAt: trialEnd, currentPeriodEnd: trialEnd } });
    await tx.teamInvite.create({ data: { tenantId: created.id, email: input.ownerEmail, name: input.ownerName, role: 'OWNER', tokenHash, expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000) } });
    return created;
  });
  const url = `${process.env.APP_PUBLIC_URL || process.env.FRONTEND_URL || 'http://localhost:5173'}/accept-invite?token=${rawToken}`;
  let emailSent = false;
  try { emailSent = Boolean((await sendEmail({ to: input.ownerEmail, subject: 'Ative o acesso do seu escritório ao ImobGestor', text: `Olá ${input.ownerName}. Seu escritório foi cadastrado. Ative seu acesso: ${url}`, html: `<p>Olá ${escapeHtml(input.ownerName)}.</p><p>Seu escritório foi cadastrado no ImobGestor.</p><p><a href="${escapeHtml(url)}">Ativar acesso</a></p><p>O convite expira em 72 horas.</p>` })).sent); }
  catch (error) { console.error('[tenant-onboarding-email]', error.message); }
  res.status(201).json({ tenant, plan, emailSent, ...(process.env.NODE_ENV !== 'production' ? { developmentInviteUrl: url } : {}) });
}));

router.get('/tenants', asyncHandler(async (req, res) => {
  const q = String(req.query.q || '').trim();
  const items = await prisma.tenant.findMany({ where: q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { document: { contains: q } }] } : {}, orderBy: { createdAt: 'desc' }, take: 200, include: { _count: { select: { memberships: true, clients: true, cases: true } }, subscription: { include: { plan: true } } } });
  res.json({ items });
}));
router.patch('/tenants/:tenantId/status', asyncHandler(async (req, res) => {
  const tenantId = z.string().min(1).parse(req.params.tenantId);
  const { status } = z.object({ status: z.enum(['ACTIVE', 'SUSPENDED']) }).parse(req.body);
  const item = await prisma.tenant.update({ where: { id: tenantId }, data: { status } });
  res.json(item);
}));
router.get('/plans', asyncHandler(async (_req, res) => {
  const items = await prisma.plan.findMany({ orderBy: { monthlyPrice: 'asc' }, include: { _count: { select: { subscriptions: true } } } });
  res.json({ items });
}));
router.post('/plans', asyncHandler(async (req, res) => {
  const input = z.object({ name: z.string().min(2).max(100), slug: z.string().regex(/^[a-z0-9-]+$/), description: z.string().max(1000).optional().nullable(), monthlyPrice: z.union([z.string(), z.number()]), maxUsers: z.number().int().min(1).max(1000), maxCases: z.number().int().min(1).max(100000), features: z.array(z.string()).optional(), isActive: z.boolean().default(true) }).parse(req.body);
  const item = await prisma.plan.create({ data: { ...input, monthlyPrice: String(input.monthlyPrice), features: input.features || [] } });
  res.status(201).json(item);
}));
router.patch('/plans/:planId', asyncHandler(async (req, res) => {
  const planId = z.string().min(1).parse(req.params.planId);
  const input = z.object({ name: z.string().min(2).max(100).optional(), description: z.string().max(1000).nullable().optional(), monthlyPrice: z.union([z.string(), z.number()]).optional(), maxUsers: z.number().int().min(1).max(1000).optional(), maxCases: z.number().int().min(1).max(100000).optional(), features: z.array(z.string()).optional(), isActive: z.boolean().optional() }).parse(req.body);
  const item = await prisma.plan.update({ where: { id: planId }, data: { ...input, ...(input.monthlyPrice !== undefined ? { monthlyPrice: String(input.monthlyPrice) } : {}) } });
  res.json(item);
}));
router.put('/tenants/:tenantId/subscription', asyncHandler(async (req, res) => {
  const tenantId = z.string().min(1).parse(req.params.tenantId);
  const input = z.object({ planId: z.string().min(1), status: z.enum(['TRIAL', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'EXPIRED']), currentPeriodEnd: z.string().datetime().optional().nullable() }).parse(req.body);
  const plan = await prisma.plan.findUnique({ where: { id: input.planId } });
  if (!plan) throw new AppError(404, 'Plano não encontrado.');
  const item = await prisma.subscription.upsert({ where: { tenantId }, create: { tenantId, planId: input.planId, status: input.status, currentPeriodEnd: input.currentPeriodEnd ? new Date(input.currentPeriodEnd) : null }, update: { planId: input.planId, status: input.status, currentPeriodEnd: input.currentPeriodEnd ? new Date(input.currentPeriodEnd) : null } });
  res.json(item);
}));
export default router;
