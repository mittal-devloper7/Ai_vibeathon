import React, { useState, useEffect, useMemo } from 'react';
import {
  RefreshCw,
  Filter,
  ExternalLink,
  AlertCircle,
  Clock,
  CheckCircle2,
  XCircle,
  ShieldAlert,
  Copy,
  Check,
  Search,
  ArrowRight,
  Radio,
  Layers,
  RotateCcw,
  Sparkles,
} from 'lucide-react';
import { api } from '../api/client';
import { DeliverySummary, Endpoint } from '../api/types';
import { DeliveryDetailModal } from '../components/DeliveryDetailModal';
import { useToast } from '../context/ToastContext';

export const DeliveriesPage: React.FC = () => {
  const toast = useToast();
  const [deliveries, setDeliveries] = useState<DeliverySummary[]>([]);
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [endpointFilter, setEndpointFilter] = useState<string>('all');
  const [limit, setLimit] = useState<number>(50);

  // Modal State
  const [selectedDeliveryId, setSelectedDeliveryId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const fetchDeliveries = async () => {
    try {
      setLoading(true);
      const params: any = { limit };
      if (statusFilter !== 'all') params.status = statusFilter;
      if (endpointFilter !== 'all') params.endpoint_id = endpointFilter;

      const [deliveryData, endpointData] = await Promise.all([
        api.listDeliveries(params),
        api.listEndpoints().catch(() => []),
      ]);

      setDeliveries(Array.isArray(deliveryData) ? deliveryData : []);
      setEndpoints(Array.isArray(endpointData) ? endpointData : []);
      setError(null);
    } catch (err: any) {
      setDeliveries([]);
      setEndpoints([]);
      setError(err?.message || 'Failed to fetch deliveries');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDeliveries();
  }, [statusFilter, endpointFilter, limit]);

  const handleCopy = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(id);
    setCopiedId(id);
    toast.success('Delivery ID copied');
    setTimeout(() => setCopiedId(null), 2000);
  };

  const filteredDeliveries = useMemo(() => {
    if (!searchQuery.trim()) return deliveries;
    const query = searchQuery.trim().toLowerCase();
    return deliveries.filter((d) => {
      return (
        d.id.toLowerCase().includes(query) ||
        d.event_id?.toLowerCase().includes(query) ||
        d.event_type.toLowerCase().includes(query) ||
        (d.endpoint_name && d.endpoint_name.toLowerCase().includes(query)) ||
        (d.last_failure_class && d.last_failure_class.toLowerCase().includes(query))
      );
    });
  }, [deliveries, searchQuery]);

  return (
    <div className="space-y-6 animate-in fade-in duration-150">
      {/* Top Header & Refresh */}
      <div className="card-surface p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2.5">
            <h1 className="text-lg sm:text-xl font-bold text-slate-100 tracking-tight">
              Delivery Explorer
            </h1>
            <span className="px-2 py-0.5 rounded-full bg-forge-800 text-slate-300 font-mono text-[11px] border border-white/[0.08]">
              {filteredDeliveries.length} Records
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Audit individual webhook delivery lifecycles, HTTP response codes, backoff attempts, and replay lineage.
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={fetchDeliveries}
            disabled={loading}
            className="flex items-center space-x-1.5 px-3 py-1.5 bg-forge-800 hover:bg-forge-750 text-slate-200 border border-white/[0.08] rounded-lg text-xs transition disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Filter & Search Toolbar */}
      <div className="card-surface p-3.5 space-y-3 text-xs">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          {/* Search Box */}
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by Delivery ID, Event ID, Type, or Endpoint..."
              className="w-full pl-9 pr-3 py-1.5 bg-forge-950 border border-white/[0.08] rounded-lg text-slate-200 placeholder-slate-500 text-xs focus:outline-none focus:border-brand-500/60"
            />
          </div>

          {/* Endpoint Filter Dropdown */}
          <div className="flex items-center space-x-2">
            <span className="text-slate-400 font-medium text-[11px]">Endpoint:</span>
            <select
              value={endpointFilter}
              onChange={(e) => setEndpointFilter(e.target.value)}
              className="bg-forge-950 border border-white/[0.08] rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-brand-500 max-w-xs truncate"
            >
              <option value="all">All Endpoints</option>
              {endpoints.map((ep) => (
                <option key={ep.id} value={ep.id}>
                  {ep.name}
                </option>
              ))}
            </select>
          </div>

          {/* Limit Dropdown */}
          <div className="flex items-center space-x-2">
            <span className="text-slate-400 font-medium text-[11px]">Limit:</span>
            <select
              value={limit}
              onChange={(e) => setLimit(parseInt(e.target.value))}
              className="bg-forge-950 border border-white/[0.08] rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-brand-500"
            >
              <option value="25">25 rows</option>
              <option value="50">50 rows</option>
              <option value="100">100 rows</option>
            </select>
          </div>
        </div>

        {/* Status Filter Chips */}
        <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-white/[0.06]">
          <span className="text-[11px] text-slate-400 mr-1 flex items-center space-x-1">
            <Filter className="w-3 h-3 text-slate-500" />
            <span>Status:</span>
          </span>
          {[
            { id: 'all', label: 'All Statuses' },
            { id: 'succeeded', label: 'Succeeded' },
            { id: 'in_progress', label: 'In Progress' },
            { id: 'pending', label: 'Pending Retry' },
            { id: 'failed', label: 'Failed' },
            { id: 'dead_letter', label: 'Dead Letter' },
          ].map((st) => (
            <button
              key={st.id}
              onClick={() => setStatusFilter(st.id)}
              className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition ${
                statusFilter === st.id
                  ? 'bg-forge-800 text-brand-300 border border-brand-500/30'
                  : 'text-slate-400 hover:text-slate-200 bg-forge-950 border border-white/[0.06]'
              }`}
            >
              {st.label}
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

      {/* Deliveries Table */}
      <div className="card-surface overflow-hidden border border-white/[0.08]">
        {loading && deliveries.length === 0 ? (
          <div className="text-center py-16 text-slate-400 text-xs space-y-2">
            <RefreshCw className="w-6 h-6 animate-spin mx-auto text-brand-400" />
            <div>Loading delivery audit trail...</div>
          </div>
        ) : filteredDeliveries.length === 0 ? (
          <div className="p-12 text-center text-xs text-slate-400 space-y-2">
            <Layers className="w-8 h-8 text-slate-600 mx-auto" />
            <div className="font-semibold text-slate-300 text-sm">No Deliveries Found</div>
            <p className="max-w-sm mx-auto text-[11px] text-slate-400">
              {searchQuery
                ? 'No deliveries matched your search filter. Clear search to view all.'
                : 'No deliveries recorded yet. Publish a webhook event in the Event Lab to begin.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs min-w-[760px]">
              <thead className="bg-forge-950 text-slate-400 uppercase tracking-wider text-[10px] border-b border-white/[0.06]">
                <tr>
                  <th className="px-4 py-3">Delivery ID</th>
                  <th className="px-4 py-3">Event Type</th>
                  <th className="px-4 py-3">Destination</th>
                  <th className="px-3 py-3">Status</th>
                  <th className="px-3 py-3">Attempts</th>
                  <th className="px-3 py-3">Last HTTP</th>
                  <th className="px-4 py-3">Failure Reason</th>
                  <th className="px-4 py-3">Timestamp</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {filteredDeliveries.map((d) => {
                  const isCopied = copiedId === d.id;
                  return (
                    <tr
                      key={d.id}
                      onClick={() => setSelectedDeliveryId(d.id)}
                      className="hover:bg-forge-800/40 cursor-pointer transition"
                    >
                      {/* Delivery ID with copy */}
                      <td className="px-4 py-3 font-mono text-[11px] text-slate-300 whitespace-nowrap">
                        <div className="flex items-center space-x-1.5">
                          <span className="text-brand-400 font-semibold">{d.id.substring(0, 10)}…</span>
                          <button
                            onClick={(e) => handleCopy(d.id, e)}
                            className="p-1 text-slate-500 hover:text-slate-200 transition"
                            title="Copy full delivery ID"
                          >
                            {isCopied ? (
                              <Check className="w-3 h-3 text-emerald-400" />
                            ) : (
                              <Copy className="w-3 h-3" />
                            )}
                          </button>
                        </div>
                        {d.replay_number > 0 && (
                          <div className="text-[10px] text-indigo-300 font-semibold mt-0.5">
                            Replay #{d.replay_number}
                          </div>
                        )}
                      </td>

                      {/* Event Type */}
                      <td className="px-4 py-3 font-mono text-slate-200 whitespace-nowrap">
                        <span className="px-2 py-0.5 rounded text-[11px] bg-forge-950 border border-white/[0.06]">
                          {d.event_type}
                        </span>
                      </td>

                      {/* Destination Endpoint */}
                      <td className="px-4 py-3 text-slate-300 max-w-[170px] truncate">
                        <div className="font-semibold text-xs text-slate-200 truncate">
                          {d.endpoint_name || 'Unnamed'}
                        </div>
                        <div className="font-mono text-[10px] text-slate-500 truncate">{d.endpoint_id}</div>
                      </td>

                      {/* Status Badge */}
                      <td className="px-3 py-3 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${
                            d.status === 'succeeded'
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                              : d.status === 'failed'
                              ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                              : d.status === 'dead_letter'
                              ? 'bg-purple-500/10 text-purple-400 border border-purple-500/20'
                              : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              d.status === 'succeeded'
                                ? 'bg-emerald-400'
                                : d.status === 'failed'
                                ? 'bg-rose-400'
                                : d.status === 'dead_letter'
                                ? 'bg-purple-400'
                                : 'bg-amber-400 animate-pulse'
                            }`}
                          />
                          <span className="capitalize">{d.status.replace('_', ' ')}</span>
                        </span>
                      </td>

                      {/* Attempts */}
                      <td className="px-3 py-3 font-mono text-slate-300 whitespace-nowrap text-xs">
                        <span>{d.attempt_count}</span>
                        <span className="text-slate-500"> / {d.max_attempts}</span>
                      </td>

                      {/* Last HTTP Code */}
                      <td className="px-3 py-3 font-mono whitespace-nowrap">
                        {d.last_http_status ? (
                          <span
                            className={`font-semibold text-xs ${
                              d.last_http_status >= 200 && d.last_http_status < 300
                                ? 'text-emerald-400'
                                : d.last_http_status >= 400 && d.last_http_status < 500
                                ? 'text-amber-400'
                                : 'text-rose-400'
                            }`}
                          >
                            HTTP {d.last_http_status}
                          </span>
                        ) : (
                          <span className="text-slate-500 text-[11px] italic">In Flight</span>
                        )}
                      </td>

                      {/* Failure Reason */}
                      <td className="px-4 py-3 font-mono text-[10px] text-amber-300 max-w-[140px] truncate">
                        {d.last_failure_class ? (
                          <span className="px-1.5 py-0.5 rounded bg-forge-950 border border-amber-500/20">
                            {d.last_failure_class}
                          </span>
                        ) : (
                          <span className="text-slate-500">—</span>
                        )}
                      </td>

                      {/* Timestamp */}
                      <td className="px-4 py-3 text-slate-400 font-mono text-[11px] whitespace-nowrap">
                        {new Date(d.created_at).toLocaleTimeString()}
                      </td>

                      {/* Action */}
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedDeliveryId(d.id);
                          }}
                          className="px-2.5 py-1 text-xs bg-forge-800 hover:bg-forge-750 text-slate-200 rounded-lg border border-white/[0.08] transition flex items-center space-x-1 ml-auto"
                        >
                          <span>Inspect</span>
                          <ArrowRight className="w-3 h-3 text-slate-400" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Delivery Detail Modal */}
      {selectedDeliveryId && (
        <DeliveryDetailModal
          deliveryId={selectedDeliveryId}
          onClose={() => setSelectedDeliveryId(null)}
          onReplaySuccess={fetchDeliveries}
        />
      )}
    </div>
  );
};
