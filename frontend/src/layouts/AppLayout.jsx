import { useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import { LayoutDashboard, Users, MapPinned, FolderKanban, BriefcaseBusiness, CheckSquare, LogOut, Menu, X, Building2, Files, CalendarDays, Wallet, BarChart3, UserCog, Bell, Settings2, ShieldCheck, FileText, Settings, History, Zap, MessageSquareText } from 'lucide-react';

const navigation = [
  { to: '/', label: 'Visão geral', icon: LayoutDashboard, end: true, group: 'ESCRITÓRIO' },
  { to: '/clients', label: 'Clientes', icon: Users },
  { to: '/properties', label: 'Imóveis', icon: MapPinned },
  { to: '/services', label: 'Modelos de serviços', icon: BriefcaseBusiness },
  { to: '/cases', label: 'Procedimentos', icon: FolderKanban },
  { to: '/documents', label: 'Documentos', icon: Files },
  { to: '/document-templates', label: 'Modelos de documentos', icon: FileText },
  { to: '/tasks', label: 'Tarefas', icon: CheckSquare, group: 'ORGANIZAÇÃO' },
  { to: '/calendar', label: 'Agenda e prazos', icon: CalendarDays },
  { to: '/finance', label: 'Financeiro', icon: Wallet, permission: 'finance.read', roles: ['OWNER', 'ADMIN', 'FINANCE'] },
  { to: '/reports', label: 'Relatórios', icon: BarChart3, permission: 'reports.read', roles: ['OWNER', 'ADMIN', 'FINANCE'] },
  { to: '/notifications', label: 'Notificações', icon: Bell },
  { to: '/portal-requests', label: 'Atendimento do portal', icon: MessageSquareText, permission: 'portal.requests.read', roles: ['OWNER', 'ADMIN', 'LAWYER'] },
  { to: '/team', label: 'Equipe e permissões', icon: UserCog, group: 'ADMINISTRAÇÃO', permission: 'team.read', roles: ['OWNER', 'ADMIN'] },
  { to: '/automations', label: 'Automações', icon: Zap, permission: 'automations.read', roles: ['OWNER', 'ADMIN'] },
  { to: '/integrations', label: 'Integrações', icon: Settings2, roles: ['OWNER', 'ADMIN'] },
  { to: '/audit', label: 'Histórico de atividades', icon: History, permission: 'audit.read', roles: ['OWNER', 'ADMIN'] },
  { to: '/settings', label: 'Dados do escritório', icon: Settings, permission: 'settings.manage', roles: ['OWNER', 'ADMIN'] },
];

export default function AppLayout({ session, onLogout, children }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const navigate = useNavigate();
  async function logout() { try { await api.post('/auth/logout'); } finally { onLogout(); navigate('/login'); } }
  useEffect(() => { api.get('/notifications').then(({ data }) => setUnread(data.unread || 0)).catch(() => {}); }, []);
  const role = session?.user?.role;
  const permissions = session?.user?.permissions || {};
  const visibleNavigation = navigation.filter(item => {
    const roleAllowed = item.roles?.includes(role) || ['OWNER', 'ADMIN'].includes(role);
    if (item.roles && !roleAllowed && !(item.permission && permissions[item.permission] === true)) return false;
    if (item.permission && !roleAllowed && permissions[item.permission] !== true) return false;
    return true;
  });
  const items = session?.user?.isPlatformAdmin ? [...visibleNavigation, { to: '/platform-admin', label: 'Administração SaaS', icon: ShieldCheck, group: 'PLATAFORMA' }] : visibleNavigation;
  let previousGroup = '';
  return (
    <div className="app-shell">
      {mobileOpen && <button className="mobile-scrim" aria-label="Fechar menu" onClick={() => setMobileOpen(false)} />}
      <aside className={`sidebar ${mobileOpen ? 'sidebar-open' : ''}`}>
        <div className="sidebar-brand"><div className="brand-mark">IG</div><div><strong>ImobGestor</strong><small>Gestão imobiliária</small></div><button className="icon-button mobile-close" onClick={() => setMobileOpen(false)} aria-label="Fechar menu"><X size={19} /></button></div>
        <div className="office-switcher"><Building2 size={17} /><span>{session?.tenant?.name || 'Meu escritório'}</span></div>
        <nav className="side-nav">
          {items.map(item => { const Icon = item.icon; const showGroup = item.group && item.group !== previousGroup; if (item.group) previousGroup = item.group; return <div key={item.to}>{showGroup && <div className="nav-label">{item.group}</div>}<NavLink to={item.to} end={item.end} onClick={() => setMobileOpen(false)} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}><Icon size={18} /><span>{item.label}</span>{item.to==='/notifications'&&unread>0&&<small className="nav-count">{unread>9?'9+':unread}</small>}</NavLink></div>; })}
        </nav>
        <div className="sidebar-bottom"><div className="user-mini"><div className="avatar">{session?.user?.name?.slice(0, 1)?.toUpperCase() || 'U'}</div><div className="user-mini-text"><strong>{session?.user?.name}</strong><small>{session?.user?.role || 'Usuário'}</small></div></div><button className="logout-button" onClick={logout}><LogOut size={17} /> Sair da conta</button></div>
      </aside>
      <main className="main-area"><header className="topbar"><button className="icon-button mobile-menu" onClick={() => setMobileOpen(true)} aria-label="Abrir menu"><Menu size={21} /></button><div className="breadcrumb">ImobGestor <span>/</span> <strong>{session?.tenant?.name || 'Área de trabalho'}</strong></div><div className="topbar-user"><span>{session?.tenant?.name}</span><button className="topbar-bell" onClick={()=>navigate('/notifications')} aria-label="Notificações"><Bell size={18}/>{unread>0&&<i/>}</button><div className="avatar">{session?.user?.name?.slice(0, 1)?.toUpperCase() || 'U'}</div></div></header><div className="page-content">{children}</div></main>
    </div>
  );
}
