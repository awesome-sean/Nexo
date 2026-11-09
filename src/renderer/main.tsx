import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';

async function mount() {
  const root = document.getElementById('root');
  if (!root) return;
  const floating = new URLSearchParams(location.search).get('screen') === 'minibar';
  const Component = floating
    ? (await import('./components/minibar/MiniBar')).MiniBar
    : (await import('./App')).default;
  ReactDOM.createRoot(root).render(<React.StrictMode><Component /></React.StrictMode>);
}

void mount();
