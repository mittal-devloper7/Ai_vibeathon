import React, { useState } from 'react';
import { Header, TabType } from './components/Header';
import { OverviewPage } from './pages/OverviewPage';
import { EndpointsPage } from './pages/EndpointsPage';
import { EventLabPage } from './pages/EventLabPage';
import { DeliveriesPage } from './pages/DeliveriesPage';
import { GuidePage } from './pages/GuidePage';
import { ToastProvider } from './context/ToastContext';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabType>('overview');

  return (
    <ToastProvider>
      <div className="min-h-screen bg-forge-950 flex flex-col font-sans selection:bg-brand-500/30 selection:text-brand-200 overflow-x-hidden w-full max-w-full">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:px-4 focus:py-2 focus:rounded-lg focus:bg-brand-600 focus:text-white focus:text-xs focus:font-semibold focus:shadow-lg"
        >
          Skip to main content
        </a>

        <Header activeTab={activeTab} setActiveTab={setActiveTab} />

        <main
          id="main-content"
          tabIndex={-1}
          aria-label="HookForge workspace"
          className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 focus:outline-none"
        >
          {activeTab === 'overview' && <OverviewPage onNavigate={setActiveTab} />}
          {activeTab === 'endpoints' && <EndpointsPage />}
          {activeTab === 'lab' && <EventLabPage />}
          {activeTab === 'deliveries' && <DeliveriesPage />}
          {activeTab === 'guide' && <GuidePage onNavigate={setActiveTab} />}
        </main>

        <footer className="border-t border-white/[0.08] bg-forge-950/80 py-6 text-center text-xs text-slate-400">
          <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="flex items-center space-x-2">
              <span className="font-semibold text-slate-200">HookForge</span>
              <span className="text-slate-600" aria-hidden="true">—</span>
              <span className="text-slate-400">High-Throughput Webhook Delivery & Reliability Monolith</span>
            </div>
            <div className="text-[11px] text-slate-400 font-mono">
              PostgreSQL 18 • Redis 8 • BullMQ • Undici • Google Gemini 3.5 • React 18
            </div>
          </div>
        </footer>
      </div>
    </ToastProvider>
  );
};

export default App;
