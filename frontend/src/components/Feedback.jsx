export function ErrorMessage({ children }) {
  if (!children) return null;
  return <div className="alert alert-error" role="alert">{children}</div>;
}
export function SuccessMessage({ children }) {
  if (!children) return null;
  return <div className="alert alert-success" role="status">{children}</div>;
}
export function EmptyState({ title = 'Nenhum registro encontrado', description = 'Quando houver informações, elas aparecerão aqui.' }) {
  return <div className="empty-state"><div className="empty-icon">✦</div><strong>{title}</strong><span>{description}</span></div>;
}
