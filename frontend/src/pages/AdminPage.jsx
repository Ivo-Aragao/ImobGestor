
import { useEffect, useState } from 'react';
import {
  Building2,
  Users,
  CreditCard,
  Plus,
  Power,
  ShieldCheck,
  Mail,
  Send,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';

import { api, getErrorMessage } from '../services/api';
import PageHeader from '../components/PageHeader';
import Modal from '../components/Modal';
import { ErrorMessage, SuccessMessage, EmptyState } from '../components/Feedback';

const planBlank = {
  name: '',
  slug: '',
  description: '',
  monthlyPrice: '',
  maxUsers: 3,
  maxCases: 100,
  features: 'Clientes, imóveis e procedimentos',
};

const officeBlank = {
  name: '',
  legalName: '',
  document: '',
  email: '',
  phone: '',
  ownerName: '',
  ownerEmail: '',
  planId: '',
};

const brl = value =>
  Number(value || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });

export default function AdminPage() {
  const [tab, setTab] = useState('companies');

  const [overview, setOverview] = useState(null);
  const [tenants, setTenants] = useState([]);
  const [users, setUsers] = useState([]);
  const [plans, setPlans] = useState([]);
  const [emailSettings, setEmailSettings] = useState(null);

  const [emailDrafts, setEmailDrafts] = useState({});
  const [userSearch, setUserSearch] = useState('');

  const [showPlan, setShowPlan] = useState(false);
  const [showOffice, setShowOffice] = useState(false);

  const [planForm, setPlanForm] = useState(planBlank);
  const [officeForm, setOfficeForm] = useState(officeBlank);

  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);
  const [busyItem, setBusyItem] = useState('');

  async function load() {
    try {
      setError('');

      const [a, b, c, d, e] = await Promise.all([
        api.get('/admin/overview'),
        api.get('/admin/tenants'),
        api.get('/admin/plans'),
        api.get('/admin/users'),
        api.get('/admin/email-settings'),
      ]);

      setOverview(a.data);
      setTenants(b.data.items || []);
      setPlans(c.data.items || []);
      setUsers(d.data.items || []);
      setEmailSettings(e.data);

      setEmailDrafts(
        Object.fromEntries(
          (b.data.items || []).map(item => [item.id, item.email || ''])
        )
      );
    } catch (e) {
      setError(getErrorMessage(e));
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function saveTenantEmail(item) {
    const email = (emailDrafts[item.id] || '').trim();

    setBusyItem(`email-${item.id}`);
    setError('');
    setSuccess('');

    try {
      const { data } = await api.patch(
        `/admin/tenants/${item.id}/email`,
        { email }
      );

      setTenants(current =>
        current.map(t => t.id === item.id ? { ...t, email: data.email } : t)
      );

      setSuccess(`E-mail de destino atualizado para ${item.name}.`);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setBusyItem('');
    }
  }

  async function testTenantEmail(item) {
    if (!window.confirm(`Enviar um e-mail de teste para ${item.email}?`)) {
      return;
    }

    setBusyItem(`test-${item.id}`);
    setError('');
    setSuccess('');

    try {
      const { data } = await api.post(
        `/admin/tenants/${item.id}/test-email`
      );

      setSuccess(`E-mail de teste enviado para ${data.to}.`);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setBusyItem('');
    }
  }

  async function toggleTenant(item) {
    const status = item.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';

    if (!window.confirm(
      `${status === 'ACTIVE' ? 'Reativar' : 'Suspender'} ${item.name}?`
    )) return;

    try {
      await api.patch(`/admin/tenants/${item.id}/status`, { status });
      setSuccess('Situação da empresa atualizada.');
      await load();
    } catch (e) {
      setError(getErrorMessage(e));
    }
  }

  async function toggleUser(user) {
    const status = user.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';

    if (!window.confirm(
      `${status === 'ACTIVE' ? 'Ativar' : 'Desativar'} o acesso de ${user.name}?`
    )) return;

    setBusyItem(`user-${user.id}`);
    setError('');
    setSuccess('');

    try {
      await api.patch(`/admin/users/${user.id}/status`, { status });
      setSuccess(`Acesso de ${user.name} atualizado.`);
      await load();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setBusyItem('');
    }
  }

  async function assignPlan(tenant, planId) {
    if (!planId) return;

    try {
      await api.put(`/admin/tenants/${tenant.id}/subscription`, {
        planId,
        status: 'ACTIVE',
      });

      setSuccess(`Plano atualizado para ${tenant.name}.`);
      await load();
    } catch (e) {
      setError(getErrorMessage(e));
    }
  }

  async function createOffice(e) {
    e.preventDefault();
    setBusy(true);
    setError('');

    try {
      const { data } = await api.post('/admin/tenants', officeForm);

      setShowOffice(false);
      setOfficeForm(officeBlank);

      setSuccess(
        data.emailSent
          ? 'Empresa criada e convite enviado.'
          : 'Empresa criada. Verifique a conexão de e-mail para o convite.'
      );

      if (data.developmentInviteUrl) {
        window.prompt('Link de ativação para teste local:', data.developmentInviteUrl);
      }

      await load();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function createPlan(e) {
    e.preventDefault();
    setBusy(true);
    setError('');

    try {
      await api.post('/admin/plans', {
        ...planForm,
        monthlyPrice: planForm.monthlyPrice,
        maxUsers: Number(planForm.maxUsers),
        maxCases: Number(planForm.maxCases),
        features: planForm.features.split(',').map(x => x.trim()).filter(Boolean),
      });

      setShowPlan(false);
      setPlanForm(planBlank);
      setSuccess('Plano criado.');
      await load();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const filteredUsers = users.filter(user => {
    const q = userSearch.toLowerCase();

    return (
      user.name.toLowerCase().includes(q) ||
      user.email.toLowerCase().includes(q) ||
      user.memberships.some(m => m.tenant?.name?.toLowerCase().includes(q))
    );
  });

  const senderMatches = Boolean(emailSettings?.senderMatches);

  return (
    <>
      <PageHeader
        eyebrow="ADMINISTRADOR DA PLATAFORMA"
        title="Painel do administrador"
        description="Controle central de empresas, usuários e notificações do ImobGestor."
      />

      <ErrorMessage>{error}</ErrorMessage>
      <SuccessMessage>{success}</SuccessMessage>

      {overview && (
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-icon green"><Building2 size={20} /></div>
            <span>Empresas cadastradas</span>
            <strong>{overview.tenants}</strong>
          </div>

          <div className="stat-card">
            <div className="stat-icon blue"><Users size={20} /></div>
            <span>Usuários cadastrados</span>
            <strong>{overview.users}</strong>
          </div>

          <div className="stat-card">
            <div className="stat-icon purple"><CreditCard size={20} /></div>
            <span>Assinaturas</span>
            <strong>{overview.subscriptions}</strong>
          </div>

          <div className="stat-card">
            <div className="stat-icon orange"><ShieldCheck size={20} /></div>
            <span>Empresas ativas</span>
            <strong>{overview.activeTenants}</strong>
          </div>
        </div>
      )}

      <section className="panel section-gap">
        <div className="panel-heading">
          <div>
            <h2>Central de e-mails da plataforma</h2>
            <p>Conta oficial utilizada para enviar notificações às empresas.</p>
          </div>
          <Mail size={21} className="muted-icon" />
        </div>

        <div className="integration-card">
          <div className="integration-card-head">
            <div className="integration-icon"><Mail size={20} /></div>

            <span className={`integration-custom-badge ${
              senderMatches ? 'integration-badge-success' : 'integration-badge-warning'
            }`}>
              {senderMatches ? 'Remetente confirmado' : 'Verificar configuração'}
            </span>
          </div>

          <h3>Remetente oficial</h3>

          <p>
            Todas as notificações automáticas da plataforma devem sair pela
            conta Gmail do administrador.
          </p>

          <div className="integration-substatus">
            <span>
              <strong>Conta esperada:</strong>{' '}
              {emailSettings?.expectedSenderEmail || 'Não configurada'}
            </span>

            <span>
              <strong>Conta conectada:</strong>{' '}
              {emailSettings?.senderEmail || 'Nenhuma conta conectada'}
            </span>

            <span>
              <strong>Conexão:</strong>{' '}
              {emailSettings?.gmailConnected ? 'Gmail conectado' : 'Gmail desconectado'}
            </span>
          </div>

          {!senderMatches && (
            <div className="notice-box">
              Para ativar os envios, configure o remetente oficial na Vercel
              e conecte essa mesma conta na integração Gmail.
            </div>
          )}
        </div>
      </section>

      <section className="panel section-gap">
        <div className="panel-heading">
          <div>
            <h2>Gerenciamento da plataforma</h2>
            <p>Selecione a área que deseja administrar.</p>
          </div>

          <button className="icon-button" onClick={load} title="Atualizar painel">
            <RefreshCw size={17} />
          </button>
        </div>

        <div className="filter-tabs">
          <button
            className={tab === 'companies' ? 'active' : ''}
            onClick={() => setTab('companies')}
          >
            <Building2 size={14} /> Empresas
          </button>

          <button
            className={tab === 'users' ? 'active' : ''}
            onClick={() => setTab('users')}
          >
            <Users size={14} /> Usuários
          </button>

          <button
            className={tab === 'emails' ? 'active' : ''}
            onClick={() => setTab('emails')}
          >
            <Mail size={14} /> Notificações
          </button>

          <button
            className={tab === 'plans' ? 'active' : ''}
            onClick={() => setTab('plans')}
          >
            <CreditCard size={14} /> Planos
          </button>
        </div>

        {tab === 'companies' && (
          <>
            <div className="panel-heading section-gap">
              <div>
                <h2>Empresas cadastradas</h2>
                <p>Gerencie as contas e os destinatários das notificações.</p>
              </div>

              <button
                className="button button-primary button-small"
                onClick={() => setShowOffice(true)}
              >
                <Plus size={15} /> Nova empresa
              </button>
            </div>

            {tenants.length ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Empresa</th>
                      <th>E-mail de destino</th>
                      <th>Usuários</th>
                      <th>Plano</th>
                      <th>Situação</th>
                      <th>Ações</th>
                    </tr>
                  </thead>

                  <tbody>
                    {tenants.map(t => (
                      <tr key={t.id}>
                        <td>
                          <strong>{t.name}</strong>
                          <small className="table-subline">
                            {t.document || t.id}
                          </small>
                        </td>

                        <td>
                          <input
                            type="email"
                            className="compact-select"
                            style={{ width: 220, maxWidth: '100%' }}
                            placeholder="E-mail da empresa"
                            value={emailDrafts[t.id] ?? ''}
                            onChange={e => setEmailDrafts(current => ({
                              ...current,
                              [t.id]: e.target.value,
                            }))}
                          />

                          <button
                            className="button button-secondary button-small"
                            disabled={busyItem === `email-${t.id}`}
                            onClick={() => saveTenantEmail(t)}
                          >
                            {busyItem === `email-${t.id}` ? 'Salvando...' : 'Salvar'}
                          </button>
                        </td>

                        <td>{t._count.memberships}</td>

                        <td>
                          <select
                            className="compact-select"
                            value={t.subscription?.planId || ''}
                            onChange={e => assignPlan(t, e.target.value)}
                          >
                            <option value="">Sem plano</option>

                            {plans.filter(p => p.isActive).map(p => (
                              <option key={p.id} value={p.id}>{p.name}</option>
                            ))}
                          </select>
                        </td>

                        <td>
                          <span className={`status-pill status-${t.status.toLowerCase()}`}>
                            {t.status === 'ACTIVE' ? 'Ativa' : 'Suspensa'}
                          </span>
                        </td>

                        <td>
                          <div className="document-actions">
                            <button
                              className="button button-secondary button-small"
                              disabled={!t.email || !senderMatches || busyItem === `test-${t.id}`}
                              onClick={() => testTenantEmail(t)}
                              title="Enviar e-mail de teste"
                            >
                              <Send size={13} />
                              {busyItem === `test-${t.id}` ? 'Enviando...' : 'Testar'}
                            </button>

                            <button
                              className="icon-button"
                              onClick={() => toggleTenant(t)}
                              title="Ativar ou suspender empresa"
                            >
                              <Power size={16} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState
                title="Nenhuma empresa cadastrada"
                description="As empresas aparecerão aqui."
              />
            )}
          </>
        )}

        {tab === 'users' && (
          <>
            <div className="panel-heading section-gap">
              <div>
                <h2>Usuários da plataforma</h2>
                <p>Consulte os acessos e as empresas vinculadas a cada pessoa.</p>
              </div>
            </div>

            <div className="toolbar-search">
              <input
                className="compact-select"
                style={{ width: '100%', maxWidth: 420, minHeight: 38 }}
                placeholder="Buscar por nome, e-mail ou empresa..."
                value={userSearch}
                onChange={e => setUserSearch(e.target.value)}
              />
            </div>

            {filteredUsers.length ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Usuário</th>
                      <th>E-mail</th>
                      <th>Empresas vinculadas</th>
                      <th>Situação</th>
                      <th>Ações</th>
                    </tr>
                  </thead>

                  <tbody>
                    {filteredUsers.map(user => (
                      <tr key={user.id}>
                        <td><strong>{user.name}</strong></td>
                        <td>{user.email}</td>

                        <td>
                          {user.memberships.map(m => m.tenant?.name).filter(Boolean).join(', ') || 'Sem empresa'}
                        </td>

                        <td>
                          <span className={`status-pill ${
                            user.status === 'ACTIVE' ? 'status-active' : 'status-inactive'
                          }`}>
                            {user.status === 'ACTIVE' ? 'Ativo' : 'Inativo'}
                          </span>
                        </td>

                        <td>
                          <button
                            className="icon-button"
                            disabled={busyItem === `user-${user.id}`}
                            onClick={() => toggleUser(user)}
                            title="Ativar ou desativar usuário"
                          >
                            <Power size={16} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState
                title="Nenhum usuário encontrado"
                description="Tente pesquisar por outro nome ou e-mail."
              />
            )}
          </>
        )}

        {tab === 'emails' && (
          <>
            <div className="panel-heading section-gap">
              <div>
                <h2>Regras de envio</h2>
                <p>Como os e-mails automáticos serão entregues.</p>
              </div>
            </div>

            <div className="notice-box">
              <strong>Remetente:</strong> conta Gmail oficial do administrador.
              <br />
              <strong>Destinatário:</strong> endereço cadastrado em cada empresa.
              <br />
              <strong>Separação:</strong> cada empresa recebe somente suas próprias notificações.
            </div>

            <div className="recent-list">
              <div className="recent-row">
                <div className="attention-icon green"><CheckCircle2 size={18} /></div>
                <div className="recent-info">
                  <strong>Alertas de documentos</strong>
                  <span>Vencimentos e documentos vencidos.</span>
                </div>
              </div>

              <div className="recent-row">
                <div className="attention-icon green"><CheckCircle2 size={18} /></div>
                <div className="recent-info">
                  <strong>Lembretes de tarefas</strong>
                  <span>Envio para o e-mail cadastrado pela empresa.</span>
                </div>
              </div>

              <div className="recent-row">
                <div className="attention-icon green"><CheckCircle2 size={18} /></div>
                <div className="recent-info">
                  <strong>Lembretes de compromissos</strong>
                  <span>Envio para o e-mail cadastrado pela empresa.</span>
                </div>
              </div>

              <div className="recent-row">
                <div className="attention-icon green"><CheckCircle2 size={18} /></div>
                <div className="recent-info">
                  <strong>Resumo diário sem alertas</strong>
                  <span>Mensagem de tranquilidade quando não houver avisos aplicáveis.</span>
                </div>
              </div>
            </div>

            {!senderMatches && (
              <div className="notice-box">
                <AlertTriangle size={15} /> A conta remetente ainda precisa ser confirmada.
              </div>
            )}
          </>
        )}

        {tab === 'plans' && (
          <>
            <div className="panel-heading section-gap">
              <div>
                <h2>Planos comerciais</h2>
                <p>Valores e limites utilizados no licenciamento.</p>
              </div>

              <button
                className="button button-primary button-small"
                onClick={() => setShowPlan(true)}
              >
                <Plus size={15} /> Novo plano
              </button>
            </div>

            {plans.length ? plans.map(p => (
              <div className="plan-row" key={p.id}>
                <div>
                  <strong>{p.name}</strong>
                  <span>
                    {p.maxUsers} usuários · até {p.maxCases} procedimentos · {brl(p.monthlyPrice)}/mês
                  </span>
                </div>

                <span className={`status-pill ${
                  p.isActive ? 'status-active' : 'status-inactive'
                }`}>
                  {p.isActive ? 'Ativo' : 'Inativo'}
                </span>
              </div>
            )) : (
              <EmptyState title="Nenhum plano cadastrado" />
            )}
          </>
        )}
      </section>

      {showOffice && (
        <Modal title="Cadastrar empresa" onClose={() => setShowOffice(false)}>
          <form className="form-grid" onSubmit={createOffice}>
            <label className="full-field">
              Nome da empresa
              <input required value={officeForm.name} onChange={e => setOfficeForm({ ...officeForm, name: e.target.value })} />
            </label>

            <label>
              Razão social
              <input value={officeForm.legalName} onChange={e => setOfficeForm({ ...officeForm, legalName: e.target.value })} />
            </label>

            <label>
              CNPJ/CPF
              <input value={officeForm.document} onChange={e => setOfficeForm({ ...officeForm, document: e.target.value })} />
            </label>

            <label className="full-field">
              E-mail de destino das notificações
              <input type="email" required value={officeForm.email} onChange={e => setOfficeForm({ ...officeForm, email: e.target.value })} />
            </label>

            <label>
              Telefone
              <input value={officeForm.phone} onChange={e => setOfficeForm({ ...officeForm, phone: e.target.value })} />
            </label>

            <label>
              Nome do proprietário
              <input required value={officeForm.ownerName} onChange={e => setOfficeForm({ ...officeForm, ownerName: e.target.value })} />
            </label>

            <label>
              E-mail de acesso do proprietário
              <input type="email" required value={officeForm.ownerEmail} onChange={e => setOfficeForm({ ...officeForm, ownerEmail: e.target.value })} />
            </label>

            <label className="full-field">
              Plano inicial
              <select required value={officeForm.planId} onChange={e => setOfficeForm({ ...officeForm, planId: e.target.value })}>
                <option value="">Selecione um plano</option>
                {plans.filter(p => p.isActive).map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name} — {brl(p.monthlyPrice)}/mês
                  </option>
                ))}
              </select>
            </label>

            <div className="notice-box full-field">
              Será criado um período de avaliação de 14 dias. O proprietário receberá um convite para ativar o acesso.
            </div>

            <div className="form-actions full-field">
              <button type="button" className="button button-secondary" onClick={() => setShowOffice(false)}>
                Cancelar
              </button>
              <button className="button button-primary" disabled={busy}>
                {busy ? 'Criando...' : 'Criar empresa'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {showPlan && (
        <Modal title="Criar plano" onClose={() => setShowPlan(false)}>
          <form className="form-grid" onSubmit={createPlan}>
            <label className="full-field">
              Nome
              <input required value={planForm.name} onChange={e => setPlanForm({ ...planForm, name: e.target.value })} />
            </label>

            <label>
              Identificador (slug)
              <input required value={planForm.slug} onChange={e => setPlanForm({ ...planForm, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })} />
            </label>

            <label>
              Valor mensal
              <input required type="number" min="0" step="0.01" value={planForm.monthlyPrice} onChange={e => setPlanForm({ ...planForm, monthlyPrice: e.target.value })} />
            </label>

            <label>
              Máximo de usuários
              <input type="number" min="1" value={planForm.maxUsers} onChange={e => setPlanForm({ ...planForm, maxUsers: e.target.value })} />
            </label>

            <label>
              Máximo de procedimentos
              <input type="number" min="1" value={planForm.maxCases} onChange={e => setPlanForm({ ...planForm, maxCases: e.target.value })} />
            </label>

            <label className="full-field">
              Recursos separados por vírgula
              <textarea rows="3" value={planForm.features} onChange={e => setPlanForm({ ...planForm, features: e.target.value })} />
            </label>

            <div className="form-actions full-field">
              <button type="button" className="button button-secondary" onClick={() => setShowPlan(false)}>
                Cancelar
              </button>
              <button className="button button-primary" disabled={busy}>
                {busy ? 'Criando...' : 'Criar plano'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
