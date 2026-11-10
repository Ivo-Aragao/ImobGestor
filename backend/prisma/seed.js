import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const plans = [
  { name: 'Inicial', slug: 'inicial', monthlyPrice: '149.90', maxUsers: 3, maxCases: 100, features: ['Clientes', 'Imóveis', 'Procedimentos', 'Documentos', 'Agenda'] },
  { name: 'Profissional', slug: 'profissional', monthlyPrice: '249.90', maxUsers: 10, maxCases: 500, features: ['Todos os recursos Inicial', 'Portal do cliente', 'Financeiro', 'Relatórios', 'Notificações'] },
  { name: 'Empresarial', slug: 'empresarial', monthlyPrice: '399.90', maxUsers: 25, maxCases: 2000, features: ['Todos os recursos Profissional', 'Equipe avançada', 'Relatórios avançados', 'Suporte prioritário'] },
];
try {
  for (const plan of plans) {
    await prisma.plan.upsert({ where: { slug: plan.slug }, create: plan, update: { name: plan.name, monthlyPrice: plan.monthlyPrice, maxUsers: plan.maxUsers, maxCases: plan.maxCases, features: plan.features } });
  }
  console.log('Planos iniciais verificados/criados.');
} finally { await prisma.$disconnect(); }
