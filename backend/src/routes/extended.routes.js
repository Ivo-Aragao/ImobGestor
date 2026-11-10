import { Router } from 'express';
import { z } from 'zod';
import { createHash, randomBytes } from 'node:crypto';
import { prisma } from '../lib/prisma.js';
import { AppError, asyncHandler } from '../lib/errors.js';
import { requireUser } from '../middlewares/auth.js';
import { writeAudit } from '../lib/audit.js';
import { sendEmail, escapeHtml } from '../lib/mailer.js';
import { runAutomationTrigger } from '../lib/automation-engine.js';

const router = Router();
router.use(requireUser);
const id = z.string().min(1).max(64);
const tenantId = req => req.auth.tenantId;
const adminRoles = ['OWNER', 'ADMIN'];
const financeRoles = ['OWNER', 'ADMIN', 'FINANCE'];
function permit(req, roles, capability) {
  if (adminRoles.includes(req.auth.role)) return true;
  if (roles.includes(req.auth.role)) return true;
  const permissions = req.auth.permissions && typeof req.auth.permissions === 'object' ? req.auth.permissions : {};
  return permissions[capability] === true;
}
function requirePermission(roles, capability) {
  return (req, _res, next) => permit(req, roles, capability) ? next() : next(new AppError(403, 'Você não tem permissão para esta operação.'));
}


// AUTOMATION RULES: bounded, auditable actions; no arbitrary code execution.
const automationInput = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().max(1000).optional().nullable(),
  trigger: z.enum(['TASK_CREATED', 'TASK_DUE_TOMORROW', 'DOCUMENT_RECEIVED', 'DOCUMENT_EXPIRING', 'CASE_STAGE_COMPLETED', 'CASE_STATUS_CHANGED']),
  action: z.enum(['IN_APP_NOTIFICATION', 'SEND_EMAIL', 'CREATE_TASK']),
  config: z.object({
    title: z.string().max(180).optional(), message: z.string().max(2000).optional(), subject: z.string().max(180).optional(),
    to: z.enum(['CLIENT', 'ASSIGNEE', 'OFFICE']).optional(), target: z.enum(['OFFICE', 'ASSIGNEE']).optional(),
    link: z.string().max(300).optional(), type: z.enum(['INFO', 'WARNING']).optional(),
    description: z.string().max(2000).optional(), dueInDays: z.number().int().min(0).max(365).optional(), assignedToId: id.optional(),
  }).optional(),
}).superRefine((value, ctx) => {
  if (value.action === 'SEND_EMAIL' && !value.config?.to) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['config', 'to'], message: 'Escolha o destinatário do e-mail.' });
  if (value.action === 'CREATE_TASK' && !value.config?.title) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['config', 'title'], message: 'Informe o título da tarefa automática.' });
});
router.get('/automations', requirePermission(adminRoles, 'automations.read'), asyncHandler(async (req, res) => {
  const [items, runs] = await Promise.all([
    prisma.automationRule.findMany({ where: { tenantId: tenantId(req) }, orderBy: { createdAt: 'desc' } }),
    prisma.automationRun.findMany({ where: { tenantId: tenantId(req) }, include: { rule: { select: { name: true } } }, orderBy: { startedAt: 'desc' }, take: 30 }),
  ]);
  res.json({ items, runs });
}));
router.post('/automations', requirePermission(adminRoles, 'automations.manage'), asyncHandler(async (req, res) => {
  const input = automationInput.parse(req.body);
  if (input.config?.assignedToId && !(await prisma.membership.findFirst({ where: { tenantId: tenantId(req), userId: input.config.assignedToId, isActive: true } }))) throw new AppError(400, 'Responsável não pertence ao escritório ou está inativo.');
  const item = await prisma.automationRule.create({ data: { ...input, config: input.config || {}, tenantId: tenantId(req) } });
  await writeAudit(req, 'AUTOMATION_CREATED', 'AutomationRule', item.id, { trigger: item.trigger, action: item.action });
  res.status(201).json(item);
}));
router.patch('/automations/:ruleId', requirePermission(adminRoles, 'automations.manage'), asyncHandler(async (req, res) => {
  const ruleId = id.parse(req.params.ruleId);
  const input = z.object({ name: z.string().trim().min(2).max(120).optional(), description: z.string().max(1000).nullable().optional(), config: automationInput.shape.config, isActive: z.boolean().optional() }).parse(req.body);
  const exists = await prisma.automationRule.findFirst({ where: { id: ruleId, tenantId: tenantId(req) } });
  if (!exists) throw new AppError(404, 'Automação não encontrada.');
  if (input.config?.assignedToId && !(await prisma.membership.findFirst({ where: { tenantId: tenantId(req), userId: input.config.assignedToId, isActive: true } }))) throw new AppError(400, 'Responsável não pertence ao escritório ou está inativo.');
  const item = await prisma.automationRule.update({ where: { id: ruleId }, data: input });
  await writeAudit(req, 'AUTOMATION_UPDATED', 'AutomationRule', ruleId);
  res.json(item);
}));
router.delete('/automations/:ruleId', requirePermission(adminRoles, 'automations.manage'), asyncHandler(async (req, res) => {
  const ruleId = id.parse(req.params.ruleId);
  const result = await prisma.automationRule.updateMany({ where: { id: ruleId, tenantId: tenantId(req) }, data: { isActive: false } });
  if (!result.count) throw new AppError(404, 'Automação não encontrada.');
  await writeAudit(req, 'AUTOMATION_DISABLED', 'AutomationRule', ruleId);
  res.status(204).end();
}));

// Minimal member directory for assignment controls; sensitive account data is omitted.
router.get('/team/options', asyncHandler(async (req, res) => {
  const items = await prisma.membership.findMany({ where: { tenantId: tenantId(req), isActive: true, user: { status: 'ACTIVE' } }, select: { userId: true, role: true, user: { select: { name: true } } }, orderBy: { user: { name: 'asc' } } });
  res.json({ items: items.map(item => ({ id: item.userId, name: item.user.name, role: item.role })) });
}));

// TEAM: membership and invitation lifecycle
router.get('/team', requirePermission(adminRoles, 'team.read'), asyncHandler(async (req, res) => {
  const items = await prisma.membership.findMany({
    where: { tenantId: tenantId(req) }, orderBy: { createdAt: 'asc' },
    include: { user: { select: { id: true, name: true, email: true, status: true, createdAt: true } } },
  });
  const invites = await prisma.teamInvite.findMany({ where: { tenantId: tenantId(req), acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' }, select: { id: true, email: true, name: true, role: true, expiresAt: true, createdAt: true } });
  res.json({ items, invites });
}));

router.post('/team/invites', requirePermission(adminRoles, 'team.manage'), asyncHandler(async (req, res) => {
  const input = z.object({ email: z.string().email().transform(v => v.toLowerCase()), name: z.string().trim().min(2).max(120).optional(), role: z.enum(['ADMIN', 'LAWYER', 'ASSISTANT', 'FINANCE']).default('ASSISTANT'), permissions: z.record(z.boolean()).optional() }).parse(req.body);
  const existing = await prisma.user.findUnique({ where: { email: input.email }, include: { memberships: { where: { tenantId: tenantId(req) } } } });
  if (existing?.memberships.length) throw new AppError(409, 'Este usuário já pertence ao escritório.');
  const subscription = await prisma.subscription.findUnique({ where: { tenantId: tenantId(req) }, include: { plan: true } });
  if (subscription?.status === 'EXPIRED' || subscription?.status === 'CANCELED') throw new AppError(402, 'A licença do escritório não está ativa.');
  if (subscription?.plan?.maxUsers) {
    const members = await prisma.membership.count({ where: { tenantId: tenantId(req), isActive: true } });
    const pendingInvites = await prisma.teamInvite.count({ where: { tenantId: tenantId(req), acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } } });
    if (members + pendingInvites >= subscription.plan.maxUsers) throw new AppError(402, 'O limite de usuários do plano foi atingido.');
  }
  const pending = await prisma.teamInvite.findFirst({ where: { tenantId: tenantId(req), email: input.email, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } } });
  if (pending) throw new AppError(409, 'Já existe um convite ativo para este e-mail.');
  const rawToken = randomBytes(32).toString('hex');
  const tokenHash = createHash('sha256').update(rawToken).digest('hex');
  const invite = await prisma.teamInvite.create({ data: { tenantId: tenantId(req), email: input.email, name: input.name, role: input.role, permissions: input.permissions, tokenHash, expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000) } });
  const url = `${process.env.APP_PUBLIC_URL || process.env.FRONTEND_URL || 'http://localhost:5173'}/accept-invite?token=${rawToken}`;
  let emailResult = { sent: false, reason: 'MAIL_NOT_CONFIGURED' };
  try { emailResult = await sendEmail({ to: input.email, subject: 'Convite para o ImobGestor', text: `Você foi convidado para acessar um escritório no ImobGestor. Acesse: ${url}`, html: `<p>Você foi convidado para acessar um escritório no ImobGestor.</p><p><a href="${escapeHtml(url)}">Aceitar convite</a></p><p>O convite expira em 72 horas.</p>` }); }
  catch (error) { console.error('[invite-email]', error.message); }
  await writeAudit(req, 'TEAM_INVITE_CREATED', 'TeamInvite', invite.id, { email: input.email, role: input.role });
  res.status(201).json({ invite: { id: invite.id, email: invite.email, role: invite.role, expiresAt: invite.expiresAt }, emailSent: Boolean(emailResult.sent), ...(process.env.NODE_ENV !== 'production' ? { developmentInviteUrl: url } : {}) });
}));

router.delete('/team/invites/:inviteId', requirePermission(adminRoles, 'team.manage'), asyncHandler(async (req, res) => {
  const inviteId = id.parse(req.params.inviteId);
  const invite = await prisma.teamInvite.findFirst({ where: { id: inviteId, tenantId: tenantId(req), acceptedAt: null } });
  if (!invite) throw new AppError(404, 'Convite não encontrado.');
  await prisma.teamInvite.update({ where: { id: inviteId }, data: { revokedAt: new Date() } });
  await writeAudit(req, 'TEAM_INVITE_REVOKED', 'TeamInvite', inviteId);
  res.status(204).end();
}));

router.patch('/team/:membershipId', requirePermission(adminRoles, 'team.manage'), asyncHandler(async (req, res) => {
  const membershipId = id.parse(req.params.membershipId);
  const input = z.object({ role: z.enum(['ADMIN', 'LAWYER', 'ASSISTANT', 'FINANCE']).optional(), permissions: z.record(z.boolean()).nullable().optional(), isActive: z.boolean().optional() }).parse(req.body);
  const membership = await prisma.membership.findFirst({ where: { id: membershipId, tenantId: tenantId(req) }, include: { user: true } });
  if (!membership) throw new AppError(404, 'Vínculo de usuário não encontrado.');
  if (membership.role === 'OWNER' && (input.role !== undefined || input.permissions !== undefined || input.isActive === false)) {
    throw new AppError(400, 'O vínculo do proprietário principal não pode ser alterado por esta tela. Use um procedimento formal de transferência de titularidade.');
  }
  const updated = await prisma.membership.update({ where: { id: membershipId }, data: { role: input.role, permissions: input.permissions, isActive: input.isActive } });
  await writeAudit(req, 'TEAM_MEMBER_UPDATED', 'Membership', membershipId, { role: input.role, isActive: input.isActive });
  res.json(updated);
}));

router.delete('/team/:membershipId', requirePermission(adminRoles, 'team.manage'), asyncHandler(async (req, res) => {
  const membershipId = id.parse(req.params.membershipId);
  const item = await prisma.membership.findFirst({ where: { id: membershipId, tenantId: tenantId(req) } });
  if (!item) throw new AppError(404, 'Vínculo não encontrado.');
  if (item.userId === req.auth.userId) throw new AppError(400, 'Você não pode remover seu próprio acesso.');
  if (item.role === 'OWNER') throw new AppError(400, 'O proprietário não pode ser removido. Transfira a titularidade por um procedimento administrativo próprio.');
  await prisma.membership.delete({ where: { id: membershipId } });
  await writeAudit(req, 'TEAM_MEMBER_REMOVED', 'Membership', membershipId);
  res.status(204).end();
}));

// CLIENT PORTAL REQUESTS / OFFICE INBOX
router.get('/portal-requests', requirePermission(['OWNER', 'ADMIN', 'LAWYER'], 'portal.requests.read'), asyncHandler(async (req, res) => {
  const items = await prisma.portalRequest.findMany({ where: { tenantId: tenantId(req) }, orderBy: { updatedAt: 'desc' }, take: 100, include: { client: { select: { id: true, name: true, email: true } }, case: { select: { id: true, title: true } }, messages: { orderBy: { createdAt: 'asc' }, take: 100 } } });
  res.json({ items });
}));
router.patch('/portal-requests/:requestId', requirePermission(['OWNER', 'ADMIN', 'LAWYER'], 'portal.requests.manage'), asyncHandler(async (req, res) => {
  const requestId = id.parse(req.params.requestId);
  const input = z.object({ status: z.enum(['OPEN', 'IN_PROGRESS', 'ANSWERED', 'CLOSED']) }).parse(req.body);
  const existing = await prisma.portalRequest.findFirst({ where: { id: requestId, tenantId: tenantId(req) } });
  if (!existing) throw new AppError(404, 'Solicitação não encontrada.');
  const item = await prisma.portalRequest.update({ where: { id: requestId }, data: { status: input.status } });
  await writeAudit(req, 'PORTAL_REQUEST_STATUS_UPDATED', 'PortalRequest', requestId, { status: input.status });
  res.json(item);
}));
router.post('/portal-requests/:requestId/messages', requirePermission(['OWNER', 'ADMIN', 'LAWYER'], 'portal.requests.manage'), asyncHandler(async (req, res) => {
  const requestId = id.parse(req.params.requestId);
  const input = z.object({ message: z.string().trim().min(1).max(5000) }).parse(req.body);
  const existing = await prisma.portalRequest.findFirst({ where: { id: requestId, tenantId: tenantId(req) }, include: { client: true } });
  if (!existing) throw new AppError(404, 'Solicitação não encontrada.');
  if (existing.status === 'CLOSED') throw new AppError(400, 'Reabra a solicitação antes de responder.');
  const item = await prisma.portalRequestMessage.create({ data: { requestId, senderType: 'STAFF', senderId: req.auth.userId, message: input.message } });
  await prisma.portalRequest.update({ where: { id: requestId }, data: { status: 'ANSWERED', updatedAt: new Date() } });
  if (existing.client.email) await sendEmail({ to: existing.client.email, subject: `Nova resposta do escritório — ${existing.subject}`, text: `O escritório respondeu à sua solicitação: ${input.message}`, html: `<p>O escritório respondeu à sua solicitação <strong>${escapeHtml(existing.subject)}</strong>:</p><p>${escapeHtml(input.message).replaceAll('\n', '<br/>')}</p><p>Acesse o portal do cliente para continuar a conversa.</p>` }).catch(error => console.error('[portal-request-email]', error.message));
  await writeAudit(req, 'PORTAL_REQUEST_REPLIED', 'PortalRequest', requestId);
  res.status(201).json(item);
}));

// CALENDAR
const eventInput = z.object({ title: z.string().trim().min(2).max(180), description: z.string().max(3000).optional().nullable(), type: z.enum(['MEETING', 'DEADLINE', 'VISIT', 'HEARING', 'RETURN', 'OTHER']).default('OTHER'), startAt: z.string().datetime(), endAt: z.string().datetime().optional().nullable(), allDay: z.boolean().default(false), location: z.string().max(300).optional().nullable(), caseId: id.optional().nullable(), clientId: id.optional().nullable(), assignedToId: id.optional().nullable() });
router.get('/calendar/events', asyncHandler(async (req, res) => {
  const from = req.query.from ? new Date(String(req.query.from)) : new Date(Date.now() - 30 * 86400000);
  const to = req.query.to ? new Date(String(req.query.to)) : new Date(Date.now() + 90 * 86400000);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) throw new AppError(400, 'Período inválido.');
  const items = await prisma.calendarEvent.findMany({ where: { tenantId: tenantId(req), startAt: { gte: from, lte: to } }, orderBy: { startAt: 'asc' }, include: { assignedTo: { select: { id: true, name: true } }, client: { select: { id: true, name: true } }, case: { select: { id: true, title: true } } } });
  res.json({ items });
}));
router.post('/calendar/events', asyncHandler(async (req, res) => {
  const input = eventInput.parse(req.body);
  if (input.endAt && new Date(input.endAt) < new Date(input.startAt)) throw new AppError(400, 'O término não pode ser anterior ao início.');
  if (input.caseId) { const item = await prisma.case.findFirst({ where: { id: input.caseId, tenantId: tenantId(req) } }); if (!item) throw new AppError(404, 'Procedimento não encontrado.'); }
  if (input.clientId && !(await prisma.client.findFirst({ where: { id: input.clientId, tenantId: tenantId(req) } }))) throw new AppError(404, 'Cliente não encontrado.');
  if (input.assignedToId) { const m = await prisma.membership.findFirst({ where: { tenantId: tenantId(req), userId: input.assignedToId, isActive: true } }); if (!m) throw new AppError(400, 'Responsável não pertence ao escritório.'); }
  const item = await prisma.calendarEvent.create({ data: { ...input, startAt: new Date(input.startAt), endAt: input.endAt ? new Date(input.endAt) : null, tenantId: tenantId(req), createdById: req.auth.userId } });
  if (item.assignedToId) await prisma.notification.create({ data: { tenantId: tenantId(req), userId: item.assignedToId, title: 'Novo compromisso atribuído', message: item.title, link: '/calendar', type: 'INFO' } });
  await writeAudit(req, 'CALENDAR_EVENT_CREATED', 'CalendarEvent', item.id);
  res.status(201).json(item);
}));
router.patch('/calendar/events/:eventId', asyncHandler(async (req, res) => {
  const eventId = id.parse(req.params.eventId);
  const input = eventInput.partial().extend({ status: z.enum(['SCHEDULED', 'DONE', 'CANCELED']).optional() }).parse(req.body);
  const exists = await prisma.calendarEvent.findFirst({ where: { id: eventId, tenantId: tenantId(req) } });
  if (!exists) throw new AppError(404, 'Compromisso não encontrado.');
  if (input.caseId && !(await prisma.case.findFirst({ where: { id: input.caseId, tenantId: tenantId(req) } }))) throw new AppError(404, 'Procedimento não encontrado.');
  if (input.clientId && !(await prisma.client.findFirst({ where: { id: input.clientId, tenantId: tenantId(req) } }))) throw new AppError(404, 'Cliente não encontrado.');
  if (input.assignedToId && !(await prisma.membership.findFirst({ where: { tenantId: tenantId(req), userId: input.assignedToId, isActive: true } }))) throw new AppError(400, 'Responsável não pertence ao escritório.');
  const data = { ...input };
  if (input.startAt) data.startAt = new Date(input.startAt);
  if (input.endAt !== undefined) data.endAt = input.endAt ? new Date(input.endAt) : null;
  if (input.startAt !== undefined || input.endAt !== undefined) data.reminderSentAt = null;
  const item = await prisma.calendarEvent.update({ where: { id: eventId }, data });
  await writeAudit(req, 'CALENDAR_EVENT_UPDATED', 'CalendarEvent', eventId);
  res.json(item);
}));
router.delete('/calendar/events/:eventId', asyncHandler(async (req, res) => {
  const eventId = id.parse(req.params.eventId);
  const result = await prisma.calendarEvent.deleteMany({ where: { id: eventId, tenantId: tenantId(req) } });
  if (!result.count) throw new AppError(404, 'Compromisso não encontrado.');
  await writeAudit(req, 'CALENDAR_EVENT_DELETED', 'CalendarEvent', eventId);
  res.status(204).end();
}));

// IN-APP NOTIFICATIONS
router.get('/notifications', asyncHandler(async (req, res) => {
  const items = await prisma.notification.findMany({ where: { tenantId: tenantId(req), OR: [{ userId: req.auth.userId }, { userId: null }] }, orderBy: { createdAt: 'desc' }, take: 100 });
  res.json({ items, unread: items.filter(x => !x.readAt).length });
}));
router.patch('/notifications/:notificationId/read', asyncHandler(async (req, res) => {
  const notificationId = id.parse(req.params.notificationId);
  const item = await prisma.notification.findFirst({ where: { id: notificationId, tenantId: tenantId(req), OR: [{ userId: req.auth.userId }, { userId: null }] } });
  if (!item) throw new AppError(404, 'Notificação não encontrada.');
  const updated = await prisma.notification.update({ where: { id: item.id }, data: { readAt: new Date() } });
  res.json(updated);
}));
router.post('/notifications/read-all', asyncHandler(async (req, res) => {
  const result = await prisma.notification.updateMany({ where: { tenantId: tenantId(req), readAt: null, OR: [{ userId: req.auth.userId }, { userId: null }] }, data: { readAt: new Date() } });
  res.json({ updated: result.count });
}));

// DOCUMENT TEMPLATES
const docTemplateInput = z.object({ name: z.string().trim().min(2).max(160), category: z.string().max(100).optional().nullable(), description: z.string().max(2000).optional().nullable(), body: z.string().min(1).max(50000), variables: z.array(z.string().max(80)).max(100).optional() });
router.get('/document-templates', asyncHandler(async (req, res) => {
  const items = await prisma.documentTemplate.findMany({ where: { tenantId: tenantId(req), isActive: true }, orderBy: { name: 'asc' } });
  res.json({ items });
}));
router.post('/document-templates', asyncHandler(async (req, res) => {
  const input = docTemplateInput.parse(req.body);
  const item = await prisma.documentTemplate.create({ data: { ...input, variables: input.variables || [], tenantId: tenantId(req), createdById: req.auth.userId } });
  await writeAudit(req, 'DOCUMENT_TEMPLATE_CREATED', 'DocumentTemplate', item.id);
  res.status(201).json(item);
}));
router.patch('/document-templates/:templateId', asyncHandler(async (req, res) => {
  const templateId = id.parse(req.params.templateId);
  const input = docTemplateInput.partial().parse(req.body);
  const exists = await prisma.documentTemplate.findFirst({ where: { id: templateId, tenantId: tenantId(req) } });
  if (!exists) throw new AppError(404, 'Modelo de documento não encontrado.');
  const item = await prisma.documentTemplate.update({ where: { id: templateId }, data: { ...input, ...(input.variables ? { variables: input.variables } : {}) } });
  await writeAudit(req, 'DOCUMENT_TEMPLATE_UPDATED', 'DocumentTemplate', templateId);
  res.json(item);
}));
router.delete('/document-templates/:templateId', asyncHandler(async (req, res) => {
  const templateId = id.parse(req.params.templateId);
  const result = await prisma.documentTemplate.updateMany({ where: { id: templateId, tenantId: tenantId(req) }, data: { isActive: false } });
  if (!result.count) throw new AppError(404, 'Modelo de documento não encontrado.');
  await writeAudit(req, 'DOCUMENT_TEMPLATE_ARCHIVED', 'DocumentTemplate', templateId);
  res.status(204).end();
}));
router.post('/document-templates/:templateId/preview', asyncHandler(async (req, res) => {
  const templateId = id.parse(req.params.templateId);
  const input = z.object({ values: z.record(z.union([z.string(), z.number(), z.boolean()])).default({}) }).parse(req.body);
  const template = await prisma.documentTemplate.findFirst({ where: { id: templateId, tenantId: tenantId(req), isActive: true } });
  if (!template) throw new AppError(404, 'Modelo não encontrado.');
  let body = template.body;
  for (const [key, value] of Object.entries(input.values)) body = body.replaceAll(`{{${key}}}`, String(value));
  res.json({ name: template.name, preview: body, unresolved: [...body.matchAll(/{{\s*([\w.]+)\s*}}/g)].map(m => m[1]) });
}));

// REPORTS
router.get('/reports/overview', requirePermission(financeRoles, 'reports.read'), asyncHandler(async (req, res) => {
  const t = tenantId(req);
  const showFinance = adminRoles.includes(req.auth.role) || financeRoles.includes(req.auth.role) || req.auth.permissions?.['finance.read'] === true;
  const since = new Date(); since.setMonth(since.getMonth() - 11, 1); since.setHours(0, 0, 0, 0);
  const [caseGroups, byTemplate, financeRows, overdueTasks, clients, properties, docsPending, caseTotal] = await Promise.all([
    prisma.case.groupBy({ by: ['status'], where: { tenantId: t }, _count: { _all: true } }),
    prisma.case.groupBy({ by: ['templateId'], where: { tenantId: t }, _count: { _all: true } }),
    showFinance ? prisma.financialEntry.findMany({ where: { tenantId: t, createdAt: { gte: since } }, select: { type: true, status: true, amount: true, paidAt: true, createdAt: true } }) : Promise.resolve([]),
    prisma.task.count({ where: { tenantId: t, status: { in: ['TODO', 'IN_PROGRESS'] }, dueAt: { lt: new Date() } } }),
    prisma.client.count({ where: { tenantId: t, isActive: true } }),
    prisma.property.count({ where: { tenantId: t, isActive: true } }),
    prisma.documentRequest.count({ where: { tenantId: t, status: { in: ['REQUESTED', 'REJECTED'] } } }),
    prisma.case.count({ where: { tenantId: t } }),
  ]);
  const templateIds = byTemplate.map(x => x.templateId);
  const templates = await prisma.serviceTemplate.findMany({ where: { id: { in: templateIds }, tenantId: t }, select: { id: true, name: true } });
  const monthly = Array.from({ length: 12 }, (_, i) => { const d = new Date(since); d.setMonth(since.getMonth() + i); return { month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, receivables: 0, expenses: 0, received: 0 }; });
  for (const row of financeRows) {
    const dt = row.paidAt || row.createdAt; const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
    const bucket = monthly.find(x => x.month === key); if (!bucket) continue;
    const amount = Number(row.amount);
    if (row.type === 'RECEIVABLE') { bucket.receivables += amount; if (row.status === 'PAID') bucket.received += amount; } else bucket.expenses += amount;
  }
  res.json({ financeAvailable: showFinance, totals: { clients, properties, cases: caseTotal, overdueTasks, pendingDocuments: docsPending }, casesByStatus: caseGroups.map(x => ({ status: x.status, count: x._count._all })), casesByService: byTemplate.map(x => ({ name: templates.find(tpl => tpl.id === x.templateId)?.name || 'Serviço removido', count: x._count._all })), monthly });
}));


// OFFICE SETTINGS
router.get('/settings/tenant', asyncHandler(async (req, res) => {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId(req) }, select: { id: true, name: true, legalName: true, document: true, email: true, phone: true, status: true, createdAt: true } });
  res.json(tenant);
}));
router.patch('/settings/tenant', requirePermission(adminRoles, 'settings.manage'), asyncHandler(async (req, res) => {
  const input = z.object({ name: z.string().trim().min(2).max(120), legalName: z.string().max(180).nullable().optional(), document: z.string().max(30).nullable().optional(), email: z.string().email().nullable().optional().or(z.literal('')), phone: z.string().max(40).nullable().optional() }).parse(req.body);
  const item = await prisma.tenant.update({ where: { id: tenantId(req) }, data: { ...input, email: input.email === '' ? null : input.email } });
  await writeAudit(req, 'TENANT_SETTINGS_UPDATED', 'Tenant', tenantId(req));
  res.json(item);
}));

// TENANT AUDIT TRAIL
router.get('/audit', requirePermission(adminRoles, 'audit.read'), asyncHandler(async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 30));
  const where = { tenantId: tenantId(req), ...(req.query.entityType ? { entityType: String(req.query.entityType).slice(0, 80) } : {}), ...(req.query.action ? { action: { contains: String(req.query.action).slice(0, 80), mode: 'insensitive' } } : {}) };
  const [items, total] = await Promise.all([
    prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize, include: { user: { select: { id: true, name: true, email: true } } } }),
    prisma.auditLog.count({ where }),
  ]);
  res.json({ items, total, page, pageSize });
}));

router.get('/integrations/status', asyncHandler(async (_req, res) => {
  res.json({ email: Boolean(process.env.RESEND_API_KEY), storage: Boolean(process.env.S3_BUCKET && process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY), electronicSignature: Boolean(process.env.SIGNATURE_PROVIDER_URL && process.env.SIGNATURE_PROVIDER_TOKEN), publicData: { pncp: false, incra: false, registry: false }, paymentGateway: Boolean(process.env.PAYMENT_PROVIDER_URL && process.env.PAYMENT_PROVIDER_TOKEN) });
}));

export default router;
