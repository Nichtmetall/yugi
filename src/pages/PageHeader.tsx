import type { ReactNode } from 'react';
import { IconBack, IconSettings } from '../components/Icons';
import { navigate } from '../state/ui';

interface Props {
  title: ReactNode;
  sub?: ReactNode;
  back?: string;
  actions?: ReactNode;
}

export function PageHeader({ title, sub, back, actions }: Props) {
  return (
    <header className="page-head">
      {back && (
        <button className="icon-btn" onClick={() => navigate(back)} aria-label="Zurück">
          <IconBack />
        </button>
      )}
      <div className="page-title">
        <h1>{title}</h1>
        {sub && <p className="page-sub">{sub}</p>}
      </div>
      <div className="page-actions">
        {actions}
        {!back && (
          <button className="icon-btn" onClick={() => navigate('settings')} aria-label="Einstellungen">
            <IconSettings />
          </button>
        )}
      </div>
    </header>
  );
}
