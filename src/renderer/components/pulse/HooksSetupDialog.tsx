import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Cable, X } from 'lucide-react';
import { CodexHooksCard } from './CodexHooksCard';

export function HooksSetupDialog({ onClose, onConfiguredChange }: {
  onClose: () => void;
  onConfiguredChange: (configured: boolean) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    const element = dialog.current;
    element?.showModal();
    return () => {
      element?.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);

  return createPortal(<dialog ref={dialog} className="nexo-hooks-dialog nexo-app--workspace no-drag" aria-labelledby="hooks-setup-title"
    onCancel={event => { event.preventDefault(); onClose(); }}>
    <header className="nexo-hooks-dialog-header">
      <div><h2 id="hooks-setup-title"><Cable size={24} strokeWidth={1.6} />连接必备</h2><p>一次配置，联动桌面悬浮窗与手环桌搭。</p></div>
      <button type="button" className="nexo-hooks-close" aria-label="关闭连接必备" onClick={onClose}><X size={23} strokeWidth={1.6} /></button>
    </header>
    <CodexHooksCard onConfiguredChange={onConfiguredChange} />
  </dialog>, document.body);
}
