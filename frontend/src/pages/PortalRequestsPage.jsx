import { useEffect, useState } from 'react';
import { api, getErrorMessage } from '../services/api';
import { ErrorMessage, EmptyState, SuccessMessage } from '../components/Feedback';
import PageHeader from '../components/PageHeader';
import { MessageSquareText, Send, RefreshCw } from 'lucide-react';

const statuses = [ ['OPEN', 'Aberta'], ['IN_PROGRESS', 'Em atendimento'], ['ANSWERED', 'Respondida'], ['CLOSED', 'Encerrada'] ];
const statusLabel = Object.fromEntries(statuses);

export default function PortalRequestsPage() {
  const [items, setItems] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [filter, setFilter] = useState('ALL');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    try { const { data } = await api.get('/portal-requests'); setItems(data.items || []); setError(''); }
    catch (e) { setError(getErrorMessage(e)); }
  }
  useEffect(() => { load(); }, []);

  async function updateStatus(item, status) {
    setBusy(true); setError(''); setSuccess('');
    try { await api.patch(`/portal-requests/${item.id}`, { status }); setSuccess('Situação atualizada.'); await load(); }
    catch (e) { setError(getErrorMessage(e)); }
    finally { setBusy(false); }
  }

  async function reply(item) {
    const message = (drafts[item.id] || '').trim();
    if (!message) return;
    setBusy(true); setError(''); setSuccess('');
    try { await api.post(`/portal-requests/${item.id}/messages`, { message }); setDrafts(old => ({ ...old, [item.id]: '' })); setSuccess('Resposta enviada.'); await load(); }
    catch (e) { setError(getErrorMessage(e)); }
    finally { setBusy(false); }
  }

  const filtered = filter === 'ALL' ? items : items.filter(item => item.status === filter);
  return <>
    <PageHeader eyebrow="RELACIONAMENTO COM CLIENTES" title="Atendimento do portal" description="Receba solicitações e responda mensagens enviadas pelos clientes no portal independente." action={<button className="button button-secondary" onClick={load}><RefreshCw size={16}/> Atualizar</button>}/>
    <ErrorMessage>{error}</ErrorMessage><SuccessMessage>{success}</SuccessMessage>
    <section className="panel">
      <div className="toolbar-search"><div><strong>{items.length} solicitação(ões)</strong><p className="muted">As conversas ficam vinculadas ao cliente e, opcionalmente, ao procedimento.</p></div><select value={filter} onChange={e => setFilter(e.target.value)}><option value="ALL">Todas</option>{statuses.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div>
      {filtered.length ? filtered.map(item => <article className="portal-request-thread office-request-thread" key={item.id}>
        <div className="portal-request-head"><div><strong>{item.subject}</strong><small>{item.client.name} · {item.client.email || 'Sem e-mail'}{item.case ? ` · ${item.case.title}` : ' · Atendimento geral'}</small><small>Aberta em {new Date(item.createdAt).toLocaleString('pt-BR')} · Atualizada em {new Date(item.updatedAt).toLocaleString('pt-BR')}</small></div>
          <select value={item.status} disabled={busy} onChange={e => updateStatus(item, e.target.value)}>{statuses.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
        </div>
        <div className="portal-message-list">{item.messages.map(message => <div className={`portal-message ${message.senderType === 'STAFF' ? 'mine' : ''}`} key={message.id}><small>{message.senderType === 'STAFF' ? 'Equipe do escritório' : 'Cliente'} · {new Date(message.createdAt).toLocaleString('pt-BR')}</small><p>{message.message}</p></div>)}</div>
        {item.status !== 'CLOSED' && <div className="portal-reply"><textarea rows={2} maxLength={5000} value={drafts[item.id] || ''} onChange={e => setDrafts(old => ({ ...old, [item.id]: e.target.value }))} placeholder="Escreva uma resposta para o cliente..."/><button className="button button-primary" disabled={busy || !(drafts[item.id] || '').trim()} onClick={() => reply(item)}><Send size={15}/> Responder</button></div>}
      </article>) : <EmptyState title="Nenhuma solicitação nesta situação" description="Quando os clientes enviarem mensagens pelo portal, elas aparecerão aqui."/>}
    </section>
  </>;
}
