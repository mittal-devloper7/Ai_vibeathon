import React, { useState, useEffect } from 'react';
import {
  Activity,
  Radio,
  FlaskConical,
  CheckCircle2,
  BookOpen,
  Key,
  ShieldCheck,
  Server,
  Database,
  RefreshCw,
  Check,
  Menu,
  X,
  ExternalLink,
} from 'lucide-react';
import {
  api,
  getStoredApiUrl,
  setStoredApiUrl,
  getStoredApiKey,
  setStoredApiKey,
  DEFAULT_API_KEY,
  DEFAULT_API_URL,
} from '../api/client';
import { HealthCheckResponse } from '../api/types';
import { useToast } from '../context/ToastContext';

export type TabType = 'overview' | 'endpoints' | 'lab' | 'deliveries' | 'guide';

interface HeaderProps {
  activeTab: TabType;
  setActiveTab: (tab: TabType) => void;
}

export const Header: React.FC<HeaderProps> = ({ activeTab, setActiveTab }) => {
  const toast = useToast();
  const [apiUrl, setApiUrl] = useState(getStoredApiUrl());
  const [apiKey, setApiKey] = useState(getStoredApiKey());
  const [showConfig, setShowConfig] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [health, setHealth] = useState<HealthCheckResponse | null>(null);
  const [isHealthLoading, setIsHealthLoading] = useState(false);
  const [isSaved, setIsSaved] = useState(false);

  const checkHealthStatus = async () => {
    setIsHealthLoading(true);
    try {
      const res = await api.checkHealth();
      setHealth(res);
    } catch {
      setHealth(null);
    } finally {
      setIsHealthLoading(false);
    }
  };

  useEffect(() => {
    checkHealthStatus();
    const interval = setInterval(checkHealthStatus, 15000);
    return () => clearInterval(interval);
  }, [apiUrl]);

  const handleSaveConfig = (e: React.FormEvent) => {
    e.preventDefault();
    setStoredApiUrl(apiUrl);
    setStoredApiKey(apiKey);
    setIsSaved(true);
    toast.success('API configuration saved successfully', 'Configuration Updated');
    setTimeout(() => setIsSaved(false), 2000);
    checkHealthStatus();
  };

  const handleApplyPresetKey = () => {
    setApiKey(DEFAULT_API_KEY);
    setApiUrl(DEFAULT_API_URL);
    setStoredApiKey(DEFAULT_API_KEY);
    setStoredApiUrl(DEFAULT_API_URL);
    setIsSaved(true);
    toast.success('Seeded tenant credentials loaded', 'Tenant Connected');
    setTimeout(() => setIsSaved(false), 2000);
    checkHealthStatus();
  };

  const navItems: { id: TabType; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'overview', label: 'Overview', icon: Activity },
    { id: 'endpoints', label: 'Endpoints', icon: Radio },
    { id: 'lab', label: 'Event Lab', icon: FlaskConical },
    { id: 'deliveries', label: 'Deliveries', icon: CheckCircle2 },
    { id: 'guide', label: 'Guide', icon: BookOpen },
  ];

  const isPostgresUp = Boolean(health?.checks?.postgres || (health as any)?.services?.postgres === 'up');
  const isRedisUp = Boolean(health?.checks?.redis || (health as any)?.services?.redis === 'up');

  return (
    <header className="border-b border-white/[0.08] bg-forge-950/95 backdrop-blur-md sticky top-0 z-40 transition-colors">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Brand Mark & Title */}
          <div className="flex items-center space-x-3.5">
            <button
              onClick={() => setActiveTab('overview')}
              className="flex items-center space-x-3 text-left focus:outline-none group"
              title="HookForge Overview"
            >
              {/* Precision Geometric SVG Logo */}
              <div className="relative w-9 h-9 rounded-xl overflow-hidden shadow-glow-emerald border border-brand-500/30 flex items-center justify-center shrink-0 group-hover:border-brand-400 transition">
                <svg
                  className="w-full h-full"
                  viewBox="0 0 36 36"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <rect width="36" height="36" rx="10" fill="url(#hf-header-bg)" />
                  {/* Hexagonal nexus */}
                  <path
                    d="M18 7L28 12.8V23.2L18 29L8 23.2V12.8L18 7Z"
                    stroke="#34d399"
                    strokeWidth="1.2"
                    strokeLinejoin="round"
                    strokeDasharray="2 2"
                    opacity="0.7"
                  />
                  {/* Interlocking delivery hooks */}
                  <path
                    d="M13 18C13 15.2386 15.2386 13 18 13H22M23 18C23 20.7614 20.7614 23 18 23H14"
                    stroke="#10b981"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                  />
                  {/* Relay nodes */}
                  <circle cx="22" cy="13" r="2.2" fill="#34d399" />
                  <circle cx="14" cy="23" r="2.2" fill="#34d399" />
                  {/* Pulse core */}
                  <circle cx="18" cy="18" r="1.6" fill="#ffffff" />
                  <defs>
                    <linearGradient
                      id="hf-header-bg"
                      x1="0"
                      y1="0"
                      x2="36"
                      y2="36"
                      gradientUnits="userSpaceOnUse"
                    >
                      <stop stopColor="#064e3b" />
                      <stop offset="0.6" stopColor="#0a2a22" />
                      <stop offset="1" stopColor="#06080d" />
                    </linearGradient>
                  </defs>
                </svg>
              </div>

              <div>
                <div className="flex items-center space-x-2">
                  <span className="font-bold text-base text-slate-100 tracking-tight group-hover:text-white transition">
                    HookForge
                  </span>
                  <span className="px-1.5 py-0.5 text-[10px] font-mono font-medium bg-brand-500/10 text-brand-300 rounded border border-brand-500/25">
                    Engine v1.0
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 hidden sm:block leading-tight">
                  Fault-Tolerant Webhook Delivery & Reliability Monolith
                </p>
              </div>
            </button>
          </div>

          {/* Desktop Navigation Tabs (5 Tabs) */}
          <nav className="hidden md:flex items-center space-x-1 bg-forge-900/90 p-1 rounded-xl border border-white/[0.08] shadow-inner">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-150 ${
                    isActive
                      ? 'bg-forge-800 text-brand-300 border border-brand-500/30 shadow-sm'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-forge-850/60'
                  }`}
                >
                  <Icon
                    className={`w-3.5 h-3.5 ${
                      isActive ? 'text-brand-400' : 'text-slate-500'
                    }`}
                  />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>

          {/* Right Status & Config Controls */}
          <div className="flex items-center space-x-2.5">
            {/* Live PG & Redis Readiness Monitor */}
            <div
              className="hidden lg:flex items-center space-x-2.5 bg-forge-900/80 px-3 py-1.5 rounded-lg border border-white/[0.08] text-xs font-mono"
              title={`Readiness: ${health?.status || 'checking'} (Postgres: ${isPostgresUp ? 'UP' : 'DOWN'}, Redis: ${isRedisUp ? 'UP' : 'DOWN'})`}
            >
              <div className="flex items-center space-x-1.5">
                <Database className="w-3.5 h-3.5 text-slate-400" />
                <span
                  className={`w-2 h-2 rounded-full ${
                    isPostgresUp ? 'bg-emerald-400 animate-pulse' : 'bg-rose-500'
                  }`}
                />
                <span className="text-slate-300 text-[11px]">PG</span>
              </div>
              <span className="text-slate-700">|</span>
              <div className="flex items-center space-x-1.5">
                <Server className="w-3.5 h-3.5 text-slate-400" />
                <span
                  className={`w-2 h-2 rounded-full ${
                    isRedisUp ? 'bg-emerald-400 animate-pulse' : 'bg-rose-500'
                  }`}
                />
                <span className="text-slate-300 text-[11px]">Redis</span>
              </div>
            </div>

            {/* Auth Drawer Toggle Button */}
            <button
              onClick={() => setShowConfig(!showConfig)}
              className={`px-2.5 py-1.5 rounded-lg border text-xs font-mono flex items-center space-x-1.5 transition ${
                showConfig
                  ? 'border-brand-500/50 bg-brand-500/10 text-brand-300'
                  : 'border-white/[0.08] bg-forge-900 hover:bg-forge-850 text-slate-300'
              }`}
              title="Configure API Base URL & Tenant API Key"
            >
              <Key className="w-3.5 h-3.5 text-brand-400 shrink-0" />
              <span className="hidden sm:inline text-[11px]">
                {apiKey ? `${apiKey.substring(0, 11)}…` : 'Set Key'}
              </span>
            </button>

            {/* Mobile Menu Button */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden p-2 rounded-lg bg-forge-900 border border-white/[0.08] text-slate-300 hover:text-white"
              aria-label="Toggle Navigation Menu"
            >
              {mobileMenuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Navigation Drawer */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t border-white/[0.08] bg-forge-900/98 px-4 py-3 space-y-2 animate-in slide-in-from-top-2 duration-150 max-h-[80vh] overflow-y-auto">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 pb-2">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    setActiveTab(item.id);
                    setMobileMenuOpen(false);
                  }}
                  className={`flex items-center space-x-2 px-3 py-2 rounded-lg text-xs font-medium transition ${
                    isActive
                      ? 'bg-forge-800 text-brand-300 border border-brand-500/30 font-semibold'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-forge-850'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </div>

          <div className="pt-2 border-t border-white/[0.06] flex items-center justify-between text-xs font-mono text-slate-400">
            <span className="flex items-center space-x-1.5">
              <span
                className={`w-2 h-2 rounded-full ${
                  isPostgresUp ? 'bg-emerald-400' : 'bg-rose-500'
                }`}
              />
              <span>PG 18</span>
              <span className="text-slate-600">/</span>
              <span
                className={`w-2 h-2 rounded-full ${
                  isRedisUp ? 'bg-emerald-400' : 'bg-rose-500'
                }`}
              />
              <span>Redis 8</span>
            </span>

            <button
              onClick={() => {
                setShowConfig(true);
                setMobileMenuOpen(false);
              }}
              className="text-[11px] text-brand-400 hover:underline flex items-center space-x-1"
            >
              <Key className="w-3 h-3" />
              <span>Config API</span>
            </button>
          </div>
        </div>
      )}

      {/* API Configuration Drawer */}
      {showConfig && (
        <div className="border-t border-white/[0.08] bg-forge-900/95 backdrop-blur-md p-4 sm:p-5 shadow-2xl animate-in slide-in-from-top-2 duration-150 max-h-[85vh] overflow-y-auto">
          <div className="max-w-4xl mx-auto">
            <form onSubmit={handleSaveConfig} className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2.5">
                  <div className="w-7 h-7 rounded-lg bg-brand-500/10 border border-brand-500/20 flex items-center justify-center text-brand-400">
                    <ShieldCheck className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold text-slate-100 tracking-tight">
                      API Connection & Tenant Authentication
                    </h4>
                    <p className="text-[11px] text-slate-400">
                      Configure your backend endpoint and tenant bearer credentials
                    </p>
                  </div>
                </div>

                <div className="flex items-center space-x-2">
                  <button
                    type="button"
                    onClick={handleApplyPresetKey}
                    className="text-xs px-2.5 py-1.5 rounded-lg bg-forge-800 hover:bg-forge-750 text-brand-300 border border-brand-500/30 transition flex items-center space-x-1.5"
                  >
                    <span>Load Seeded Tenant Key</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowConfig(false)}
                    className="p-1 rounded text-slate-400 hover:text-slate-200"
                    aria-label="Close API configuration"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Backend API Base URL
                  </label>
                  <input
                    type="text"
                    value={apiUrl}
                    onChange={(e) => setApiUrl(e.target.value)}
                    placeholder="http://localhost:3000/api/v1"
                    className="w-full px-3 py-2 text-xs font-mono bg-forge-950 border border-white/[0.1] rounded-lg text-slate-100 placeholder-slate-500 focus:outline-none focus:border-brand-500"
                  />
                  <span className="text-[10px] text-slate-400 mt-1 block">
                    Default: http://localhost:3000/api/v1
                  </span>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    Tenant Bearer API Key
                  </label>
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="hf_live_..."
                    className="w-full px-3 py-2 text-xs font-mono bg-forge-950 border border-white/[0.1] rounded-lg text-slate-100 placeholder-slate-500 focus:outline-none focus:border-brand-500"
                  />
                  <span className="text-[10px] text-slate-400 mt-1 block">
                    Seeded Key: hf_live_demo1234567890abcdef12345678
                  </span>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pt-3 border-t border-white/[0.06]">
                <div className="flex items-center space-x-2.5 text-xs text-slate-400">
                  <span>Backend status:</span>
                  {isHealthLoading ? (
                    <span className="text-slate-400 flex items-center space-x-1">
                      <RefreshCw className="w-3 h-3 animate-spin" />
                      <span>Probing /health/ready...</span>
                    </span>
                  ) : health?.status === 'ready' || health?.status === 'ok' ? (
                    <span className="text-emerald-400 font-medium flex items-center space-x-1">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Ready (PostgreSQL 18 & Redis 8 healthy)</span>
                    </span>
                  ) : (
                    <span className="text-rose-400 font-medium flex items-center space-x-1">
                      <X className="w-3.5 h-3.5" />
                      <span>Unreachable (ensure backend dev server is running on port 3000)</span>
                    </span>
                  )}
                </div>

                <div className="flex items-center space-x-2 self-end sm:self-auto">
                  <button
                    type="button"
                    onClick={checkHealthStatus}
                    className="px-3 py-1.5 text-xs font-medium bg-forge-800 hover:bg-forge-750 text-slate-300 rounded-lg border border-white/[0.08] transition flex items-center space-x-1"
                  >
                    <RefreshCw className={`w-3 h-3 ${isHealthLoading ? 'animate-spin' : ''}`} />
                    <span>Ping</span>
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-1.5 text-xs font-semibold bg-brand-600 hover:bg-brand-500 text-white rounded-lg transition shadow-md flex items-center space-x-1.5"
                  >
                    {isSaved ? (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        <span>Saved</span>
                      </>
                    ) : (
                      <span>Save Settings</span>
                    )}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </header>
  );
};
