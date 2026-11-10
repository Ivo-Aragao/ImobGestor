
import { Router } from 'express';
import { z } from 'zod';
import { randomBytes, createHash, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import multer from 'multer';

import { prisma } from '../lib/prisma.js';
import { AppError, asyncHandler } from '../lib/errors.js';
import { writeAudit } from '../lib/audit.js';

import {
  uploadPrivateBlob,
  getPrivateBlob,
  deletePrivateBlob,
  storageIsConfigured,
} from '../lib/storage.js';

import { requireUser } from '../middlewares/auth.js';
import { requirePortalAccount } from '../middlewares/portal-auth.js';
import { hashPassword, verifyPassword, validatePassword } from '../lib/password.js';
import { signSession } from '../lib/tokens.js';
import { sendEmail, escapeHtml } from '../lib/mailer.js';
import { runAutomationTrigger } from '../lib/automation-engine.js';



const DOCUMENT_MAX_BYTES =
  (Number(process.env.MAX_FILE_SIZE_MB) || 25) * 1024 * 1024;

const documentUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: DOCUMENT_MAX_BYTES,
    files: 1,
  },
});

function receiveDocumentFile(req, res, next) {
  documentUpload.single('file')(req, res, (error) => {
    if (!error) return next();

    if (
      error instanceof multer.MulterError &&
      error.code === 'LIMIT_FILE_SIZE'
    ) {
      return next(
        new AppError(
          400,
          `O arquivo excede o limite de ${Math.round(DOCUMENT_MAX_BYTES / 1024 / 1024)} MB.`
        )
      );
    }

    next(error);
  });
}

function requireBlobStorage() {
  if (!storageIsConfigured()) {
    throw new AppError(
      503,
      'O armazenamento privado de documentos não está configurado.'
    );
  }
}

function detectDocumentFormat(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 8) {
    return null;
  }

  if (buffer.subarray(0, 5).toString('ascii') === '%PDF-') {
    return {
      mimeType: 'application/pdf',
      extension: 'pdf',
    };
  }

  if (
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return {
      mimeType: 'image/jpeg',
      extension: 'jpg',
    };
  }

  const pngSignature = Buffer.from([
    0x89, 0x50, 0x4e, 0x47,
    0x0d, 0x0a, 0x1a, 0x0a,
  ]);

  if (buffer.subarray(0, 8).equals(pngSignature)) {
    return {
      mimeType: 'image/png',
      extension: 'png',
    };
  }

  return null;
}

function cleanOriginalName(name) {
  return String(name || 'documento')
    .replace(/[\\/\u0000-\u001f\u007f]/g, '_')
    .slice(0, 200);
}

async function persistDocumentUpload({
  tenantId,
  caseRecord,
  requestId,
  file,
  title,
  expiresAt,
  uploaderType,
  uploaderId,
}) {
  if (!file?.buffer?.length) {
    throw new AppError(400, 'Selecione um arquivo para enviar.');
  }

  if (file.size > DOCUMENT_MAX_BYTES) {
    throw new AppError(400, 'O arquivo excede o tamanho permitido.');
  }

  const format = detectDocumentFormat(file.buffer);

  if (!format) {
    throw new AppError(
      400,
      'Arquivo inválido. São aceitos somente PDF, JPG e PNG.'
    );
  }

  const originalName = cleanOriginalName(file.originalname);

  const document = await prisma.document.create({
    data: {
      tenantId,
      caseId: caseRecord.id,
      clientId: caseRecord.clientId,
      requestId: requestId || null,
      title: title || originalName,
      visibility: 'INTERNAL',
      expiresAt: expiresAt || null,
      uploadedById: uploaderType === 'USER' ? uploaderId : null,
    },
  });

  let blob = null;

  try {
    const pathname =
      `${tenantId}/cases/${caseRecord.id}/documents/` +
      `${document.id}/versions/${randomUUID()}.${format.extension}`;

    blob = await uploadPrivateBlob({
      pathname,
      body: file.buffer,
      contentType: format.mimeType,
    });

    const version = await prisma.documentVersion.create({
      data: {
        tenantId,
        documentId: document.id,
        storageKey: blob.pathname,
        originalName,
        mimeType: format.mimeType,
        sizeBytes: file.size,
        checksum: createHash('sha256')
          .update(file.buffer)
          .digest('hex'),
        uploaderType,
        uploaderId,
      },
    });

    return { document, version };
  } catch (error) {
    if (blob?.pathname) {
      await deletePrivateBlob(blob.pathname).catch((cleanupError) => {
        console.error(
          '[document-blob-cleanup]',
          cleanupError.message
        );
      });
    }

    await prisma.document.delete({
      where: { id: document.id },
    }).catch((cleanupError) => {
      console.error(
        '[document-record-cleanup]',
        cleanupError.message
      );
    });

    throw error;
  }
}

async function streamPrivateDocument(res, version) {
  const blob = await getPrivateBlob(version.storageKey);

  if (!blob?.stream) {
    throw new AppError(404, 'Arquivo não encontrado no armazenamento.');
  }

  res.setHeader('Content-Type', version.mimeType);
  res.setHeader('Content-Length', String(version.sizeBytes));
  res.setHeader(
    'Content-Disposition',
    `attachment; filename*=UTF-8''${encodeURIComponent(version.originalName)}`
  );
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  await pipeline(Readable.fromWeb(blob.stream), res);
}

const router = Router();
const portalRouter = Router();
router.use(requireUser);

const idParam = z.string().min(1).max(64);
const clientInput = z.object({
  type: z.enum(['PERSON', 'LEGAL_ENTITY']).default('PERSON'),
  name: z.string().trim().min(2).max(180),
  document: z.string().trim().max(30).optional().nullable(),
  email: z.string().email().optional().nullable().or(z.literal('')),
  phone: z.string().max(40).optional().nullable(),
  postalCode: z.string().max(15).optional().nullable(),
  street: z.string().max(180).optional().nullable(),
  number: z.string().max(30).optional().nullable(),
  complement: z.string().max(100).optional().nullable(),
  district: z.string().max(100).optional().nullable(),
  city: z.string().max(100).optional().nullable(),
  state: z.string().length(2).optional().nullable(),
  notes: z.string().max(4000).optional().nullable(),
});
const propertyInput = z.object({
  type: z.enum(['URBAN', 'RURAL']),
  title: z.string().trim().min(2).max(180),
  description: z.string().max(4000).optional().nullable(),
  postalCode: z.string().max(15).optional().nullable(),
  street: z.string().max(180).optional().nullable(),
  number: z.string().max(30).optional().nullable(),
  complement: z.string().max(100).optional().nullable(),
  district: z.string().max(100).optional().nullable(),
  city: z.string().trim().min(2).max(100),
  state: z.string().length(2),
  areaValue: z.union([z.string(), z.number()]).optional().nullable(),
  areaUnit: z.string().max(10).optional().nullable(),
  registrationNumber: z.string().max(100).optional().nullable(),
  registryOffice: z.string().max(180).optional().nullable(),
  municipalRegistration: z.string().max(100).optional().nullable(),
  ruralRegistration: z.string().max(100).optional().nullable(),
  ruralDetails: z.object({ carCode: z.string().max(120).optional().nullable(), incraCode: z.string().max(120).optional().nullable(), ccirNumber: z.string().max(120).optional().nullable(), itrYear: z.string().max(4).optional().nullable(), itrReceipt: z.string().max(120).optional().nullable(), georeferencingStatus: z.string().max(80).optional().nullable(), technicalResponsible: z.string().max(180).optional().nullable(), nirf: z.string().max(120).optional().nullable() }).optional().nullable(),
  notes: z.string().max(4000).optional().nullable(),
});
const templateInput = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().max(3000).optional().nullable(),
  category: z.string().max(80).optional().nullable(),
  stages: z.array(z.object({
    name: z.string().trim().min(2).max(120),
    description: z.string().max(1000).optional().nullable(),
    visibleToClient: z.boolean().default(true),
  })).max(50).default([]),
  documentRequirements: z.array(z.object({
    name: z.string().trim().min(2).max(160),
    instructions: z.string().max(1500).optional().nullable(),
    required: z.boolean().default(true),
    allowClientUpload: z.boolean().default(true),
    acceptedMimeTypes: z.array(z.string().max(100)).max(20).default(['application/pdf', 'image/jpeg', 'image/png']),
  })).max(100).default([]),
});

function tenantId(req) { return req.auth.tenantId; }
const adminRoles = ['OWNER', 'ADMIN'];
const financeRoles = ['OWNER', 'ADMIN', 'FINANCE'];
function requirePermission(roles, capability) {
  return (req, _res, next) => {
    const permissions = req.auth?.permissions && typeof req.auth.permissions === 'object' ? req.auth.permissions : {};
    if (adminRoles.includes(req.auth?.role) || roles.includes(req.auth?.role) || permissions[capability] === true) return next();
    return next(new AppError(403, 'Você não tem permissão para esta operação.'));
  };
}
function canReadFinance(req) { return adminRoles.includes(req.auth.role) || financeRoles.includes(req.auth.role) || req.auth.permissions?.['finance.read'] === true; }
function cleanOptional(value) { return value === '' ? null : value; }



// Dashboard
router.get('/dashboard', asyncHandler(async (req, res) => {
  const t = tenantId(req);
  const showFinance = canReadFinance(req);
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const [clients, properties, activeCases, completedCases, openTasks, overdueTasks, pendingDocs, recentCases, receivables, monthReceived, monthExpenses, activities] = await Promise.all([
    prisma.client.count({ where: { tenantId: t, isActive: true } }),
    prisma.property.count({ where: { tenantId: t, isActive: true } }),
    prisma.case.count({ where: { tenantId: t, status: { notIn: ['COMPLETED', 'CANCELED'] } } }),
    prisma.case.count({ where: { tenantId: t, status: 'COMPLETED' } }),
    prisma.task.count({ where: { tenantId: t, status: { in: ['TODO', 'IN_PROGRESS'] } } }),
    prisma.task.count({ where: { tenantId: t, status: { in: ['TODO', 'IN_PROGRESS'] }, dueAt: { lt: new Date() } } }),
    prisma.documentRequest.count({ where: { tenantId: t, status: { in: ['REQUESTED', 'REJECTED'] } } }),
    prisma.case.findMany({ where: { tenantId: t }, take: 6, orderBy: { updatedAt: 'desc' }, include: { client: { select: { name: true } }, property: { select: { title: true } } } }),
    showFinance ? prisma.financialEntry.aggregate({ where: { tenantId: t, type: 'RECEIVABLE', status: { in: ['OPEN', 'OVERDUE'] } }, _sum: { amount: true } }) : Promise.resolve({ _sum: { amount: null } }),
    showFinance ? prisma.financialEntry.aggregate({ where: { tenantId: t, type: 'RECEIVABLE', status: 'PAID', paidAt: { gte: monthStart } }, _sum: { amount: true } }) : Promise.resolve({ _sum: { amount: null } }),
    showFinance ? prisma.financialEntry.aggregate({ where: { tenantId: t, type: 'EXPENSE', status: 'PAID', paidAt: { gte: monthStart } }, _sum: { amount: true } }) : Promise.resolve({ _sum: { amount: null } }),
    prisma.auditLog.findMany({ where: { tenantId: t }, take: 8, orderBy: { createdAt: 'desc' }, select: { id: true, action: true, entityType: true, createdAt: true, user: { select: { name: true } } } }),
  ]);
  res.json({ stats: { clients, properties, activeCases, completedCases, openTasks, overdueTasks, pendingDocs, ...(showFinance ? { receivables: receivables._sum.amount ?? 0, monthReceived: monthReceived._sum.amount ?? 0, monthExpenses: monthExpenses._sum.amount ?? 0 } : {}) }, recentCases, activities });
}));

// Clients
router.get('/clients', asyncHandler(async (req, res) => {
  const q = String(req.query.q || '').trim();
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(50, Math.max(1, Number(req.query.pageSize) || 20));
  const where = { tenantId: tenantId(req), isActive: true, ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { document: { contains: q } }, { email: { contains: q, mode: 'insensitive' } }] } : {}) };
  const [items, total] = await Promise.all([
    prisma.client.findMany({ where, orderBy: { name: 'asc' }, skip: (page - 1) * pageSize, take: pageSize, include: { _count: { select: { properties: true, cases: true } } } }),
    prisma.client.count({ where }),
  ]);
  res.json({ items, total, page, pageSize });
}));

router.post('/clients', asyncHandler(async (req, res) => {
  const input = clientInput.parse(req.body);
  const item = await prisma.client.create({ data: { ...input, email: cleanOptional(input.email), document: cleanOptional(input.document), tenantId: tenantId(req) } });
  await writeAudit(req, 'CLIENT_CREATED', 'Client', item.id);
  res.status(201).json(item);
}));

router.get('/clients/:id', asyncHandler(async (req, res) => {
  const id = idParam.parse(req.params.id);
  const item = await prisma.client.findFirst({
    where: { id, tenantId: tenantId(req) },
    include: {
      properties: { include: { property: true } },
      cases: { orderBy: { updatedAt: 'desc' }, include: { property: { select: { title: true } }, template: { select: { name: true } } } },
      portalAccounts: { select: { id: true, email: true, status: true, lastLoginAt: true } },
    },
  });
  if (!item) throw new AppError(404, 'Cliente não encontrado.');
  res.json(item);
}));

router.patch('/clients/:id', asyncHandler(async (req, res) => {
  const id = idParam.parse(req.params.id);
  const input = clientInput.partial().parse(req.body);
  const exists = await prisma.client.findFirst({ where: { id, tenantId: tenantId(req) } });
  if (!exists) throw new AppError(404, 'Cliente não encontrado.');
  const item = await prisma.client.update({ where: { id }, data: { ...input, email: cleanOptional(input.email), document: cleanOptional(input.document) } });
  await writeAudit(req, 'CLIENT_UPDATED', 'Client', id);
  res.json(item);
}));

router.delete('/clients/:id', requirePermission(adminRoles, 'clients.archive'), asyncHandler(async (req, res) => {
  const id = idParam.parse(req.params.id);
  const exists = await prisma.client.findFirst({ where: { id, tenantId: tenantId(req) } });
  if (!exists) throw new AppError(404, 'Cliente não encontrado.');
  await prisma.client.update({ where: { id }, data: { isActive: false } });
  await writeAudit(req, 'CLIENT_ARCHIVED', 'Client', id);
  res.status(204).end();
}));

// Properties
router.get('/properties', asyncHandler(async (req, res) => {
  const q = String(req.query.q || '').trim();
  const items = await prisma.property.findMany({
    where: { tenantId: tenantId(req), isActive: true, ...(q ? { OR: [{ title: { contains: q, mode: 'insensitive' } }, { city: { contains: q, mode: 'insensitive' } }] } : {}) },
    orderBy: { updatedAt: 'desc' }, take: 100,
    include: { parties: { include: { client: { select: { id: true, name: true } } } }, _count: { select: { cases: true } } },
  });
  res.json({ items });
}));

router.post('/properties', asyncHandler(async (req, res) => {
  const input = propertyInput.parse(req.body);
  const item = await prisma.property.create({ data: { ...input, tenantId: tenantId(req), state: input.state.toUpperCase(), areaValue: input.areaValue == null ? null : String(input.areaValue) } });
  await writeAudit(req, 'PROPERTY_CREATED', 'Property', item.id);
  res.status(201).json(item);
}));

router.get('/properties/:id', asyncHandler(async (req, res) => {
  const item = await prisma.property.findFirst({ where: { id: idParam.parse(req.params.id), tenantId: tenantId(req) }, include: { parties: { include: { client: true } }, cases: { include: { client: true, template: true } } } });
  if (!item) throw new AppError(404, 'Imóvel não encontrado.');
  res.json(item);
}));

router.patch('/properties/:id', asyncHandler(async (req, res) => {
  const id = idParam.parse(req.params.id);
  const input = propertyInput.partial().parse(req.body);
  const exists = await prisma.property.findFirst({ where: { id, tenantId: tenantId(req) } });
  if (!exists) throw new AppError(404, 'Imóvel não encontrado.');
  const data = { ...input };
  if (input.state) data.state = input.state.toUpperCase();
  if (input.areaValue !== undefined) data.areaValue = input.areaValue == null ? null : String(input.areaValue);
  const item = await prisma.property.update({ where: { id }, data });
  await writeAudit(req, 'PROPERTY_UPDATED', 'Property', id);
  res.json(item);
}));

router.post('/properties/:id/parties', asyncHandler(async (req, res) => {
  const propertyId = idParam.parse(req.params.id);
  const input = z.object({ clientId: idParam, role: z.string().trim().min(2).max(80), notes: z.string().max(1000).optional().nullable() }).parse(req.body);
  const [property, client] = await Promise.all([
    prisma.property.findFirst({ where: { id: propertyId, tenantId: tenantId(req) } }),
    prisma.client.findFirst({ where: { id: input.clientId, tenantId: tenantId(req), isActive: true } }),
  ]);
  if (!property || !client) throw new AppError(404, 'Imóvel ou cliente não encontrado neste escritório.');
  const party = await prisma.propertyParty.create({ data: { tenantId: tenantId(req), propertyId, ...input } });
  res.status(201).json(party);
}));

// Service templates: every edit creates a new immutable version.
router.get('/service-templates', asyncHandler(async (req, res) => {
  const items = await prisma.serviceTemplate.findMany({
    where: { tenantId: tenantId(req), isActive: true }, orderBy: { name: 'asc' },
    include: { versions: { orderBy: { version: 'desc' }, take: 1, include: { stages: { orderBy: { order: 'asc' } }, requirements: true } } },
  });
  res.json({ items });
}));

router.post('/service-templates', requirePermission(['OWNER', 'ADMIN', 'LAWYER'], 'services.manage'), asyncHandler(async (req, res) => {
  const input = templateInput.parse(req.body);
  const created = await prisma.$transaction(async tx => {
    const template = await tx.serviceTemplate.create({ data: { tenantId: tenantId(req), name: input.name, description: input.description, category: input.category } });
    const version = await tx.serviceTemplateVersion.create({
      data: {
        tenantId: tenantId(req), templateId: template.id, version: 1, createdById: req.auth.userId,
        stages: { create: input.stages.map((s, i) => ({ tenantId: tenantId(req), name: s.name, description: s.description, order: i + 1, visibleToClient: s.visibleToClient })) },
        requirements: { create: input.documentRequirements.map(d => ({ tenantId: tenantId(req), ...d })) },
      }, include: { stages: { orderBy: { order: 'asc' } }, requirements: true },
    });
    return { ...template, versions: [version] };
  });
  await writeAudit(req, 'SERVICE_TEMPLATE_CREATED', 'ServiceTemplate', created.id);
  res.status(201).json(created);
}));

router.put('/service-templates/:id', requirePermission(['OWNER', 'ADMIN', 'LAWYER'], 'services.manage'), asyncHandler(async (req, res) => {
  const id = idParam.parse(req.params.id);
  const input = templateInput.parse(req.body);
  const updated = await prisma.$transaction(async tx => {
    const template = await tx.serviceTemplate.findFirst({ where: { id, tenantId: tenantId(req), isActive: true } });
    if (!template) throw new AppError(404, 'Modelo de serviço não encontrado.');
    const nextVersion = template.currentVersion + 1;
    await tx.serviceTemplate.update({ where: { id }, data: { name: input.name, description: input.description, category: input.category, currentVersion: nextVersion } });
    const version = await tx.serviceTemplateVersion.create({
      data: {
        tenantId: tenantId(req), templateId: id, version: nextVersion, createdById: req.auth.userId,
        changeNote: 'Nova versão criada pelo escritório',
        stages: { create: input.stages.map((s, i) => ({ tenantId: tenantId(req), name: s.name, description: s.description, order: i + 1, visibleToClient: s.visibleToClient })) },
        requirements: { create: input.documentRequirements.map(d => ({ tenantId: tenantId(req), ...d })) },
      }, include: { stages: { orderBy: { order: 'asc' } }, requirements: true },
    });
    return { ...template, name: input.name, description: input.description, category: input.category, currentVersion: nextVersion, versions: [version] };
  });
  await writeAudit(req, 'SERVICE_TEMPLATE_VERSION_CREATED', 'ServiceTemplate', id, { version: updated.currentVersion });
  res.json(updated);
}));

router.delete('/service-templates/:id', requirePermission(['OWNER', 'ADMIN', 'LAWYER'], 'services.manage'), asyncHandler(async (req, res) => {
  const id = idParam.parse(req.params.id);
  const exists = await prisma.serviceTemplate.findFirst({ where: { id, tenantId: tenantId(req) } });
  if (!exists) throw new AppError(404, 'Modelo não encontrado.');
  await prisma.serviceTemplate.update({ where: { id }, data: { isActive: false } });
  await writeAudit(req, 'SERVICE_TEMPLATE_ARCHIVED', 'ServiceTemplate', id);
  res.status(204).end();
}));

// Cases: snapshot the selected template version into stages and document requests.
router.get('/cases', asyncHandler(async (req, res) => {
  const status = req.query.status;
  const where = { tenantId: tenantId(req), ...(status ? { status: String(status) } : {}) };
  const items = await prisma.case.findMany({
    where, orderBy: { updatedAt: 'desc' }, take: 100,
    include: { client: { select: { id: true, name: true } }, property: { select: { id: true, title: true, city: true, state: true } }, template: { select: { id: true, name: true } }, stages: { orderBy: { order: 'asc' } }, documentRequests: { select: { id: true, name: true, instructions: true, required: true, allowClientUpload: true, status: true } }, _count: { select: { documentRequests: true, tasks: true } } },
  });
  res.json({ items });
}));

router.post('/cases', requirePermission(['OWNER', 'ADMIN', 'LAWYER'], 'cases.manage'), asyncHandler(async (req, res) => {
  const input = z.object({
    clientId: idParam, propertyId: idParam, templateId: idParam,
    title: z.string().trim().min(2).max(180), description: z.string().max(3000).optional().nullable(),
    priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).default('NORMAL'),
    dueAt: z.coerce.date().optional().nullable(), assignedToId: idParam.optional().nullable(),
  }).parse(req.body);
  const created = await prisma.$transaction(async tx => {
    const [client, property, template] = await Promise.all([
      tx.client.findFirst({ where: { id: input.clientId, tenantId: tenantId(req), isActive: true } }),
      tx.property.findFirst({ where: { id: input.propertyId, tenantId: tenantId(req), isActive: true } }),
      tx.serviceTemplate.findFirst({ where: { id: input.templateId, tenantId: tenantId(req), isActive: true } }),
    ]);
    if (!client || !property || !template) throw new AppError(404, 'Cliente, imóvel ou modelo não encontrado neste escritório.');
    const version = await tx.serviceTemplateVersion.findFirst({
      where: { tenantId: tenantId(req), templateId: template.id, version: template.currentVersion },
      include: { stages: { orderBy: { order: 'asc' } }, requirements: true },
    });
    if (!version) throw new AppError(400, 'O modelo de serviço não possui uma versão configurada.');
    const subscription = await tx.subscription.findUnique({ where: { tenantId: tenantId(req) }, include: { plan: true } });
    if (subscription && ['EXPIRED', 'CANCELED'].includes(subscription.status)) throw new AppError(402, 'A licença do escritório não está ativa.');
    if (subscription?.plan?.maxCases) {
      const currentCases = await tx.case.count({ where: { tenantId: tenantId(req), status: { not: 'CANCELED' } } });
      if (currentCases >= subscription.plan.maxCases) throw new AppError(402, 'O limite de procedimentos do plano foi atingido.');
    }
    if (input.assignedToId) {
      const member = await tx.membership.findFirst({ where: { tenantId: tenantId(req), userId: input.assignedToId, isActive: true } });
      if (!member) throw new AppError(400, 'Responsável não pertence ao escritório ou está inativo.');
    }
    const createdCase = await tx.case.create({
      data: {
        tenantId: tenantId(req), clientId: input.clientId, propertyId: input.propertyId,
        templateId: input.templateId, templateVersionId: version.id, title: input.title,
        description: input.description, priority: input.priority, dueAt: input.dueAt,
        assignedToId: input.assignedToId || null, createdById: req.auth.userId,
        stages: { create: version.stages.map(s => ({ tenantId: tenantId(req), name: s.name, description: s.description, order: s.order, visibleToClient: s.visibleToClient })) },
        documentRequests: { create: version.requirements.map(d => ({ tenantId: tenantId(req), name: d.name, instructions: d.instructions, required: d.required, allowClientUpload: d.allowClientUpload })) },
      }, include: { stages: { orderBy: { order: 'asc' } }, documentRequests: true, client: true, property: true, template: true },
    });
    await tx.propertyParty.upsert({
      where: { propertyId_clientId_role: { propertyId: input.propertyId, clientId: input.clientId, role: 'CLIENTE DO PROCEDIMENTO' } },
      create: { tenantId: tenantId(req), propertyId: input.propertyId, clientId: input.clientId, role: 'CLIENTE DO PROCEDIMENTO' },
      update: {},
    });
    return createdCase;
  }, { isolationLevel: 'Serializable' });
  await writeAudit(req, 'CASE_CREATED', 'Case', created.id, { templateId: input.templateId });
  await runAutomationTrigger(tenantId(req), 'CASE_STATUS_CHANGED', { caseId: created.id, caseTitle: created.title, clientName: created.client.name, clientEmail: created.client.email, title: created.title, message: 'Um novo procedimento foi criado.' });
  res.status(201).json(created);
}));

router.get('/cases/:id', asyncHandler(async (req, res) => {
  const id = idParam.parse(req.params.id);
  const item = await prisma.case.findFirst({
    where: { id, tenantId: tenantId(req) },
    include: {
      client: true, property: true, template: true,
      stages: { orderBy: { order: 'asc' } },
      documentRequests: { include: { documents: { include: { versions: { orderBy: { createdAt: 'desc' }, take: 1, select: { id: true, originalName: true, mimeType: true, sizeBytes: true, createdAt: true } } } } } },
      documents: { include: { versions: { orderBy: { createdAt: 'desc' }, select: { id: true, originalName: true, mimeType: true, sizeBytes: true, createdAt: true } } } },
      tasks: { orderBy: { dueAt: 'asc' } }, financialItems: canReadFinance(req),
    },
  });
  if (!item) throw new AppError(404, 'Procedimento não encontrado.');
  res.json(item);
}));

router.patch('/cases/:id', requirePermission(['OWNER', 'ADMIN', 'LAWYER'], 'cases.manage'), asyncHandler(async (req, res) => {
  const id = idParam.parse(req.params.id);
  const input = z.object({
    title: z.string().trim().min(2).max(180).optional(),
    description: z.string().max(3000).nullable().optional(),
    status: z.enum(['NEW', 'IN_PROGRESS', 'WAITING_CLIENT', 'WAITING_EXTERNAL', 'WAITING_INTERNAL', 'SUSPENDED', 'COMPLETED', 'CANCELED']).optional(),
    priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).optional(),
    dueAt: z.coerce.date().nullable().optional(),
    assignedToId: idParam.nullable().optional(),
  }).parse(req.body);
  const exists = await prisma.case.findFirst({ where: { id, tenantId: tenantId(req) }, include: { client: true, assignedTo: true } });
  if (!exists) throw new AppError(404, 'Procedimento não encontrado.');
  if (input.assignedToId) {
    const member = await prisma.membership.findFirst({ where: { tenantId: tenantId(req), userId: input.assignedToId, isActive: true } });
    if (!member) throw new AppError(400, 'Responsável não pertence ao escritório ou está inativo.');
  }
  const data = { ...input };
  if (input.status === 'COMPLETED') data.closedAt = new Date();
  if (input.status && input.status !== 'COMPLETED') data.closedAt = null;
  const item = await prisma.case.update({ where: { id }, data });
  await writeAudit(req, 'CASE_UPDATED', 'Case', id, { changedFields: Object.keys(input) });
  if (input.status && input.status !== exists.status) {
    const office = await prisma.tenant.findUnique({ where: { id: tenantId(req) }, select: { email: true } });
    await runAutomationTrigger(tenantId(req), 'CASE_STATUS_CHANGED', { caseId: id, caseTitle: item.title, clientName: exists.client.name, clientEmail: exists.client.email, assignedToId: exists.assignedToId, assignedToEmail: exists.assignedTo?.email, tenantEmail: office?.email, title: item.title, message: `Situação atualizada para ${input.status}.` });
  }
  res.json(item);
}));

router.patch('/cases/:caseId/stages/:stageId', requirePermission(['OWNER', 'ADMIN', 'LAWYER'], 'cases.manage'), asyncHandler(async (req, res) => {
  const caseId = idParam.parse(req.params.caseId);
  const stageId = idParam.parse(req.params.stageId);
  const input = z.object({ status: z.enum(['PENDING', 'IN_PROGRESS', 'COMPLETED', 'BLOCKED']), notesInternal: z.string().max(2000).nullable().optional(), notesPublic: z.string().max(2000).nullable().optional() }).parse(req.body);
  const stage = await prisma.caseStage.findFirst({ where: { id: stageId, caseId, tenantId: tenantId(req) }, include: { case: { include: { client: true, assignedTo: true } } } });
  if (!stage) throw new AppError(404, 'Etapa não encontrada.');
  const item = await prisma.caseStage.update({ where: { id: stageId }, data: { ...input, startedAt: input.status === 'IN_PROGRESS' && !stage.startedAt ? new Date() : stage.startedAt, completedAt: input.status === 'COMPLETED' ? new Date() : null } });
  await writeAudit(req, 'CASE_STAGE_UPDATED', 'CaseStage', stageId, { status: input.status });
  if (input.status === 'COMPLETED') { const office = await prisma.tenant.findUnique({ where: { id: tenantId(req) }, select: { email: true } }); await runAutomationTrigger(tenantId(req), 'CASE_STAGE_COMPLETED', { caseId, caseTitle: stage.case.title, clientName: stage.case.client.name, clientEmail: stage.case.client.email, assignedToId: stage.case.assignedToId, assignedToEmail: stage.case.assignedTo?.email, tenantEmail: office?.email, title: stage.name, message: `Etapa concluída: ${stage.name}` }); }
  res.json(item);
}));

// Tasks
router.get('/tasks', asyncHandler(async (req, res) => {
  const items = await prisma.task.findMany({ where: { tenantId: tenantId(req) }, orderBy: [{ dueAt: 'asc' }, { createdAt: 'desc' }], take: 200, include: { case: { select: { id: true, title: true } }, assignedTo: { select: { id: true, name: true } } } });
  res.json({ items });
}));

router.post('/tasks', asyncHandler(async (req, res) => {
  const input = z.object({ title: z.string().trim().min(2).max(180), description: z.string().max(2000).optional().nullable(), caseId: idParam.optional().nullable(), status: z.enum(['TODO', 'IN_PROGRESS', 'DONE', 'CANCELED']).default('TODO'), priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).default('NORMAL'), dueAt: z.coerce.date().optional().nullable(), assignedToId: idParam.optional().nullable() }).parse(req.body);
  if (input.caseId && !(await prisma.case.findFirst({ where: { id: input.caseId, tenantId: tenantId(req) } }))) throw new AppError(404, 'Procedimento não encontrado.');
  if (input.assignedToId && !(await prisma.membership.findFirst({ where: { tenantId: tenantId(req), userId: input.assignedToId, isActive: true } }))) throw new AppError(400, 'Responsável não pertence ao escritório ou está inativo.');
  const item = await prisma.task.create({ data: { ...input, tenantId: tenantId(req), createdById: req.auth.userId } });
  await writeAudit(req, 'TASK_CREATED', 'Task', item.id);
  const [assigned, office] = await Promise.all([
    input.assignedToId ? prisma.user.findUnique({ where: { id: input.assignedToId }, select: { email: true } }) : null,
    prisma.tenant.findUnique({ where: { id: tenantId(req) }, select: { email: true } }),
  ]);
  await runAutomationTrigger(tenantId(req), 'TASK_CREATED', { caseId: input.caseId, title: item.title, message: item.description || item.title, assignedToId: input.assignedToId, assignedToEmail: assigned?.email, tenantEmail: office?.email });
  res.status(201).json(item);
}));

router.patch('/tasks/:id', asyncHandler(async (req, res) => {
  const id = idParam.parse(req.params.id);
  const input = z.object({ title: z.string().trim().min(2).max(180).optional(), description: z.string().max(2000).nullable().optional(), caseId: idParam.nullable().optional(), status: z.enum(['TODO', 'IN_PROGRESS', 'DONE', 'CANCELED']).optional(), priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).optional(), dueAt: z.coerce.date().nullable().optional(), assignedToId: idParam.nullable().optional() }).parse(req.body);
  const exists = await prisma.task.findFirst({ where: { id, tenantId: tenantId(req) } });
  if (!exists) throw new AppError(404, 'Tarefa não encontrada.');
  if (input.caseId && !(await prisma.case.findFirst({ where: { id: input.caseId, tenantId: tenantId(req) } }))) throw new AppError(404, 'Procedimento não encontrado.');
  if (input.assignedToId && !(await prisma.membership.findFirst({ where: { tenantId: tenantId(req), userId: input.assignedToId, isActive: true } }))) throw new AppError(400, 'Responsável não pertence ao escritório ou está inativo.');
  const item = await prisma.task.update({ where: { id }, data: { ...input, ...(input.dueAt !== undefined ? { reminderSentAt: null } : {}) } });
  await writeAudit(req, 'TASK_UPDATED', 'Task', id);
  res.json(item);
}));

// Finance: simple internal entries; amounts are received as decimal strings.
router.get('/finance/entries', requirePermission(financeRoles, 'finance.read'), asyncHandler(async (req, res) => {
  const items = await prisma.financialEntry.findMany({ where: { tenantId: tenantId(req) }, orderBy: { dueAt: 'desc' }, take: 200, include: { client: { select: { id: true, name: true } }, case: { select: { id: true, title: true } } } });
  res.json({ items });
}));
router.post('/finance/entries', requirePermission(financeRoles, 'finance.manage'), asyncHandler(async (req, res) => {
  const input = z.object({
    type: z.enum(['RECEIVABLE', 'EXPENSE']),
    description: z.string().trim().min(2).max(180),
    amount: z.string().regex(/^\d{1,12}(\.\d{1,2})?$/),
    category: z.string().max(100).optional().nullable(), notes: z.string().max(2000).optional().nullable(),
    paymentMethod: z.string().max(80).optional().nullable(),
    installmentCount: z.number().int().min(1).max(60).default(1),
    installmentNumber: z.number().int().min(1).optional().nullable(), installmentsTotal: z.number().int().min(1).optional().nullable(),
    clientId: idParam.nullable().optional(), caseId: idParam.nullable().optional(), dueAt: z.coerce.date().nullable().optional(),
    status: z.enum(['OPEN', 'PAID', 'OVERDUE', 'CANCELED']).default('OPEN'), paidAt: z.coerce.date().nullable().optional(),
  }).parse(req.body);
  if (input.clientId && !(await prisma.client.findFirst({ where: { id: input.clientId, tenantId: tenantId(req) } }))) throw new AppError(404, 'Cliente não encontrado.');
  if (input.caseId && !(await prisma.case.findFirst({ where: { id: input.caseId, tenantId: tenantId(req) } }))) throw new AppError(404, 'Procedimento não encontrado.');

  const count = input.installmentCount || 1;
  const [whole, fraction = ''] = input.amount.split('.');
  const totalCents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  const baseCents = totalCents / BigInt(count);
  const remainder = totalCents % BigInt(count);
  const rows = Array.from({ length: count }, (_, index) => {
    const cents = baseCents + (BigInt(index) < remainder ? 1n : 0n);
    const dueAt = input.dueAt ? new Date(input.dueAt) : null;
    if (dueAt && index > 0) {
      const day = dueAt.getUTCDate();
      dueAt.setUTCDate(1);
      dueAt.setUTCMonth(dueAt.getUTCMonth() + index);
      const lastDay = new Date(Date.UTC(dueAt.getUTCFullYear(), dueAt.getUTCMonth() + 1, 0)).getUTCDate();
      dueAt.setUTCDate(Math.min(day, lastDay));
    }
    const amount = `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
    return {
      tenantId: tenantId(req), type: input.type,
      description: count > 1 ? `${input.description} (${index + 1}/${count})` : input.description,
      amount, category: input.category, notes: input.notes, paymentMethod: input.paymentMethod,
      installmentNumber: count > 1 ? index + 1 : (input.installmentNumber ?? null),
      installmentsTotal: count > 1 ? count : (input.installmentsTotal ?? null),
      clientId: input.clientId || null, caseId: input.caseId || null, dueAt,
      status: input.status, paidAt: input.status === 'PAID' ? (input.paidAt || new Date()) : null,
    };
  });
  const created = await prisma.$transaction(async tx => {
    const items = [];
    for (const row of rows) items.push(await tx.financialEntry.create({ data: row }));
    return items;
  });
  await writeAudit(req, 'FINANCIAL_ENTRY_CREATED', 'FinancialEntry', created[0].id, { count: created.length, installmentCount: count });
  res.status(201).json({ items: created, installmentCount: count });
}));
router.patch('/finance/entries/:id', requirePermission(financeRoles, 'finance.manage'), asyncHandler(async (req, res) => {
  const id = idParam.parse(req.params.id);
  const input = z.object({ description: z.string().trim().min(2).max(180).optional(), amount: z.string().regex(/^\d{1,12}(\.\d{1,2})?$/).optional(), category: z.string().max(100).nullable().optional(), notes: z.string().max(2000).nullable().optional(), paymentMethod: z.string().max(80).nullable().optional(), dueAt: z.coerce.date().nullable().optional(), status: z.enum(['OPEN', 'PAID', 'OVERDUE', 'CANCELED']).optional(), paidAt: z.coerce.date().nullable().optional() }).parse(req.body);
  const exists = await prisma.financialEntry.findFirst({ where: { id, tenantId: tenantId(req) } });
  if (!exists) throw new AppError(404, 'Lançamento financeiro não encontrado.');
  const data = { ...input };
  if (input.status === 'PAID' && input.paidAt === undefined) data.paidAt = new Date();
  if (input.status && input.status !== 'PAID') data.paidAt = null;
  const item = await prisma.financialEntry.update({ where: { id }, data });
  await writeAudit(req, 'FINANCIAL_ENTRY_UPDATED', 'FinancialEntry', id, { status: input.status });
  res.json(item);
}));

// Internal document library.
router.get('/documents', asyncHandler(async (req, res) => {
  const items = await prisma.document.findMany({
    where: { tenantId: tenantId(req) },
    orderBy: { updatedAt: 'desc' },
    take: 200,
    include: {
      case: { select: { id: true, title: true } },
      client: { select: { id: true, name: true } },
      request: { select: { id: true, name: true, status: true } },
      versions: { orderBy: { createdAt: 'desc' }, take: 1, select: { id: true, originalName: true, mimeType: true, sizeBytes: true, createdAt: true } },
    },
  });
  res.json({ items });
}));

router.patch('/documents/:id/visibility', asyncHandler(async (req, res) => {
  const id = idParam.parse(req.params.id);
  if (!['OWNER', 'ADMIN', 'LAWYER', 'ADVOGADO'].includes(req.auth.role)) {
    throw new AppError(403, 'Somente usuários autorizados podem publicar documentos no portal.');
  }
  const input = z.object({ visibility: z.enum(['INTERNAL', 'CLIENT']) }).parse(req.body);
  const exists = await prisma.document.findFirst({ where: { id, tenantId: tenantId(req) } });
  if (!exists) throw new AppError(404, 'Documento não encontrado.');
  const item = await prisma.document.update({ where: { id }, data: { visibility: input.visibility } });
  await writeAudit(req, input.visibility === 'CLIENT' ? 'DOCUMENT_PUBLISHED_TO_CLIENT' : 'DOCUMENT_HIDDEN_FROM_CLIENT', 'Document', id);
  res.json(item);
}));


// Private document storage — office uploads.
router.post(
  '/documents/upload',
  receiveDocumentFile,
  asyncHandler(async (req, res) => {
    requireBlobStorage();

    const input = z.object({
      caseId: idParam,

      requestId: z.preprocess(
        (value) => value === '' ? null : value,
        idParam.nullable().optional()
      ),

      title: z.string().trim().max(180).optional(),

      expiresAt: z.preprocess(
        (value) => value === '' ? null : value,
        z.coerce.date().nullable().optional()
      ),
    }).parse(req.body);

    const caseRecord = await prisma.case.findFirst({
      where: {
        id: input.caseId,
        tenantId: tenantId(req),
      },
      include: {
        client: true,
      },
    });

    if (!caseRecord) {
      throw new AppError(404, 'Procedimento não encontrado.');
    }

    if (input.requestId) {
      const request = await prisma.documentRequest.findFirst({
        where: {
          id: input.requestId,
          caseId: input.caseId,
          tenantId: tenantId(req),
        },
      });

      if (!request) {
        throw new AppError(
          404,
          'Solicitação documental não encontrada.'
        );
      }
    }

    const { document, version } = await persistDocumentUpload({
      tenantId: tenantId(req),
      caseRecord,
      requestId: input.requestId,
      file: req.file,
      title: input.title,
      expiresAt: input.expiresAt,
      uploaderType: 'USER',
      uploaderId: req.auth.userId,
    });

    if (input.requestId) {
      await prisma.documentRequest.update({
        where: {
          id: input.requestId,
        },
        data: {
          status: 'RECEIVED',
        },
      });
    }

    await writeAudit(
      req,
      'DOCUMENT_UPLOADED',
      'Document',
      document.id,
      {
        versionId: version.id,
        fileName: version.originalName,
      }
    );

    const office = await prisma.tenant.findUnique({
      where: {
        id: tenantId(req),
      },
      select: {
        email: true,
      },
    });

    await runAutomationTrigger(
      tenantId(req),
      'DOCUMENT_RECEIVED',
      {
        caseId: input.caseId,
        caseTitle: caseRecord.title,
        clientName: caseRecord.client.name,
        clientEmail: caseRecord.client.email,
        tenantEmail: office?.email,
        documentName: version.originalName,
        title: document.title,
        message: `Novo documento recebido: ${version.originalName}`,
      }
    );

    res.status(201).json({
      document,
      version: {
        id: version.id,
        originalName: version.originalName,
        mimeType: version.mimeType,
        sizeBytes: version.sizeBytes,
        createdAt: version.createdAt,
      },
    });
  })
);

// Protected download — office.
router.get(
  '/documents/:id/download',
  asyncHandler(async (req, res) => {
    requireBlobStorage();

    const item = await prisma.document.findFirst({
      where: {
        id: idParam.parse(req.params.id),
        tenantId: tenantId(req),
      },
      include: {
        versions: {
          orderBy: {
            createdAt: 'desc',
          },
          take: 1,
        },
      },
    });

    const version = item?.versions[0];

    if (!item || !version) {
      throw new AppError(404, 'Documento não encontrado.');
    }

    await streamPrivateDocument(res, version);
  })
);


router.get('/documents/:id/download', asyncHandler(async (req, res) => {
  requireS3();
  const item = await prisma.document.findFirst({ where: { id: idParam.parse(req.params.id), tenantId: tenantId(req) }, include: { versions: { orderBy: { createdAt: 'desc' }, take: 1 } } });
  const version = item?.versions[0];
  if (!item || !version) throw new AppError(404, 'Documento não encontrado.');
  const url = await createDownloadUrl(version.storageKey);
  res.json({ url, expiresInSeconds: 120 });
}));

router.patch('/document-requests/:id', asyncHandler(async (req, res) => {
  const id = idParam.parse(req.params.id);
  const input = z.object({ status: z.enum(['REQUESTED', 'RECEIVED', 'IN_REVIEW', 'ACCEPTED', 'REJECTED']) }).parse(req.body);
  const exists = await prisma.documentRequest.findFirst({ where: { id, tenantId: tenantId(req) } });
  if (!exists) throw new AppError(404, 'Solicitação não encontrada.');
  const item = await prisma.documentRequest.update({ where: { id }, data: { status: input.status } });
  await writeAudit(req, 'DOCUMENT_REQUEST_UPDATED', 'DocumentRequest', id, { status: input.status });
  res.json(item);
}));

// Portal activation: return activation URL for the office to send until email provider is configured.
router.post('/clients/:id/portal-invites', asyncHandler(async (req, res) => {
  const clientId = idParam.parse(req.params.id);
  const input = z.object({ email: z.string().email().transform(v => v.toLowerCase()) }).parse(req.body);
  const client = await prisma.client.findFirst({ where: { id: clientId, tenantId: tenantId(req), isActive: true } });
  if (!client) throw new AppError(404, 'Cliente não encontrado.');
  const rawToken = randomBytes(32).toString('hex');
  const tokenHash = createHash('sha256').update(rawToken).digest('hex');
  await prisma.portalInvite.create({ data: { tenantId: tenantId(req), clientId, email: input.email, tokenHash, expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000) } });
  await writeAudit(req, 'PORTAL_INVITE_CREATED', 'Client', clientId);
  const base = process.env.APP_PUBLIC_URL || process.env.FRONTEND_URL || 'http://localhost:5173';
  const activationUrl = `${base}/portal/activate?token=${rawToken}`;
  let emailSent = false;
  try {
    const sent = await sendEmail({ to: input.email, subject: `Acesse o portal de ${req.auth.tenantId ? 'atendimento' : 'serviços'} — ImobGestor`, text: `Olá ${client.name}. O escritório convidou você para acompanhar seus serviços. Ative seu acesso: ${activationUrl}. O convite expira em 48 horas.`, html: `<p>Olá ${escapeHtml(client.name)}.</p><p>O escritório convidou você para acompanhar seus serviços pelo portal ImobGestor.</p><p><a href="${escapeHtml(activationUrl)}">Ativar meu acesso</a></p><p>O convite expira em 48 horas.</p>` });
    emailSent = Boolean(sent.sent);
  } catch (error) { console.error('[portal-invite-email]', error.message); }
  res.status(201).json({ emailSent, expiresInHours: 48, ...(process.env.NODE_ENV !== 'production' ? { developmentActivationUrl: activationUrl } : {}), message: emailSent ? 'Convite enviado por e-mail.' : 'Convite criado. Configure o provedor de e-mail para enviá-lo automaticamente.' });
}));

// Portal authentication and read-only customer experience.
portalRouter.post('/auth/activate', asyncHandler(async (req, res) => {
  const input = z.object({ token: z.string().min(32), name: z.string().trim().min(2).max(120), password: z.string() }).parse(req.body);
  const passwordError = validatePassword(input.password);
  if (passwordError) throw new AppError(400, passwordError);
  const tokenHash = createHash('sha256').update(input.token).digest('hex');
  const invite = await prisma.portalInvite.findFirst({ where: { tokenHash, acceptedAt: null, expiresAt: { gt: new Date() } }, include: { client: true } });
  if (!invite) throw new AppError(400, 'Convite inválido ou expirado. Solicite um novo convite ao escritório.');
  const passwordHash = await hashPassword(input.password);
  const account = await prisma.$transaction(async tx => {
    const created = await tx.portalAccount.upsert({
      where: { tenantId_clientId: { tenantId: invite.tenantId, clientId: invite.clientId } },
      create: { tenantId: invite.tenantId, clientId: invite.clientId, email: invite.email, passwordHash },
      update: { email: invite.email, passwordHash, status: 'ACTIVE' },
    });
    await tx.portalInvite.update({ where: { id: invite.id }, data: { acceptedAt: new Date() } });
    return created;
  });
  const token = signSession({ type: 'portal', sub: account.id, tenantId: account.tenantId });
  res.cookie('imob_portal_session', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 8 * 60 * 60 * 1000 });
  res.status(201).json({ message: 'Portal ativado com sucesso.' });
}));

portalRouter.post('/auth/login', asyncHandler(async (req, res) => {
  const input = z.object({ email: z.string().email().transform(v => v.toLowerCase()), password: z.string().min(1) }).parse(req.body);
  const accounts = await prisma.portalAccount.findMany({ where: { email: input.email, status: 'ACTIVE', tenant: { status: 'ACTIVE' } }, include: { client: true } });
  const account = await (async () => {
    for (const candidate of accounts) if (await verifyPassword(input.password, candidate.passwordHash)) return candidate;
    return null;
  })();
  if (!account) throw new AppError(401, 'E-mail ou senha inválidos.');
  await prisma.portalAccount.update({ where: { id: account.id }, data: { lastLoginAt: new Date() } });
  const token = signSession({ type: 'portal', sub: account.id, tenantId: account.tenantId });
  res.cookie('imob_portal_session', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 8 * 60 * 60 * 1000 });
  res.json({ client: { name: account.client.name } });
}));
portalRouter.post('/auth/logout', (req, res) => { res.clearCookie('imob_portal_session', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/' }); res.status(204).end(); });
portalRouter.get('/me', requirePortalAccount, asyncHandler(async (req, res) => {
  const account = await prisma.portalAccount.findUnique({ where: { id: req.portal.id }, include: { client: { select: { id: true, name: true, email: true } }, tenant: { select: { name: true } } } });
  res.json({ client: account.client, office: account.tenant.name });
}));
portalRouter.get('/requests', requirePortalAccount, asyncHandler(async (req, res) => {
  const items = await prisma.portalRequest.findMany({
    where: { tenantId: req.portal.tenantId, clientId: req.portal.clientId },
    orderBy: { updatedAt: 'desc' }, take: 50,
    include: { case: { select: { id: true, title: true } }, messages: { orderBy: { createdAt: 'asc' }, take: 100 } },
  });
  res.json({ items });
}));
portalRouter.post('/requests', requirePortalAccount, asyncHandler(async (req, res) => {
  const input = z.object({ subject: z.string().trim().min(3).max(160), message: z.string().trim().min(5).max(5000), caseId: idParam.optional().nullable() }).parse(req.body);
  if (input.caseId && !(await prisma.case.findFirst({ where: { id: input.caseId, tenantId: req.portal.tenantId, clientId: req.portal.clientId } }))) throw new AppError(404, 'Procedimento não encontrado.');
  const created = await prisma.$transaction(async tx => {
    const request = await tx.portalRequest.create({ data: { tenantId: req.portal.tenantId, clientId: req.portal.clientId, caseId: input.caseId || null, subject: input.subject } });
    await tx.portalRequestMessage.create({ data: { requestId: request.id, senderType: 'CLIENT', senderId: req.portal.id, message: input.message } });
    return request;
  });
  await prisma.notification.create({ data: { tenantId: req.portal.tenantId, userId: null, title: 'Nova solicitação de cliente', message: input.subject, link: '/portal-requests', type: 'INFO' } });
  const office = await prisma.tenant.findUnique({ where: { id: req.portal.tenantId }, select: { email: true } });
  if (office?.email) await sendEmail({ to: office.email, subject: `Nova solicitação pelo portal — ${input.subject}`, text: `Um cliente enviou uma nova solicitação: ${input.subject}. Acesse o ImobGestor para responder.`, html: `<p>Um cliente enviou uma nova solicitação: <strong>${escapeHtml(input.subject)}</strong>.</p><p>Acesse o ImobGestor para responder.</p>` }).catch(error => console.error('[portal-request-email]', error.message));
  await writeAudit({ auth: { tenantId: req.portal.tenantId, userId: null }, ip: req.ip }, 'PORTAL_REQUEST_CREATED', 'PortalRequest', created.id, { clientId: req.portal.clientId });
  res.status(201).json({ item: created });
}));
portalRouter.post('/requests/:requestId/messages', requirePortalAccount, asyncHandler(async (req, res) => {
  const requestId = idParam.parse(req.params.requestId);
  const input = z.object({ message: z.string().trim().min(1).max(5000) }).parse(req.body);
  const request = await prisma.portalRequest.findFirst({ where: { id: requestId, tenantId: req.portal.tenantId, clientId: req.portal.clientId } });
  if (!request || request.status === 'CLOSED') throw new AppError(404, 'Solicitação indisponível ou encerrada.');
  const message = await prisma.portalRequestMessage.create({ data: { requestId, senderType: 'CLIENT', senderId: req.portal.id, message: input.message } });
  await prisma.portalRequest.update({ where: { id: requestId }, data: { status: 'OPEN', updatedAt: new Date() } });
  await prisma.notification.create({ data: { tenantId: req.portal.tenantId, userId: null, title: 'Nova mensagem de cliente', message: request.subject, link: '/portal-requests', type: 'INFO' } });
  const office = await prisma.tenant.findUnique({ where: { id: req.portal.tenantId }, select: { email: true } });
  if (office?.email) await sendEmail({ to: office.email, subject: `Nova mensagem no portal — ${request.subject}`, text: `Um cliente enviou uma nova mensagem na solicitação: ${input.message}`, html: `<p>Um cliente enviou uma nova mensagem na solicitação <strong>${escapeHtml(request.subject)}</strong>:</p><p>${escapeHtml(input.message).replaceAll('\n', '<br/>')}</p><p>Acesse o ImobGestor para responder.</p>` }).catch(error => console.error('[portal-message-email]', error.message));
  res.status(201).json(message);
}));

portalRouter.get('/cases', requirePortalAccount, asyncHandler(async (req, res) => {
  const items = await prisma.case.findMany({
    where: { tenantId: req.portal.tenantId, clientId: req.portal.clientId },
    orderBy: { updatedAt: 'desc' },
    select: { id: true, title: true, status: true, openedAt: true, updatedAt: true, property: { select: { title: true, city: true, state: true } }, template: { select: { name: true } }, stages: { where: { visibleToClient: true }, orderBy: { order: 'asc' }, select: { name: true, order: true, status: true, notesPublic: true } }, documentRequests: { where: { allowClientUpload: true }, select: { id: true, name: true, instructions: true, required: true, status: true } }, documents: { where: { visibility: 'CLIENT' }, select: { id: true, title: true, createdAt: true } } },
  });
  res.json({ items });
}));
portalRouter.get('/cases/:id', requirePortalAccount, asyncHandler(async (req, res) => {
  const item = await prisma.case.findFirst({
    where: { id: idParam.parse(req.params.id), tenantId: req.portal.tenantId, clientId: req.portal.clientId },
    select: { id: true, title: true, description: true, status: true, openedAt: true, updatedAt: true, property: { select: { title: true, city: true, state: true } }, template: { select: { name: true } }, stages: { where: { visibleToClient: true }, orderBy: { order: 'asc' } }, documentRequests: { where: { allowClientUpload: true } }, documents: { where: { visibility: 'CLIENT' }, include: { versions: { orderBy: { createdAt: 'desc' }, take: 1, select: { id: true, originalName: true, createdAt: true } } } } },
  });
  if (!item) throw new AppError(404, 'Serviço não encontrado.');
  res.json(item);
}));


// Customer portal uploads — documents remain internal until reviewed.
portalRouter.post(
  '/documents/upload',
  requirePortalAccount,
  receiveDocumentFile,
  asyncHandler(async (req, res) => {
    requireBlobStorage();

    const input = z.object({
      caseId: idParam,
      requestId: idParam,
    }).parse(req.body);

    const request = await prisma.documentRequest.findFirst({
      where: {
        id: input.requestId,
        caseId: input.caseId,
        tenantId: req.portal.tenantId,
        allowClientUpload: true,
        case: {
          clientId: req.portal.clientId,
        },
      },
      include: {
        case: {
          include: {
            client: true,
          },
        },
      },
    });

    if (!request) {
      throw new AppError(
        404,
        'Solicitação documental não encontrada ou não disponível para envio.'
      );
    }

    const { document, version } = await persistDocumentUpload({
      tenantId: req.portal.tenantId,
      caseRecord: request.case,
      requestId: input.requestId,
      file: req.file,
      title: req.file?.originalname,
      expiresAt: null,
      uploaderType: 'PORTAL',
      uploaderId: req.portal.id,
    });

    await prisma.documentRequest.update({
      where: {
        id: input.requestId,
      },
      data: {
        status: 'RECEIVED',
      },
    });

    await prisma.notification.create({
      data: {
        tenantId: req.portal.tenantId,
        userId: null,
        title: 'Novo documento recebido pelo portal',
        message: `${version.originalName} — ${request.case.title}`,
        link: '/documents',
        type: 'INFO',
      },
    });

    const [client, office] = await Promise.all([
      prisma.client.findFirst({
        where: {
          id: req.portal.clientId,
          tenantId: req.portal.tenantId,
        },
        select: {
          name: true,
          email: true,
        },
      }),

      prisma.tenant.findUnique({
        where: {
          id: req.portal.tenantId,
        },
        select: {
          email: true,
        },
      }),
    ]);

    await runAutomationTrigger(
      req.portal.tenantId,
      'DOCUMENT_RECEIVED',
      {
        caseId: input.caseId,
        caseTitle: request.case.title,
        clientName: client?.name,
        clientEmail: client?.email,
        tenantEmail: office?.email,
        documentName: version.originalName,
        title: document.title,
        message: `Novo documento recebido pelo portal: ${version.originalName}`,
      }
    );

    res.status(201).json({
      id: document.id,
      message: 'Documento enviado e aguardando análise do escritório.',
    });
  })
);

// Protected download — customer portal.
portalRouter.get(
  '/documents/:id/download',
  requirePortalAccount,
  asyncHandler(async (req, res) => {
    requireBlobStorage();

    const doc = await prisma.document.findFirst({
      where: {
        id: idParam.parse(req.params.id),
        tenantId: req.portal.tenantId,
        clientId: req.portal.clientId,
        visibility: 'CLIENT',
        case: {
          clientId: req.portal.clientId,
        },
      },
      include: {
        versions: {
          orderBy: {
            createdAt: 'desc',
          },
          take: 1,
        },
      },
    });

    const version = doc?.versions[0];

    if (!doc || !version) {
      throw new AppError(
        404,
        'Documento não encontrado ou não disponibilizado.'
      );
    }

    await streamPrivateDocument(res, version);
  })
);

export { portalRouter };
export default router;