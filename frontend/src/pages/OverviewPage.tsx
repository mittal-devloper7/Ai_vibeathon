import React, { useState, useEffect, useCallback } from 'react';
import {
  Activity,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  RefreshCw,
  ShieldAlert,
  Zap,
  Layers,
  ArrowRight,
  Radio,
  ExternalLink,
  ShieldCheck,
  Check,
  HelpCircle,
  AlertCircle,
} from 'lucide-react';
import { api, getStoredApiUrl } from '../api/client';
import { DashboardMetrics, Endpoint, DeliverySummary } from '../api/types';
import { DeliveryDetailModal } from '../components/DeliveryDetailModal';

interface OverviewPageProps {
  onNavigate?: (tab: 'overview' | 'endpoints' | 'lab' | 'deliveries' | 'guide') => void;
}

export const OverviewPage: React.FC<OverviewPageProps> = ({ onNavigate }) => {
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [recentDeliveries, setRecentDeliveries] = useState<DeliverySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());
  const [selectedDeliveryId, setSelectedDeliveryId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [m, epList, dList] = await Promise.all([
        api.getMetrics(),
        api.listEndpoints().catch(() => []),
        api.listDeliveries({ limit: 8 }).catch(() => []),
      ]);

      setMetrics(m);
      setEndpoints(Array.isArray(epList) ? epList : []);
      setRecentDeliveries(Array.isArray(dList) ? dList : []);
      setError(null);
      setLastRefreshed(new Date());
    } catch (err: any) {
      setError(err?.message || 'Failed to fetch telemetry data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    if (!autoRefresh) return;
    const interval = setInterval(fetchData, 3000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchData]);

  const statusMap = metrics?.deliveries_by_status || {};
  const total = metrics?.total_deliveries || 0;
  const succeeded = statusMap['succeeded'] || 0;
  const inProgress = statusMap['in_progress'] || 0;
  const pending = statusMap['pending'] || 0;
  const failed = statusMap['failed'] || 0;
  const deadLetter = statusMap['dead_letter'] || 0;

  const totalEndpoints = endpoints.length;
  const activeEndpoints = endpoints.filter((e) => e.status === 'active').length;

  return (
    <div className="space-y-6 animate-in fade-in duration-150">
      {/* Top Header & Live Control Toolbar */}
      <div className="card-surface p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2.5">
            <h1 className="text-lg sm:text-xl font-bold text-slate-100 tracking-tight">
              System Telemetry & Operational Health
            </h1>
            <span className="flex items-center space-x-1.5 px-2 py-0.5 rounded-full bg-brand-500/10 border border-brand-500/20 text-brand-300 font-mono text-[10px]">
              <span className="w-1.5 h-1.5 rounded-full bg-brand-400 animate-pulse" />
              <span>Real-Time Engine</span>
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Real-time delivery statistics, queue lag, outbox backlog, and circuit breaker status.
          </p>
        </div>

        <div className="flex items-center space-x-2 text-xs">
          <label className="flex items-center space-x-2 cursor-pointer bg-forge-950 px-3 py-1.5 rounded-lg border border-white/[0.08] hover:border-white/[0.12] transition">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="rounded bg-forge-800 border-white/[0.12] text-brand-500 focus:ring-0 focus:ring-offset-0 cursor-pointer"
            />
            <span className="text-slate-300 select-none">Live Polling (3s)</span>
          </label>

          <button
            onClick={fetchData}
            disabled={loading}
            className="flex items-center space-x-1.5 px-3 py-1.5 bg-forge-800 hover:bg-forge-750 text-slate-200 border border-white/[0.08] rounded-lg transition disabled:opacity-50"
            title="Manual metrics refresh"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-rose-950/40 border border-rose-800/60 p-4 rounded-xl text-xs text-rose-300 flex items-start space-x-3">
          <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <div className="font-semibold text-rose-200">Unable to retrieve live telemetry metrics</div>
            <div className="text-rose-400">{error}</div>
            <div className="text-rose-400/80 text-[11px]">
              Verify your backend API ({getStoredApiUrl()}) is reachable (hosted services may take ~30s on cold start) and a valid tenant key is set in the Header.
            </div>
          </div>
        </div>
      )}

      {/* 6 Core Metrics Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3.5">
        {/* Card 1: Success Rate */}
        <div className="card-surface p-4 flex flex-col justify-between group hover:border-brand-500/30 transition">
          <div className="flex items-center justify-between text-slate-400 text-xs">
            <span className="font-medium">Success Rate</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="my-2">
            <div className="text-2xl font-bold font-mono text-emerald-400 tracking-tight">
              {metrics ? `${metrics.success_rate.toFixed(1)}%` : '—'}
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5 font-mono">
              {succeeded.toLocaleString()} / {total.toLocaleString()} passed
            </div>
          </div>
          <div className="text-[10px] text-slate-400">At-least-once delivery</div>
        </div>

        {/* Card 2: Total Deliveries */}
        <div className="card-surface p-4 flex flex-col justify-between group hover:border-brand-500/30 transition">
          <div className="flex items-center justify-between text-slate-400 text-xs">
            <span className="font-medium">Total Deliveries</span>
            <Layers className="w-4 h-4 text-brand-400" />
          </div>
          <div className="my-2">
            <div className="text-2xl font-bold font-mono text-slate-100 tracking-tight">
              {metrics ? total.toLocaleString() : '—'}
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5 font-mono">
              {pending + inProgress} pending/active
            </div>
          </div>
          <div className="text-[10px] text-slate-400">Total delivery records</div>
        </div>

        {/* Card 3: Avg HTTP Latency */}
        <div className="card-surface p-4 flex flex-col justify-between group hover:border-brand-500/30 transition">
          <div className="flex items-center justify-between text-slate-400 text-xs">
            <span className="font-medium">Avg Latency</span>
            <Clock className="w-4 h-4 text-sky-400" />
          </div>
          <div className="my-2">
            <div className="text-2xl font-bold font-mono text-slate-100 tracking-tight">
              {metrics ? `${Math.round(metrics.average_latency_ms)} ms` : '—'}
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              Round-trip HTTP dispatch
            </div>
          </div>
          <div className="text-[10px] text-slate-400">Pooled Undici client</div>
        </div>

        {/* Card 4: Outbox Backlog */}
        <div className="card-surface p-4 flex flex-col justify-between group hover:border-brand-500/30 transition">
          <div className="flex items-center justify-between text-slate-400 text-xs">
            <span className="font-medium">Outbox Backlog</span>
            <Zap className={`w-4 h-4 ${metrics && metrics.outbox_backlog > 20 ? 'text-amber-400' : 'text-slate-400'}`} />
          </div>
          <div className="my-2">
            <div
              className={`text-2xl font-bold font-mono tracking-tight ${
                metrics && metrics.outbox_backlog > 50
                  ? 'text-rose-400'
                  : metrics && metrics.outbox_backlog > 10
                  ? 'text-amber-400'
                  : 'text-slate-100'
              }`}
            >
              {metrics ? metrics.outbox_backlog.toLocaleString() : '—'}
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              Unpublished events
            </div>
          </div>
          <div className="text-[10px] text-slate-400">Transactional outbox buffer</div>
        </div>

        {/* Card 5: Queue Scheduling Delay */}
        <div className="card-surface p-4 flex flex-col justify-between group hover:border-brand-500/30 transition">
          <div className="flex items-center justify-between text-slate-400 text-xs">
            <span className="font-medium">Oldest Due Lag</span>
            <AlertTriangle
              className={`w-4 h-4 ${
                metrics && metrics.oldest_due_delivery_age_sec > 15 ? 'text-rose-400' : 'text-slate-400'
              }`}
            />
          </div>
          <div className="my-2">
            <div
              className={`text-2xl font-bold font-mono tracking-tight ${
                metrics && metrics.oldest_due_delivery_age_sec > 30
                  ? 'text-rose-400'
                  : metrics && metrics.oldest_due_delivery_age_sec > 10
                  ? 'text-amber-400'
                  : 'text-slate-100'
              }`}
            >
              {metrics ? `${metrics.oldest_due_delivery_age_sec}s` : '—'}
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              Queue dispatch latency
            </div>
          </div>
          <div className="text-[10px] text-slate-400">BullMQ retry schedule</div>
        </div>

        {/* Card 6: Registered Endpoints */}
        <div className="card-surface p-4 flex flex-col justify-between group hover:border-brand-500/30 transition">
          <div className="flex items-center justify-between text-slate-400 text-xs">
            <span className="font-medium">Endpoints</span>
            <Radio className="w-4 h-4 text-brand-400" />
          </div>
          <div className="my-2">
            <div className="text-2xl font-bold font-mono text-slate-100 tracking-tight">
              {totalEndpoints}
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5 font-mono">
              <span className="text-emerald-400 font-semibold">{activeEndpoints}</span> active,{' '}
              {totalEndpoints - activeEndpoints} paused
            </div>
          </div>
          <div className="text-[10px] text-slate-400">Subscribed webhook targets</div>
        </div>
      </div>

      {/* Status Distribution Stacked Bar */}
      <div className="card-surface p-4 sm:p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs sm:text-sm font-semibold text-slate-200 tracking-tight">
            Delivery Lifecycle Distribution
          </h3>
          <span className="text-xs text-slate-400 font-mono">
            {total > 0 ? `${total} Total Recorded` : 'No Deliveries Yet'}
          </span>
        </div>

        {/* Stacked Progress Bar */}
        <div className="h-3 w-full bg-forge-950 rounded-full overflow-hidden flex border border-white/[0.06]">
          {total > 0 ? (
            <>
              {succeeded > 0 && (
                <div
                  style={{ width: `${(succeeded / total) * 100}%` }}
                  className="bg-emerald-500 h-full transition-all"
                  title={`Succeeded: ${succeeded} (${((succeeded / total) * 100).toFixed(1)}%)`}
                />
              )}
              {inProgress > 0 && (
                <div
                  style={{ width: `${(inProgress / total) * 100}%` }}
                  className="bg-sky-500 h-full transition-all"
                  title={`In Progress: ${inProgress}`}
                />
              )}
              {pending > 0 && (
                <div
                  style={{ width: `${(pending / total) * 100}%` }}
                  className="bg-amber-500 h-full transition-all"
                  title={`Pending Retry: ${pending}`}
                />
              )}
              {failed > 0 && (
                <div
                  style={{ width: `${(failed / total) * 100}%` }}
                  className="bg-rose-500 h-full transition-all"
                  title={`Failed: ${failed}`}
                />
              )}
              {deadLetter > 0 && (
                <div
                  style={{ width: `${(deadLetter / total) * 100}%` }}
                  className="bg-purple-600 h-full transition-all"
                  title={`Dead Letter: ${deadLetter}`}
                />
              )}
            </>
          ) : (
            <div className="w-full bg-forge-850 h-full" />
          )}
        </div>

        {/* Status Legend Pills */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 pt-1 text-xs">
          <div className="flex items-center space-x-2 bg-forge-950/60 px-3 py-1.5 rounded-lg border border-white/[0.06]">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0" />
            <span className="text-slate-400 text-[11px]">Succeeded:</span>
            <span className="font-mono font-semibold text-slate-200 ml-auto">{succeeded}</span>
          </div>
          <div className="flex items-center space-x-2 bg-forge-950/60 px-3 py-1.5 rounded-lg border border-white/[0.06]">
            <span className="w-2.5 h-2.5 rounded-full bg-sky-500 shrink-0" />
            <span className="text-slate-400 text-[11px]">In Progress:</span>
            <span className="font-mono font-semibold text-slate-200 ml-auto">{inProgress}</span>
          </div>
          <div className="flex items-center space-x-2 bg-forge-950/60 px-3 py-1.5 rounded-lg border border-white/[0.06]">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-500 shrink-0" />
            <span className="text-slate-400 text-[11px]">Pending Retry:</span>
            <span className="font-mono font-semibold text-slate-200 ml-auto">{pending}</span>
          </div>
          <div className="flex items-center space-x-2 bg-forge-950/60 px-3 py-1.5 rounded-lg border border-white/[0.06]">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500 shrink-0" />
            <span className="text-slate-400 text-[11px]">Failed:</span>
            <span className="font-mono font-semibold text-slate-200 ml-auto">{failed}</span>
          </div>
          <div className="flex items-center space-x-2 bg-forge-950/60 px-3 py-1.5 rounded-lg border border-white/[0.06]">
            <span className="w-2.5 h-2.5 rounded-full bg-purple-600 shrink-0" />
            <span className="text-slate-400 text-[11px]">Dead Letter:</span>
            <span className="font-mono font-semibold text-slate-200 ml-auto">{deadLetter}</span>
          </div>
        </div>
      </div>

      {/* Two Column Layout: Circuit Breakers & Recent Activity Stream */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left Column (5 Cols): Circuit Breakers Table */}
        <div className="lg:col-span-5 card-surface p-4 sm:p-5 flex flex-col justify-between space-y-4">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-white/[0.06]">
              <div className="flex items-center space-x-2">
                <ShieldAlert className="w-4 h-4 text-brand-400 shrink-0" />
                <h3 className="text-sm font-semibold text-slate-100 tracking-tight">
                  Circuit Breakers
                </h3>
              </div>
              <span className="text-[11px] font-mono text-slate-400">
                {metrics?.circuit_breakers?.length || 0} tracked
              </span>
            </div>

            <p className="text-[11px] text-slate-400 mt-2 mb-3">
              Fails fast when consecutive downstream 5xx or timeouts breach threshold, protecting merchant servers.
            </p>

            {Array.isArray(metrics?.circuit_breakers) && metrics.circuit_breakers.length > 0 ? (
              <div className="space-y-2 overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-forge-950 text-slate-400 uppercase tracking-wider text-[10px]">
                    <tr>
                      <th className="px-3 py-2 rounded-l-lg">Endpoint</th>
                      <th className="px-2 py-2">State</th>
                      <th className="px-2 py-2 text-right">Failures</th>
                      <th className="px-3 py-2 rounded-r-lg text-right">Cooldown</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.04]">
                    {metrics.circuit_breakers.map((cb) => {
                      const stateLower = (cb.state || '').toLowerCase();
                      return (
                        <tr key={cb.endpoint_id} className="hover:bg-forge-800/40 transition">
                          <td className="px-3 py-2.5 font-medium text-slate-200 max-w-[140px] truncate">
                            <div className="truncate text-xs font-semibold">{cb.endpoint_name || 'Unnamed'}</div>
                            <div className="font-mono text-[10px] text-slate-400 truncate">{cb.endpoint_id}</div>
                          </td>
                          <td className="px-2 py-2.5">
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase ${
                                stateLower === 'closed'
                                  ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/25'
                                  : stateLower === 'open'
                                  ? 'bg-rose-500/10 text-rose-400 border border-rose-500/25'
                                  : 'bg-amber-500/10 text-amber-400 border border-amber-500/25'
                              }`}
                            >
                              {stateLower}
                            </span>
                          </td>
                          <td className="px-2 py-2.5 font-mono text-slate-300 text-right text-xs">
                            {cb.consecutive_failures}
                          </td>
                          <td className="px-3 py-2.5 text-slate-400 font-mono text-[11px] text-right">
                            {cb.open_until ? new Date(cb.open_until).toLocaleTimeString() : 'Closed (Ready)'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center py-8 px-4 bg-forge-950/70 rounded-xl border border-white/[0.06] text-xs text-slate-400 space-y-1">
                <ShieldCheck className="w-6 h-6 text-emerald-400 mx-auto mb-1 opacity-80" />
                <div className="font-medium text-slate-300">All Circuit Breakers Healthy</div>
                <div className="text-[11px] text-slate-400">
                  No downstream failure cascades detected. All endpoints in CLOSED state.
                </div>
              </div>
            )}
          </div>

          <div className="pt-3 border-t border-white/[0.06] flex items-center justify-between text-xs text-slate-400">
            <span className="text-[11px]">Threshold: 5 consecutive failures</span>
            {onNavigate && (
              <button
                onClick={() => onNavigate('endpoints')}
                className="text-brand-400 hover:text-brand-300 font-medium inline-flex items-center space-x-1"
              >
                <span>Manage Endpoints</span>
                <ArrowRight className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>

        {/* Right Column (7 Cols): Recent Delivery Activity Feed */}
        <div className="lg:col-span-7 card-surface p-4 sm:p-5 flex flex-col justify-between space-y-4">
          <div>
            <div className="flex items-center justify-between pb-3 border-b border-white/[0.06]">
              <div className="flex items-center space-x-2">
                <Activity className="w-4 h-4 text-brand-400 shrink-0" />
                <h3 className="text-sm font-semibold text-slate-100 tracking-tight">
                  Recent Delivery Stream
                </h3>
              </div>
              {onNavigate && (
                <button
                  onClick={() => onNavigate('deliveries')}
                  className="text-xs text-brand-400 hover:text-brand-300 font-medium inline-flex items-center space-x-1"
                >
                  <span>Explore Deliveries</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <p className="text-[11px] text-slate-400 mt-2 mb-3">
              Real-time feed of recently ingested webhook dispatches. Click any item to inspect its timeline.
            </p>

            {recentDeliveries.length > 0 ? (
              <div className="space-y-2">
                {recentDeliveries.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => setSelectedDeliveryId(d.id)}
                    aria-label={`Inspect delivery ${d.id} (${d.event_type}, status ${d.status})`}
                    className="w-full text-left p-3 bg-forge-950/80 hover:bg-forge-850 border border-white/[0.06] hover:border-brand-500/30 rounded-xl transition cursor-pointer flex items-center justify-between gap-3 group"
                  >
                    <div className="flex items-center space-x-3 min-w-0">
                      <span
                        aria-hidden="true"
                        className={`w-2 h-2 rounded-full shrink-0 ${
                          d.status === 'succeeded'
                            ? 'bg-emerald-400'
                            : d.status === 'failed'
                            ? 'bg-rose-400'
                            : d.status === 'dead_letter'
                            ? 'bg-purple-400'
                            : 'bg-amber-400'
                        }`}
                      />
                      <div className="min-w-0">
                        <div className="flex items-center space-x-2">
                          <span className="font-mono text-xs font-semibold text-slate-200 truncate">
                            {d.event_type}
                          </span>
                          {d.replay_number > 0 && (
                            <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-indigo-950 text-indigo-300 border border-indigo-800">
                              Replay #{d.replay_number}
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-slate-400 truncate">
                          To: <span className="text-slate-300">{d.endpoint_name}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center space-x-3 shrink-0 text-right">
                      <div>
                        <div className="text-xs font-mono font-bold text-slate-200">
                          {d.last_http_status ? `HTTP ${d.last_http_status}` : 'In Flight'}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          Attempt {d.attempt_count}/{d.max_attempts}
                        </div>
                      </div>
                      <span className="text-slate-500 group-hover:text-brand-400 transition-colors" aria-hidden="true">
                        <ArrowRight className="w-4 h-4" />
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="text-center py-10 px-4 bg-forge-950/70 rounded-xl border border-white/[0.06] text-xs text-slate-400 space-y-2">
                <Zap className="w-6 h-6 text-brand-400 mx-auto mb-1 opacity-70" />
                <div className="font-medium text-slate-300">No Webhook Deliveries Recorded</div>
                <p className="text-[11px] text-slate-400 max-w-sm mx-auto">
                  Publish your first webhook event in the Event Lab to observe real-time outbox scheduling and delivery.
                </p>
                {onNavigate && (
                  <button
                    onClick={() => onNavigate('lab')}
                    className="mt-2 inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-500 text-white font-semibold text-xs shadow-sm transition"
                  >
                    <span>Open Event Lab</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="pt-3 border-t border-white/[0.06] flex items-center justify-between text-xs text-slate-400 font-mono text-[11px]">
            <span>Synced: {lastRefreshed.toLocaleTimeString()}</span>
            <span>At-Least-Once Delivery Guarantees Active</span>
          </div>
        </div>
      </div>

      {/* Modal for viewing delivery details directly from Overview */}
      {selectedDeliveryId && (
        <DeliveryDetailModal
          deliveryId={selectedDeliveryId}
          onClose={() => setSelectedDeliveryId(null)}
          onReplaySuccess={fetchData}
        />
      )}
    </div>
  );
};
