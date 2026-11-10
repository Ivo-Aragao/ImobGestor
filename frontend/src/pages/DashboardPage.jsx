import { useEffect, useState } from 'react';
import { ArrowUpRight, BriefcaseBusiness, Clock3, FileWarning, Home, Users, CheckCircle2, CalendarClock, Wallet, Activity } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, getErrorMessage } from '../services/api';
import PageHeader from '../components/PageHeader';
import { EmptyState, ErrorMessage } from '../components/Feedback';
const money = value => Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const statusLabel = status => ({ NEW:'Novo',IN_PROGRESS:'Em andamento',WAITING_CLIENT:'Aguardando cliente',WAITING_EXTERNAL:'Aguardando externo',WAITING_INTERNAL:'Análise interna',SUSPENDED:'Suspenso',COMPLETED:'Concluído',CANCELED:'Cancelado' })[status] || status;
const actionLabel = action => ({ CLIENT_CREATED:'Cliente cadastrado',CLIENT_UPDATED:'Cliente atualizado',PROPERTY_CREATED:'Imóvel cadastrado',PROPERTY_UPDATED:'Imóvel atualizado',CASE_CREATED:'Procedimento criado',CASE_UPDATED:'Procedimento atualizado',CASE_STAGE_UPDATED:'Etapa atualizada',DOCUMENT_UPLOADED:'Documento enviado',DOCUMENT_PUBLISHED_TO_CLIENT:'Documento publicado',TASK_CREATED:'Tarefa criada',TASK_UPDATED:'Tarefa atualizada',CALENDAR_EVENT_CREATED:'Compromisso criado',FINANCIAL_ENTRY_CREATED:'Lançamento financeiro criado' })[action] || action.replaceAll('_',' ').toLowerCase();
export default function DashboardPage() {
 const [data,setData]=useState(null),[error,setError]=useState('');
 useEffect(()=>{api.get('/dashboard').then(r=>setData(r.data)).catch(e=>setError(getErrorMessage(e)));},[]);
 const s=data?.stats;
 const cards=[
  {label:'Clientes ativos',value:s?.clients??'—',icon:Users,tone:'green',foot:'Cadastros ativos'},
  {label:'Imóveis cadastrados',value:s?.properties??'—',icon:Home,tone:'blue',foot:'Urbanos e rurais'},
  {label:'Procedimentos ativos',value:s?.activeCases??'—',icon:BriefcaseBusiness,tone:'purple',foot:`${s?.completedCases??0} concluídos`},
  {label:'Tarefas em aberto',value:s?.openTasks??'—',icon:Clock3,tone:'orange',foot:`${s?.overdueTasks??0} atrasadas`},
  {label:'Documentos pendentes',value:s?.pendingDocs??'—',icon:FileWarning,tone:'orange',foot:'Aguardando envio ou revisão'},
  {label:'Recebido neste mês',value:s?money(s.monthReceived):'—',icon:Wallet,tone:'green',foot:`Despesas pagas: ${s?money(s.monthExpenses):'—'}`},
 ];
 return <><PageHeader eyebrow="VISÃO GERAL" title="Painel do escritório" description="Acompanhe clientes, imóveis, procedimentos, prazos e resultados financeiros."/><ErrorMessage>{error}</ErrorMessage>
  <div className="stats-grid dashboard-stats">{cards.map(card=>{const Icon=card.icon;return <div className="stat-card" key={card.label}><div className={`stat-icon ${card.tone}`}><Icon size={20}/></div><span>{card.label}</span><strong>{card.value}</strong><small>{card.foot}</small></div>;})}</div>
  <div className="dashboard-grid"><section className="panel"><div className="panel-heading"><div><h2>Procedimentos recentes</h2><p>Últimas movimentações cadastradas</p></div><Link to="/cases" className="text-link">Ver todos <ArrowUpRight size={15}/></Link></div>{data?.recentCases?.length?<div className="recent-list">{data.recentCases.map(item=><div className="recent-row" key={item.id}><div className="recent-avatar">{item.client?.name?.slice(0,1)?.toUpperCase()}</div><div className="recent-info"><strong>{item.title}</strong><span>{item.client?.name} · {item.property?.title}</span></div><span className={`status-pill status-${item.status.toLowerCase()}`}>{statusLabel(item.status)}</span></div>)}</div>:<EmptyState title="Nenhum procedimento ainda" description="Cadastre um serviço para começar a acompanhar os atendimentos."/>}</section>
   <section className="panel"><div className="panel-heading"><div><h2>Pontos de atenção</h2><p>Itens que merecem acompanhamento</p></div><FileWarning size={19} className="muted-icon"/></div><Link className="attention-item attention-link" to="/documents"><div className="attention-icon orange"><FileWarning size={18}/></div><div><strong>Documentos pendentes</strong><span>{s?.pendingDocs??'—'} solicitações aguardando envio ou correção</span></div></Link><Link className="attention-item attention-link" to="/tasks"><div className="attention-icon orange"><Clock3 size={18}/></div><div><strong>Tarefas atrasadas</strong><span>{s?.overdueTasks??'—'} atividades vencidas</span></div></Link><Link className="attention-item attention-link" to="/calendar"><div className="attention-icon green"><CalendarClock size={18}/></div><div><strong>Agenda</strong><span>Consulte compromissos e prazos cadastrados</span></div></Link><div className="notice-box">Valores e prazos são controles internos e devem ser conferidos pelos responsáveis.</div></section></div>
   <section className="panel section-gap"><div className="panel-heading"><div><h2>Atividades recentes</h2><p>Registro das principais ações no ambiente</p></div><Activity size={19} className="muted-icon"/></div>{data?.activities?.length?data.activities.map(item=><div className="activity-row" key={item.id}><div className="activity-dot"><CheckCircle2 size={14}/></div><div><strong>{actionLabel(item.action)}</strong><span>{item.user?.name||'Sistema'} · {item.entityType}</span></div><small>{new Date(item.createdAt).toLocaleString('pt-BR')}</small></div>):<EmptyState title="Sem atividades registradas" description="As ações importantes da equipe aparecerão aqui."/>}</section>
 </>;
}
