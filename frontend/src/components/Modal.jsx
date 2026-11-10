import { X } from 'lucide-react';
export default function Modal({ title, onClose, children, wide = false }) {
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><section className={`modal-card ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true"><header className="modal-header"><h2>{title}</h2><button className="icon-button" onClick={onClose} aria-label="Fechar"><X size={19}/></button></header><div className="modal-body">{children}</div></section></div>;
}
