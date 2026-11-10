import { useEffect, useState } from 'react';
import { Building2, Users, CreditCard, Plus, Power, ShieldCheck } from 'lucide-react';
import { api, getErrorMessage } from '../services/api';
import PageHeader from '../components/PageHeader';
import Modal from '../components/Modal';
import { ErrorMessage, SuccessMessage, EmptyState } from '../components/Feedback';

const planBlank = { name: '', slug: '', description: '', monthlyPrice: '', maxUsers: 3, maxCases: 100, features: 'Clientes, imóveis e procedimentos' };
const officeBlank = { name: '', legalName: '', document: '', email: '', phone: '', ownerName: '', ownerEmail: '', planId: '' };
const brl = value => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export default function AdminPage() {
  const [overview, setOverview] = useState(null);
  const [tenants, setTenants] = useState([]);
  const [plans, setPlans] = useState([]);
  const [showPlan, setShowPlan] = useState(false);
  const [showOffice, setShowOffice] = useState(false);
  const [planForm, setPlanForm] = useState(planBlank);
  const [officeForm, setOfficeForm] = useState(officeBlank);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const [a, b, c] = await Promise.all([api.get('/admin/overview'), api.get('/admin/tenants'), api.get('/admin/plans')]);
      setOverview(a.data); setTenants(b.data.items); setPlans(c.data.items);
    } catch (e) { setError(getErrorMessage(e)); }
  }
  useEffect(() => { load(); }, []);

  async function createOffice(e) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const { data } = await api.post('/admin/tenants', officeForm);
      setShowOffice(false); setOfficeForm(officeBlank);
      setSuccess(data.emailSent ? 'Escritório criado e convite do proprietário enviado.' : 'Escritório criado. Configure o provedor de e-mail para enviar o convite automaticamente.');
      if (data.developmentInviteUrl) window.prompt('Link de ativação para teste local:', data.developmentInviteUrl);
      await load();
    } catch (e) { setError(getErrorMessage(e)); }
    finally { setBusy(false); }
  }

  async function createPlan(e) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      await api.post('/admin/plans', { ...planForm, monthlyPrice: planForm.monthlyPrice, maxUsers: Number(planForm.maxUsers), maxCases: Number(planForm.maxCases), features: planForm.features.split(',').map(x => x.trim()).filter(Boolean) });
      setShowPlan(false); setPlanForm(planBlank); setSuccess('Plano criado.'); await load();
    } catch (e) { setError(getErrorMessage(e)); }
    finally { setBusy(false); }
  }

  async function toggleTenant(item) {
    const status = item.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
    if (!window.confirm(`${status === 'ACTIVE' ? 'Reativar' : 'Suspender'} ${item.name}?`)) return;
    try { await api.patch(`/admin/tenants/${item.id}/status`, { status }); setSuccess('Situação do escritório atualizada.'); await load(); }
    catch (e) { setError(getErrorMessage(e)); }
  }

  async function assignPlan(tenant, planId) {
    if (!planId) return;
    try { await api.put(`/admin/tenants/${tenant.id}/subscription`, { planId, status: 'ACTIVE' }); setSuccess(`Plano atualizado para ${tenant.name}.`); await load(); }
    catch (e) { setError(getErrorMessage(e)); }
  }

  return <>
    <PageHeader eyebrow="PROPRIETÁRIO DA PLATAFORMA" title="Administração SaaS" description="Gerencie os escritórios, planos e licenças do ImobGestor." />
    <ErrorMessage>{error}</ErrorMessage><SuccessMessage>{success}</SuccessMessage>
    {overview && <div className="stats-grid">
      <div className="stat-card"><div className="stat-icon green"><Building2 size={20}/></div><span>Escritórios</span><strong>{overview.tenants}</strong></div>
      <div className="stat-card"><div className="stat-icon blue"><Users size={20}/></div><span>Usuários</span><strong>{overview.users}</strong></div>
      <div className="stat-card"><div className="stat-icon purple"><CreditCard size={20}/></div><span>Assinaturas</span><strong>{overview.subscriptions}</strong></div>
      <div className="stat-card"><div className="stat-icon orange"><ShieldCheck size={20}/></div><span>Escritórios ativos</span><strong>{overview.activeTenants}</strong></div>
    </div>}

    <section className="panel">
      <div className="panel-heading"><div><h2>Escritórios cadastrados</h2><p>Contas e licenças na plataforma</p></div><button className="button button-primary button-small" onClick={() => setShowOffice(true)}><Plus size={15}/> Novo escritório</button></div>
      {tenants.length ? <div className="table-wrap"><table><thead><tr><th>Escritório</th><th>Usuários</th><th>Clientes</th><th>Plano</th><th>Situação</th><th>Ações</th></tr></thead><tbody>
        {tenants.map(t => <tr key={t.id}><td><strong>{t.name}</strong><small className="table-subline">{t.email || t.document || t.id}</small></td><td>{t._count.memberships}</td><td>{t._count.clients}</td><td><select className="compact-select" value={t.subscription?.planId || ''} onChange={e => assignPlan(t, e.target.value)}><option value="">Sem plano</option>{plans.filter(p => p.isActive).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></td><td><span className={`status-pill status-${t.status.toLowerCase()}`}>{t.status === 'ACTIVE' ? 'Ativo' : 'Suspenso'}</span></td><td><button className="icon-button" onClick={() => toggleTenant(t)} title="Ativar/suspender"><Power size={16}/></button></td></tr>)}
      </tbody></table></div> : <EmptyState title="Nenhum escritório" description="Os escritórios cadastrados aparecerão aqui."/>}
    </section>

    <section className="panel section-gap">
      <div className="panel-heading"><div><h2>Planos comerciais</h2><p>Valores e limites usados no licenciamento</p></div><button className="button button-primary button-small" onClick={() => setShowPlan(true)}><Plus size={15}/> Novo plano</button></div>
      {plans.map(p => <div className="plan-row" key={p.id}><div><strong>{p.name}</strong><span>{p.maxUsers} usuários · até {p.maxCases} procedimentos · {brl(p.monthlyPrice)}/mês</span></div><span className={`status-pill ${p.isActive ? 'status-active' : 'status-inactive'}`}>{p.isActive ? 'Ativo' : 'Inativo'}</span></div>)}
    </section>

    {showOffice && <Modal title="Cadastrar escritório" onClose={() => setShowOffice(false)}><form className="form-grid" onSubmit={createOffice}>
      <label className="full-field">Nome do escritório<input required value={officeForm.name} onChange={e => setOfficeForm({ ...officeForm, name: e.target.value })}/></label>
      <label>Razão social<input value={officeForm.legalName} onChange={e => setOfficeForm({ ...officeForm, legalName: e.target.value })}/></label>
      <label>CNPJ/CPF<input value={officeForm.document} onChange={e => setOfficeForm({ ...officeForm, document: e.target.value })}/></label>
      <label>E-mail do escritório<input type="email" required value={officeForm.email} onChange={e => setOfficeForm({ ...officeForm, email: e.target.value })}/></label>
      <label>Telefone<input value={officeForm.phone} onChange={e => setOfficeForm({ ...officeForm, phone: e.target.value })}/></label>
      <label>Nome do proprietário<input required value={officeForm.ownerName} onChange={e => setOfficeForm({ ...officeForm, ownerName: e.target.value })}/></label>
      <label>E-mail do proprietário<input type="email" required value={officeForm.ownerEmail} onChange={e => setOfficeForm({ ...officeForm, ownerEmail: e.target.value })}/></label>
      <label className="full-field">Plano inicial<select required value={officeForm.planId} onChange={e => setOfficeForm({ ...officeForm, planId: e.target.value })}><option value="">Selecione um plano</option>{plans.filter(p => p.isActive).map(p => <option key={p.id} value={p.id}>{p.name} — {brl(p.monthlyPrice)}/mês</option>)}</select></label>
      <div className="notice-box full-field">Será criado um período de avaliação de 14 dias. O proprietário receberá um convite para criar seu acesso.</div>
      <div className="form-actions full-field"><button type="button" className="button button-secondary" onClick={() => setShowOffice(false)}>Cancelar</button><button className="button button-primary" disabled={busy}>{busy ? 'Criando...' : 'Criar escritório'}</button></div>
    </form></Modal>}

    {showPlan && <Modal title="Criar plano" onClose={() => setShowPlan(false)}><form className="form-grid" onSubmit={createPlan}>
      <label className="full-field">Nome<input required value={planForm.name} onChange={e => setPlanForm({ ...planForm, name: e.target.value })}/></label>
      <label>Identificador (slug)<input required value={planForm.slug} onChange={e => setPlanForm({ ...planForm, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })}/></label>
      <label>Valor mensal<input required type="number" step="0.01" min="0" value={planForm.monthlyPrice} onChange={e => setPlanForm({ ...planForm, monthlyPrice: e.target.value })}/></label>
      <label>Máximo de usuários<input type="number" min="1" value={planForm.maxUsers} onChange={e => setPlanForm({ ...planForm, maxUsers: e.target.value })}/></label>
      <label>Máximo de procedimentos<input type="number" min="1" value={planForm.maxCases} onChange={e => setPlanForm({ ...planForm, maxCases: e.target.value })}/></label>
      <label className="full-field">Recursos separados por vírgula<textarea rows="2" value={planForm.features} onChange={e => setPlanForm({ ...planForm, features: e.target.value })}/></label>
      <div className="form-actions full-field"><button type="button" className="button button-secondary" onClick={() => setShowPlan(false)}>Cancelar</button><button className="button button-primary" disabled={busy}>{busy ? 'Criando...' : 'Criar plano'}</button></div>
    </form></Modal>}
  </>;
}
