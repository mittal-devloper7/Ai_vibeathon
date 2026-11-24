import React, { useState, useEffect, useMemo } from 'react';
import {
  Plus,
  RefreshCw,
  Key,
  ExternalLink,
  AlertCircle,
  Check,
  Copy,
  Sparkles,
  ShieldCheck,
  ShieldAlert,
  Sliders,
  Clock,
  Activity,
  Power,
  ChevronDown,
  ChevronRight,
  Search,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Radio,
  Zap,
  Tag,
  X,
} from 'lucide-react';
import { api } from '../api/client';
import { Endpoint, CreateEndpointInput, EndpointHealthReport } from '../api/types';
import { useToast } from '../context/ToastContext';
import { ConfirmModal } from '../components/ConfirmModal';

const PRESET_EVENTS = [
  'order.created',
  'payment.captured',
  'payment.failed',
  'invoice.paid',
];

const PRESET_URLS = [
  { label: 'Success (200)', url: 'http://localhost:4000/scenario/success' },
  { label: 'Rate Limited (429)', url: 'http://localhost:4000/scenario/retryable' },
  { label: 'Server Error (500)', url: 'http://localhost:4000/scenario/server-error' },
  { label: 'Webhook.site (Echo)', url: 'https://webhook.site/placeholder' },
];

export const EndpointsPage: React.FC = () => {
  const toast = useToast();
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'disabled'>('all');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // Secret Rotation Confirmation Modal State
  const [rotatingEndpoint, setRotatingEndpoint] = useState<Endpoint | null>(null);
  const [isRotating, setIsRotating] = useState(false);

  // Create Modal State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [formData, setFormData] = useState<CreateEndpointInput>({
    name: '',
    url: 'http://localhost:4000/scenario/success',
    description: '',
    subscriptions: ['order.created', 'payment.captured'],
    rate_limit_per_minute: 600,
    policy: {
      max_attempts: 5,
      attempt_timeout_ms: 5000,
      max_in_flight: 5,
    },
  });
  const [customTagInput, setCustomTagInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Secret Reveal Modal State (one-time upon creation or rotation)
  const [revealedSecret, setRevealedSecret] = useState<{
    endpointName: string;
    secret: string;
    isRotation: boolean;
  } | null>(null);
  const [secretCopied, setSecretCopied] = useState(false);
  const [copiedUrlId, setCopiedUrlId] = useState<string | null>(null);

  // Gemini Health Report Modal State
  const [selectedEndpointForHealth, setSelectedEndpointForHealth] = useState<Endpoint | null>(null);
  const [healthReport, setHealthReport] = useState<EndpointHealthReport | null>(null);
  const [healthReportLoading, setHealthReportLoading] = useState(false);
  const [healthReportError, setHealthReportError] = useState<string | null>(null);

  const fetchEndpoints = async () => {
    try {
      setLoading(true);
      const data = await api.listEndpoints();
      setEndpoints(Array.isArray(data) ? data : []);
      setError(null);
    } catch (err: any) {
      setEndpoints([]);
      setError(err?.message || 'Failed to load endpoints');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEndpoints();
  }, []);

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCopyUrl = (id: string, url: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(url);
    setCopiedUrlId(id);
    toast.success('Endpoint URL copied to clipboard');
    setTimeout(() => setCopiedUrlId(null), 2000);
  };

  const handleTogglePresetTag = (tag: string) => {
    setFormData((prev) => {
      const exists = prev.subscriptions.includes(tag);
      const updated = exists
        ? prev.subscriptions.filter((t) => t !== tag)
        : [...prev.subscriptions, tag];
      return { ...prev, subscriptions: updated };
    });
  };

  const handleAddCustomTag = (e: React.KeyboardEvent | React.MouseEvent) => {
    if ('key' in e && e.key !== 'Enter') return;
    e.preventDefault();
    const tag = customTagInput.trim().toLowerCase();
    if (!tag) return;
    if (!formData.subscriptions.includes(tag)) {
      setFormData((prev) => ({
        ...prev,
        subscriptions: [...prev.subscriptions, tag],
      }));
    }
    setCustomTagInput('');
  };

  const handleRemoveTag = (tag: string) => {
    setFormData((prev) => ({
      ...prev,
      subscriptions: prev.subscriptions.filter((t) => t !== tag),
    }));
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim() || !formData.url.trim()) {
      toast.warning('Name and Destination URL are required', 'Validation Error');
      return;
    }
    if (formData.subscriptions.length === 0) {
      toast.warning('At least one event subscription is required', 'Validation Error');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await api.createEndpoint({
        name: formData.name.trim(),
        url: formData.url.trim(),
        description: formData.description?.trim() || undefined,
        subscriptions: formData.subscriptions,
        rate_limit_per_minute: Number(formData.rate_limit_per_minute) || 600,
        policy: {
          max_attempts: Number(formData.policy?.max_attempts) || 5,
          attempt_timeout_ms: Number(formData.policy?.attempt_timeout_ms) || 5000,
          max_in_flight: Number(formData.policy?.max_in_flight) || 5,
        },
      });

      setShowCreateModal(false);
      fetchEndpoints();
      toast.success(`Endpoint "${res.name}" registered successfully`, 'Endpoint Created');

      if (res.signing_secret) {
        setRevealedSecret({
          endpointName: res.name,
          secret: res.signing_secret,
          isRotation: false,
        });
      }
    } catch (err: any) {
      toast.error(err?.message || 'Failed to create endpoint', 'Registration Failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRotateSecret = (endpoint: Endpoint) => {
    setRotatingEndpoint(endpoint);
  };

  const handleConfirmRotateSecret = async () => {
    if (!rotatingEndpoint) return;
    setIsRotating(true);
    try {
      const res = await api.rotateSecret(rotatingEndpoint.id);
      setRevealedSecret({
        endpointName: rotatingEndpoint.name,
        secret: res.signing_secret,
        isRotation: true,
      });
      toast.success(`Signing secret rotated for "${rotatingEndpoint.name}"`, 'Secret Rotated');
      setRotatingEndpoint(null);
    } catch (err: any) {
      toast.error(err?.message || 'Unknown error', 'Secret Rotation Failed');
    } finally {
      setIsRotating(false);
    }
  };

  const handleToggleStatus = async (endpoint: Endpoint) => {
    const nextStatus = endpoint.status === 'active' ? 'disabled' : 'active';
    try {
      await api.updateEndpoint(endpoint.id, { status: nextStatus });
      setEndpoints((prev) =>
        (Array.isArray(prev) ? prev : []).map((ep) =>
          ep.id === endpoint.id ? { ...ep, status: nextStatus } : ep
        )
      );
      toast.success(`Endpoint "${endpoint.name}" is now ${nextStatus}`);
    } catch (err: any) {
      toast.error(err?.message || 'Unknown error', 'Failed to update status');
    }
  };

  const handleOpenHealthReport = async (endpoint: Endpoint, forceRefresh = false) => {
    setSelectedEndpointForHealth(endpoint);
    setHealthReportLoading(true);
    setHealthReportError(null);

    try {
      const report = await api.getEndpointHealthReport(endpoint.id, forceRefresh);
      setHealthReport(report);
    } catch (err: any) {
      setHealthReportError(err?.message || 'Failed to load Gemini health assessment');
    } finally {
      setHealthReportLoading(false);
    }
  };

  const filteredEndpoints = useMemo(() => {
    return endpoints.filter((ep) => {
      const matchesSearch =
        searchQuery === '' ||
        ep.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        ep.url.toLowerCase().includes(searchQuery.toLowerCase()) ||
        ep.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
        ep.subscriptions?.some((s) => s.toLowerCase().includes(searchQuery.toLowerCase()));

      const matchesStatus =
        statusFilter === 'all' || ep.status === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [endpoints, searchQuery, statusFilter]);

  const activeCount = endpoints.filter((e) => e.status === 'active').length;

  return (
    <div className="space-y-6 animate-in fade-in duration-150">
      {/* Header & Primary Actions */}
      <div className="card-surface p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2.5">
            <h1 className="text-lg sm:text-xl font-bold text-slate-100 tracking-tight">
              Webhook Endpoints
            </h1>
            <span className="px-2 py-0.5 rounded-full bg-forge-800 text-slate-300 font-mono text-[11px] border border-white/[0.08]">
              <span className="text-emerald-400 font-bold">{activeCount}</span> / {endpoints.length} Active
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Manage webhook destinations, event subscriptions, concurrency leases, and signing keys.
          </p>
        </div>

        <div className="flex items-center space-x-2 w-full sm:w-auto">
          <button
            onClick={fetchEndpoints}
            disabled={loading}
            className="p-2 rounded-lg bg-forge-800 hover:bg-forge-750 text-slate-300 border border-white/[0.08] transition disabled:opacity-50"
            title="Refresh endpoints"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>

          <button
            onClick={() => setShowCreateModal(true)}
            className="flex-1 sm:flex-none flex items-center justify-center space-x-1.5 px-3.5 py-2 rounded-lg bg-brand-600 hover:bg-brand-500 text-white font-semibold text-xs transition shadow-md shadow-brand-950/40"
          >
            <Plus className="w-4 h-4" />
            <span>Register Endpoint</span>
          </button>
        </div>
      </div>

      {/* Filter & Search Toolbar */}
      <div className="card-surface p-3 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 text-xs">
        <div className="relative flex-1">
          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by name, URL, ID, or subscription tag..."
            className="w-full pl-9 pr-3 py-1.5 bg-forge-950 border border-white/[0.08] rounded-lg text-slate-200 placeholder-slate-500 text-xs focus:outline-none focus:border-brand-500/60"
          />
        </div>

        <div className="flex items-center space-x-1.5 self-end sm:self-auto">
          <span className="text-[11px] text-slate-400 mr-1 hidden sm:inline">Status:</span>
          {(['all', 'active', 'disabled'] as const).map((status) => (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition capitalize ${
                statusFilter === status
                  ? 'bg-forge-800 text-brand-300 border border-brand-500/30'
                  : 'text-slate-400 hover:text-slate-200 bg-forge-950 border border-white/[0.06]'
              }`}
            >
              {status}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="bg-rose-950/40 border border-rose-800/60 p-4 rounded-xl text-xs text-rose-300 flex items-center space-x-3">
          <AlertCircle className="w-5 h-5 text-rose-400 shrink-0" />
          <div>{error}</div>
        </div>
      )}

      {/* Dense High-Craft Endpoints Table */}
      <div className="card-surface overflow-hidden border border-white/[0.08]">
        {filteredEndpoints.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs min-w-[680px]">
              <thead className="bg-forge-950 text-slate-400 uppercase tracking-wider text-[10px] border-b border-white/[0.06]">
                <tr>
                  <th className="w-8 px-3 py-3"></th>
                  <th className="px-4 py-3">Endpoint & Target</th>
                  <th className="px-4 py-3">Subscriptions</th>
                  <th className="px-3 py-3">Circuit</th>
                  <th className="px-3 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {filteredEndpoints.map((ep) => {
                  const isExpanded = expandedIds.has(ep.id);
                  const isCopied = copiedUrlId === ep.id;
                  const cbState = (ep.circuit_breaker_state || 'closed').toLowerCase();

                  return (
                    <React.Fragment key={ep.id}>
                      <tr
                        onClick={() => toggleExpand(ep.id)}
                        className={`hover:bg-forge-800/40 transition cursor-pointer ${
                          isExpanded ? 'bg-forge-850/50' : ''
                        }`}
                      >
                        {/* Expand Chevron */}
                        <td className="px-3 py-3.5 text-slate-500">
                          {isExpanded ? (
                            <ChevronDown className="w-4 h-4 text-brand-400" />
                          ) : (
                            <ChevronRight className="w-4 h-4" />
                          )}
                        </td>

                        {/* Name, ID & Destination URL */}
                        <td className="px-4 py-3.5 max-w-sm">
                          <div className="flex items-center space-x-2">
                            <span className="font-semibold text-slate-100 text-xs tracking-tight">
                              {ep.name}
                            </span>
                            <span className="font-mono text-[10px] text-slate-500 bg-forge-950 px-1.5 py-0.2 rounded border border-white/[0.06]">
                              {ep.id.substring(0, 12)}…
                            </span>
                          </div>

                          <div className="flex items-center space-x-1.5 mt-1 font-mono text-[11px] text-slate-300">
                            <span className="text-slate-500">→</span>
                            <span className="truncate max-w-[280px]" title={ep.url}>
                              {ep.url}
                            </span>
                            <button
                              onClick={(e) => handleCopyUrl(ep.id, ep.url, e)}
                              className="text-slate-500 hover:text-slate-200 p-0.5 rounded transition"
                              title="Copy URL"
                            >
                              {isCopied ? (
                                <Check className="w-3 h-3 text-emerald-400" />
                              ) : (
                                <Copy className="w-3 h-3" />
                              )}
                            </button>
                          </div>
                        </td>

                        {/* Subscriptions */}
                        <td className="px-4 py-3.5">
                          <div className="flex flex-wrap gap-1 max-w-xs">
                            {Array.isArray(ep.subscriptions) && ep.subscriptions.length > 0 ? (
                              ep.subscriptions.map((sub) => (
                                <span
                                  key={sub}
                                  className="px-2 py-0.5 rounded text-[10px] font-mono bg-forge-950 text-slate-300 border border-white/[0.08]"
                                >
                                  {sub}
                                </span>
                              ))
                            ) : (
                              <span className="text-[11px] text-slate-500 italic">No events subscribed</span>
                            )}
                          </div>
                        </td>

                        {/* Circuit Breaker Status */}
                        <td className="px-3 py-3.5">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase ${
                              cbState === 'closed'
                                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                : cbState === 'open'
                                ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                                : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                            }`}
                          >
                            {cbState}
                          </span>
                        </td>

                        {/* Active / Disabled Status */}
                        <td className="px-3 py-3.5">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleToggleStatus(ep);
                            }}
                            className={`inline-flex items-center space-x-1.5 px-2 py-1 rounded-md text-[11px] font-medium transition border ${
                              ep.status === 'active'
                                ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/20'
                                : 'bg-forge-950 text-slate-400 border-white/[0.08] hover:text-slate-200'
                            }`}
                            title={`Click to ${ep.status === 'active' ? 'pause' : 'activate'}`}
                          >
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${
                                ep.status === 'active' ? 'bg-emerald-400' : 'bg-slate-500'
                              }`}
                            />
                            <span className="capitalize">{ep.status}</span>
                          </button>
                        </td>

                        {/* Quick Action Icons */}
                        <td className="px-4 py-3.5 text-right">
                          <div
                            className="inline-flex items-center space-x-1"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {/* Gemini Health Report */}
                            <button
                              onClick={() => handleOpenHealthReport(ep)}
                              className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/20 border border-indigo-500/30 transition"
                              title="Gemini AI Health Assessment"
                            >
                              <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                            </button>

                            {/* Rotate Secret */}
                            <button
                              onClick={() => handleRotateSecret(ep)}
                              className="p-1.5 rounded-lg bg-forge-950 text-slate-400 hover:text-amber-300 hover:bg-forge-800 border border-white/[0.08] transition"
                              title="Rotate HMAC Signing Secret"
                            >
                              <Key className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>

                      {/* Expandable Policy & Telemetry Panel */}
                      {isExpanded && (
                        <tr className="bg-forge-950/70 border-b border-white/[0.06]">
                          <td colSpan={6} className="px-6 py-4">
                            <div className="space-y-3">
                              <div className="flex items-center justify-between">
                                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 flex items-center space-x-1.5">
                                  <Sliders className="w-3.5 h-3.5 text-brand-400" />
                                  <span>Delivery Policy & Concurrency Safeguards</span>
                                </span>

                                <span className="text-[11px] font-mono text-slate-500">
                                  Created {new Date(ep.created_at).toLocaleDateString()}
                                </span>
                              </div>

                              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
                                <div className="bg-forge-900 p-2.5 rounded-lg border border-white/[0.06]">
                                  <div className="text-[10px] text-slate-400 font-sans uppercase">
                                    Max Attempts
                                  </div>
                                  <div className="text-slate-100 font-bold text-sm mt-0.5">
                                    {ep.policy?.max_attempts ?? 5} retries
                                  </div>
                                  <div className="text-[10px] text-slate-400 font-sans mt-0.5">
                                    Full Jitter Backoff
                                  </div>
                                </div>

                                <div className="bg-forge-900 p-2.5 rounded-lg border border-white/[0.06]">
                                  <div className="text-[10px] text-slate-400 font-sans uppercase">
                                    Attempt Timeout
                                  </div>
                                  <div className="text-slate-100 font-bold text-sm mt-0.5">
                                    {ep.policy?.attempt_timeout_ms ?? 5000} ms
                                  </div>
                                  <div className="text-[10px] text-slate-400 font-sans mt-0.5">
                                    Per-request Undici limit
                                  </div>
                                </div>

                                <div className="bg-forge-900 p-2.5 rounded-lg border border-white/[0.06]">
                                  <div className="text-[10px] text-slate-400 font-sans uppercase">
                                    Max In-Flight
                                  </div>
                                  <div className="text-slate-100 font-bold text-sm mt-0.5">
                                    {ep.policy?.max_in_flight ?? 5} leases
                                  </div>
                                  <div className="text-[10px] text-slate-400 font-sans mt-0.5">
                                    Concurrency ceiling
                                  </div>
                                </div>

                                <div className="bg-forge-900 p-2.5 rounded-lg border border-white/[0.06]">
                                  <div className="text-[10px] text-slate-400 font-sans uppercase">
                                    Rate Limit
                                  </div>
                                  <div className="text-slate-100 font-bold text-sm mt-0.5">
                                    {ep.rate_limit_per_minute} / min
                                  </div>
                                  <div className="text-[10px] text-slate-400 font-sans mt-0.5">
                                    Redis token bucket
                                  </div>
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center py-12 px-4 space-y-3">
            <Radio className="w-8 h-8 text-slate-600 mx-auto" />
            <div className="font-semibold text-slate-300 text-sm">No Endpoints Found</div>
            <p className="text-xs text-slate-400 max-w-sm mx-auto">
              {searchQuery
                ? 'No webhook endpoints match your search criteria. Try a different query.'
                : 'No webhook endpoints registered yet. Register your first endpoint to start receiving events.'}
            </p>
            <button
              onClick={() => setShowCreateModal(true)}
              className="mt-2 inline-flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-500 text-white font-semibold text-xs shadow transition"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Register Endpoint</span>
            </button>
          </div>
        )}
      </div>

      {/* Register Endpoint Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="w-full max-w-xl rounded-2xl bg-forge-900 border border-white/[0.1] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="p-5 border-b border-white/[0.08] flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold text-slate-100 tracking-tight">
                  Register Webhook Destination
                </h3>
                <p className="text-xs text-slate-400">
                  Configure subscriber URL, event subscriptions, and backoff delivery policies.
                </p>
              </div>
              <button
                onClick={() => setShowCreateModal(false)}
                className="p-1 rounded text-slate-400 hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} className="p-5 space-y-4 overflow-y-auto flex-1">
              {/* Endpoint Name */}
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Endpoint Name *
                </label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g. Primary Billing Webhook"
                  className="w-full px-3 py-2 text-xs bg-forge-950 border border-white/[0.1] rounded-lg text-slate-100 focus:outline-none focus:border-brand-500"
                />
              </div>

              {/* Destination URL + Quick Presets */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-slate-300">
                    Destination URL *
                  </label>
                  <span className="text-[10px] text-slate-400">Must be reachable by HookForge worker</span>
                </div>
                <input
                  type="url"
                  required
                  value={formData.url}
                  onChange={(e) => setFormData({ ...formData, url: e.target.value })}
                  placeholder="https://api.yourdomain.com/webhooks"
                  className="w-full px-3 py-2 text-xs font-mono bg-forge-950 border border-white/[0.1] rounded-lg text-slate-100 focus:outline-none focus:border-brand-500"
                />

                {/* Preset URL Chips */}
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] text-slate-400 mr-1">Local simulator presets:</span>
                  {PRESET_URLS.map((preset) => (
                    <button
                      key={preset.url}
                      type="button"
                      onClick={() => setFormData({ ...formData, url: preset.url })}
                      className={`text-[10px] font-mono px-2 py-0.5 rounded border transition ${
                        formData.url === preset.url
                          ? 'bg-brand-500/20 text-brand-300 border-brand-500/40'
                          : 'bg-forge-950 text-slate-400 border-white/[0.06] hover:text-slate-200'
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Event Subscriptions Chips */}
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Subscribed Event Types *
                </label>

                {/* Active Tags */}
                <div className="flex flex-wrap items-center gap-1.5 p-2 bg-forge-950 border border-white/[0.08] rounded-lg min-h-[42px]">
                  {formData.subscriptions.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center space-x-1 px-2 py-0.5 rounded bg-brand-500/15 text-brand-300 border border-brand-500/30 text-xs font-mono"
                    >
                      <span>{tag}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveTag(tag)}
                        className="hover:text-rose-400 ml-0.5"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}

                  <div className="inline-flex items-center space-x-1 flex-1 min-w-[120px]">
                    <input
                      type="text"
                      value={customTagInput}
                      onChange={(e) => setCustomTagInput(e.target.value)}
                      onKeyDown={handleAddCustomTag}
                      placeholder="Add tag and press Enter..."
                      className="bg-transparent text-xs font-mono text-slate-200 placeholder-slate-500 focus:outline-none w-full px-1"
                    />
                  </div>
                </div>

                {/* Preset Chips */}
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] text-slate-400 mr-1">Quick presets:</span>
                  {PRESET_EVENTS.map((preset) => {
                    const isSelected = formData.subscriptions.includes(preset);
                    return (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => handleTogglePresetTag(preset)}
                        className={`text-[10px] font-mono px-2 py-0.5 rounded border transition ${
                          isSelected
                            ? 'bg-brand-500/20 text-brand-300 border-brand-500/40'
                            : 'bg-forge-950 text-slate-400 border-white/[0.06] hover:text-slate-200'
                        }`}
                      >
                        {isSelected ? '✓ ' : '+ '}
                        {preset}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Delivery Policy Configuration */}
              <div className="pt-2 border-t border-white/[0.06] space-y-2">
                <span className="text-xs font-semibold text-slate-200 uppercase tracking-wider block">
                  Delivery Policy & Limits
                </span>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">
                      Max Retry Attempts
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={15}
                      value={formData.policy?.max_attempts ?? 5}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          policy: {
                            ...formData.policy,
                            max_attempts: parseInt(e.target.value) || 5,
                          },
                        })
                      }
                      className="w-full px-2.5 py-1.5 text-xs font-mono bg-forge-950 border border-white/[0.1] rounded-lg text-slate-100"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">
                      Attempt Timeout (ms)
                    </label>
                    <input
                      type="number"
                      min={500}
                      max={30000}
                      step={500}
                      value={formData.policy?.attempt_timeout_ms ?? 5000}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          policy: {
                            ...formData.policy,
                            attempt_timeout_ms: parseInt(e.target.value) || 5000,
                          },
                        })
                      }
                      className="w-full px-2.5 py-1.5 text-xs font-mono bg-forge-950 border border-white/[0.1] rounded-lg text-slate-100"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">
                      Max In-Flight Concurrency
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={50}
                      value={formData.policy?.max_in_flight ?? 5}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          policy: {
                            ...formData.policy,
                            max_in_flight: parseInt(e.target.value) || 5,
                          },
                        })
                      }
                      className="w-full px-2.5 py-1.5 text-xs font-mono bg-forge-950 border border-white/[0.1] rounded-lg text-slate-100"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] text-slate-400 mb-1">
                      Rate Limit (req / min)
                    </label>
                    <input
                      type="number"
                      min={10}
                      max={60000}
                      value={formData.rate_limit_per_minute ?? 600}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          rate_limit_per_minute: parseInt(e.target.value) || 600,
                        })
                      }
                      className="w-full px-2.5 py-1.5 text-xs font-mono bg-forge-950 border border-white/[0.1] rounded-lg text-slate-100"
                    />
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end space-x-3 pt-3 border-t border-white/[0.06]">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-3.5 py-2 text-xs font-medium text-slate-300 hover:text-white bg-forge-800 rounded-lg transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 text-xs font-semibold bg-brand-600 hover:bg-brand-500 text-white rounded-lg transition shadow flex items-center space-x-1.5 disabled:opacity-50"
                >
                  {isSubmitting ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Registering...</span>
                    </>
                  ) : (
                    <span>Register Endpoint</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* One-Time Secret Reveal Modal */}
      {revealedSecret && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="w-full max-w-md rounded-2xl bg-forge-900 border border-brand-500/40 shadow-2xl p-6 space-y-4">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-xl bg-brand-500/10 border border-brand-500/25 flex items-center justify-center text-brand-400">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-slate-100 tracking-tight">
                  {revealedSecret.isRotation ? 'Secret Rotated Successfully' : 'Endpoint Registered'}
                </h3>
                <p className="text-xs text-slate-400">
                  {revealedSecret.endpointName}
                </p>
              </div>
            </div>

            <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-xs text-amber-200">
              <span className="font-bold">Important:</span> This HMAC signing secret will only be shown once. Downstream subscribers must use this secret to verify the <code className="font-mono text-amber-300">X-HookForge-Signature</code> header.
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-medium text-slate-300">
                Signing Secret (HMAC-SHA256)
              </label>
              <div className="flex items-center space-x-2">
                <input
                  type="text"
                  readOnly
                  value={revealedSecret.secret}
                  className="flex-1 px-3 py-2 text-xs font-mono bg-forge-950 border border-white/[0.1] rounded-lg text-brand-300 select-all"
                />
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(revealedSecret.secret);
                    setSecretCopied(true);
                    toast.success('Signing secret copied to clipboard');
                    setTimeout(() => setSecretCopied(false), 2000);
                  }}
                  className="px-3 py-2 bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold rounded-lg flex items-center space-x-1 transition"
                >
                  {secretCopied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  <span>{secretCopied ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                onClick={() => setRevealedSecret(null)}
                className="px-4 py-2 bg-forge-800 hover:bg-forge-750 text-slate-200 text-xs font-medium rounded-lg transition"
              >
                I have saved this secret
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Gemini AI Health Report Modal */}
      {selectedEndpointForHealth && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="w-full max-w-2xl rounded-2xl bg-forge-900 border border-indigo-500/30 shadow-2xl overflow-hidden flex flex-col max-h-[88vh]">
            <div className="p-5 border-b border-white/[0.08] flex items-center justify-between">
              <div className="flex items-center space-x-2.5">
                <div className="w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/25 flex items-center justify-center text-indigo-400">
                  <Sparkles className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-slate-100 tracking-tight">
                    Gemini Endpoint Health Assessment
                  </h3>
                  <p className="text-xs text-slate-400">
                    {selectedEndpointForHealth.name} ({selectedEndpointForHealth.url})
                  </p>
                </div>
              </div>

              <div className="flex items-center space-x-2">
                <button
                  onClick={() => handleOpenHealthReport(selectedEndpointForHealth, true)}
                  disabled={healthReportLoading}
                  className="p-1.5 rounded-lg bg-forge-800 text-slate-300 hover:text-white transition"
                  title="Force refresh assessment"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${healthReportLoading ? 'animate-spin' : ''}`} />
                </button>
                <button
                  onClick={() => setSelectedEndpointForHealth(null)}
                  className="p-1 text-slate-400 hover:text-slate-200"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="p-5 space-y-4 overflow-y-auto flex-1">
              {healthReportLoading ? (
                <div className="py-16 text-center space-y-3">
                  <Sparkles className="w-8 h-8 text-indigo-400 animate-spin mx-auto" />
                  <div className="text-sm font-semibold text-slate-200">
                    Analyzing Endpoint Performance...
                  </div>
                  <p className="text-xs text-slate-400 max-w-sm mx-auto">
                    Gemini is evaluating delivery latency distributions, failure classes, and timeout trends to synthesize an operational health grade.
                  </p>
                </div>
              ) : healthReportError ? (
                <div className="bg-rose-950/40 border border-rose-800/60 p-4 rounded-xl text-xs text-rose-300">
                  {healthReportError}
                </div>
              ) : healthReport ? (
                <div className="space-y-4">
                  {/* Overall Health Grade */}
                  <div className="flex items-center justify-between p-3.5 bg-forge-950 rounded-xl border border-white/[0.08]">
                    <div className="text-xs text-slate-300 font-medium">Overall Health Status:</div>
                    <span
                      className={`px-3 py-1 rounded-full text-xs font-bold uppercase font-mono tracking-wider ${
                        healthReport.overall_health === 'healthy'
                          ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                          : healthReport.overall_health === 'degraded'
                          ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                          : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                      }`}
                    >
                      {healthReport.overall_health}
                    </span>
                  </div>

                  {/* Summary */}
                  <div className="p-4 bg-forge-950 rounded-xl border border-white/[0.08] space-y-1.5">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                      Telemetry Assessment Summary
                    </span>
                    <p className="text-xs text-slate-200 leading-relaxed">
                      {healthReport.summary}
                    </p>
                  </div>

                  {/* Observed Patterns */}
                  {Array.isArray(healthReport.observed_patterns) && healthReport.observed_patterns.length > 0 && (
                    <div className="space-y-1.5">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                        Observed Delivery Patterns
                      </span>
                      <ul className="space-y-1 text-xs">
                        {healthReport.observed_patterns.map((pat, idx) => (
                          <li key={idx} className="flex items-start space-x-2 bg-forge-950 p-2.5 rounded-lg border border-white/[0.06] text-slate-300">
                            <span className="text-indigo-400 mt-0.5">•</span>
                            <span>{pat}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Recommended Operator Actions */}
                  {Array.isArray(healthReport.recommended_actions) && healthReport.recommended_actions.length > 0 && (
                    <div className="space-y-1.5">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                        Recommended Operator Actions
                      </span>
                      <ul className="space-y-1 text-xs">
                        {healthReport.recommended_actions.map((act, idx) => (
                          <li key={idx} className="flex items-start space-x-2 bg-forge-950 p-2.5 rounded-lg border border-white/[0.06] text-slate-300">
                            <span className="text-emerald-400 font-bold">✓</span>
                            <span>{act}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Suggested Policy */}
                  {healthReport.suggested_policy && (
                    <div className="p-3.5 bg-forge-950 rounded-xl border border-white/[0.08] space-y-2">
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-indigo-300 flex items-center space-x-1.5">
                        <Sliders className="w-3.5 h-3.5" />
                        <span>Recommended Policy Adjustments</span>
                      </span>

                      <div className="grid grid-cols-3 gap-2 text-xs font-mono">
                        <div className="bg-forge-900 p-2 rounded border border-white/[0.06] text-center">
                          <div className="text-[10px] text-slate-400 font-sans">Max Attempts</div>
                          <div className="text-slate-100 font-bold mt-0.5">
                            {healthReport.suggested_policy.max_attempts ?? 5}
                          </div>
                        </div>
                        <div className="bg-forge-900 p-2 rounded border border-white/[0.06] text-center">
                          <div className="text-[10px] text-slate-400 font-sans">Timeout</div>
                          <div className="text-slate-100 font-bold mt-0.5">
                            {healthReport.suggested_policy.attempt_timeout_ms ?? 5000} ms
                          </div>
                        </div>
                        <div className="bg-forge-900 p-2 rounded border border-white/[0.06] text-center">
                          <div className="text-[10px] text-slate-400 font-sans">Max In-Flight</div>
                          <div className="text-slate-100 font-bold mt-0.5">
                            {healthReport.suggested_policy.max_in_flight ?? 5}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {/* Styled Secret Rotation Confirmation Dialog */}
      <ConfirmModal
        isOpen={Boolean(rotatingEndpoint)}
        title="Rotate Endpoint Signing Secret"
        message={
          <>
            Are you sure you want to rotate the secret for{' '}
            <strong className="text-slate-200">"{rotatingEndpoint?.name}"</strong>?
            <br />
            The previous secret will be invalidated immediately. Any downstream subscribers verifying HMAC signatures will need the new secret.
          </>
        }
        confirmText="Rotate Secret"
        danger={true}
        isLoading={isRotating}
        onConfirm={handleConfirmRotateSecret}
        onCancel={() => setRotatingEndpoint(null)}
      />
    </div>
  );
};
