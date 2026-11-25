import React, { useState, useEffect } from 'react';
import {
  Sparkles,
  RotateCcw,
  Clock,
  ShieldAlert,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Copy,
  Check,
  RefreshCw,
  ExternalLink,
  ChevronRight,
  FileText,
  Code,
  Sliders,
  Send,
  X,
  Layers,
  ArrowRight,
  Terminal,
} from 'lucide-react';
import { api } from '../api/client';
import { DeliveryDetail, IncidentDiagnosis } from '../api/types';
import { useToast } from '../context/ToastContext';

interface DeliveryDetailModalProps {
  deliveryId: string;
  onClose: () => void;
  onReplaySuccess?: () => void;
}

export const DeliveryDetailModal: React.FC<DeliveryDetailModalProps> = ({
  deliveryId,
  onClose,
  onReplaySuccess,
}) => {
  const toast = useToast();
  const [delivery, setDelivery] = useState<DeliveryDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Replay State
  const [showReplayPrompt, setShowReplayPrompt] = useState(false);
  const [replayReason, setReplayReason] = useState('Manual operator retry: verified downstream endpoint recovery.');
  const [isReplaying, setIsReplaying] = useState(false);

  // Gemini Diagnosis State
  const [diagnosis, setDiagnosis] = useState<IncidentDiagnosis | null>(null);
  const [diagnosisLoading, setDiagnosisLoading] = useState(false);
  const [diagnosisError, setDiagnosisError] = useState<string | null>(null);
  const [reportCopied, setReportCopied] = useState(false);
  const [payloadCopied, setPayloadCopied] = useState(false);

  const fetchDetail = async () => {
    try {
      setLoading(true);
      const data = await api.getDelivery(deliveryId);
      setDelivery(data);
      setError(null);
    } catch (err: any) {
      setError(err?.message || 'Failed to load delivery details');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDetail();
  }, [deliveryId]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isReplaying) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isReplaying, onClose]);

  const handleReplay = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!replayReason.trim()) {
      toast.warning('Please enter an audit reason for the replay', 'Audit Required');
      return;
    }

    setIsReplaying(true);
    try {
      const res = await api.replayDelivery(deliveryId, replayReason);
      toast.success(
        `Replay #${res.replay_number} enqueued with fresh 30s lease`,
        'Replay Initiated'
      );
      setShowReplayPrompt(false);
      if (onReplaySuccess) onReplaySuccess();
      fetchDetail();
    } catch (err: any) {
      toast.error(err?.message || 'Unknown error', 'Replay Failed');
    } finally {
      setIsReplaying(false);
    }
  };

  const handleDiagnose = async (forceRefresh = false) => {
    setDiagnosisLoading(true);
    setDiagnosisError(null);

    try {
      const res = await api.diagnoseDelivery(deliveryId, forceRefresh);
      setDiagnosis(res);
      toast.success('Gemini Incident Copilot diagnosis ready', 'Analysis Complete');
    } catch (err: any) {
      setDiagnosisError(err?.message || 'Failed to diagnose incident with Gemini');
      toast.error(err?.message || 'Copilot diagnosis failed');
    } finally {
      setDiagnosisLoading(false);
    }
  };

  const handleCopyMerchantReport = () => {
    if (!diagnosis?.merchant_issue_summary) return;
    navigator.clipboard.writeText(diagnosis.merchant_issue_summary);
    setReportCopied(true);
    toast.success('Merchant issue report copied to clipboard');
    setTimeout(() => setReportCopied(false), 2000);
  };

  const handleCopyPayload = () => {
    if (!delivery?.payload) return;
    navigator.clipboard.writeText(JSON.stringify(delivery.payload, null, 2));
    setPayloadCopied(true);
    toast.success('Payload JSON copied to clipboard');
    setTimeout(() => setPayloadCopied(false), 2000);
  };

  // Helper to determine lifecycle stepper states
  const getLifecycleState = () => {
    const status = delivery?.status;
    const attempts = delivery?.attempts?.length || 0;

    return {
      step1: 'done', // Ingested
      step2: 'done', // Outbox staged
      step3: attempts > 0 ? 'done' : 'active', // Lease claimed
      step4: attempts > 0 ? 'done' : 'pending', // HTTP dispatched
      step5:
        status === 'succeeded'
          ? 'success'
          : status === 'dead_letter'
          ? 'dead_letter'
          : status === 'failed' || status === 'pending'
          ? 'retry'
          : 'in_flight',
    };
  };

  const lifecycle = getLifecycleState();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-sm animate-in fade-in duration-150">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="delivery-detail-modal-title"
        className="w-full max-w-4xl max-h-[92vh] rounded-2xl bg-forge-900 border border-white/[0.1] shadow-2xl flex flex-col overflow-hidden"
      >
        {/* Sticky Modal Header */}
        <div className="px-5 py-4 border-b border-white/[0.08] flex items-center justify-between bg-forge-900/98 backdrop-blur sticky top-0 z-20">
          <div className="flex items-center space-x-3 min-w-0">
            <h2
              id="delivery-detail-modal-title"
              className="font-bold text-slate-100 text-sm sm:text-base tracking-tight shrink-0"
            >
              Delivery Audit Record
            </h2>
            <span className="font-mono text-xs text-brand-300 bg-forge-950 px-2.5 py-1 rounded-lg border border-white/[0.08] truncate max-w-[200px] sm:max-w-none">
              {deliveryId}
            </span>
            {delivery && delivery.replay_number > 0 && (
              <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
                Replay #{delivery.replay_number}
              </span>
            )}
          </div>

          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-forge-800 transition"
            aria-label="Close delivery detail"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {loading ? (
          <div className="p-16 text-center text-slate-400 text-xs space-y-2">
            <RefreshCw className="w-6 h-6 animate-spin mx-auto text-brand-400" />
            <div>Loading delivery timeline and attempt history...</div>
          </div>
        ) : error ? (
          <div className="p-6">
            <div className="bg-rose-950/40 border border-rose-800/60 p-4 rounded-xl text-xs text-rose-300 flex items-center space-x-3">
              <AlertCircle className="w-5 h-5 text-rose-400 shrink-0" />
              <div>{error}</div>
            </div>
          </div>
        ) : delivery ? (
          <div className="p-5 sm:p-6 space-y-6 overflow-y-auto flex-1">
            {/* Top Overview & Action Bar */}
            <div className="card-surface p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border border-white/[0.08]">
              <div className="space-y-1.5 min-w-0">
                <div className="flex items-center space-x-2">
                  <span
                    className={`inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider ${
                      delivery.status === 'succeeded'
                        ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                        : delivery.status === 'failed'
                        ? 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                        : delivery.status === 'dead_letter'
                        ? 'bg-purple-500/15 text-purple-400 border border-purple-500/30'
                        : 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        delivery.status === 'succeeded' ? 'bg-emerald-400' : 'bg-current'
                      }`}
                    />
                    <span>{delivery.status.replace('_', ' ')}</span>
                  </span>

                  <span className="text-xs text-slate-400 font-mono">
                    Attempt {delivery.attempt_count} / {delivery.max_attempts}
                  </span>
                </div>

                <div className="text-xs text-slate-300 flex items-center space-x-1.5 truncate">
                  <span className="text-slate-400">Target:</span>
                  <span className="font-semibold text-slate-200">{delivery.endpoint_name}</span>
                  <span className="text-slate-500">•</span>
                  <span className="font-mono text-brand-300 text-[11px] truncate">{delivery.endpoint_url}</span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center space-x-2 shrink-0">
                <button
                  onClick={() => setShowReplayPrompt(!showReplayPrompt)}
                  className="flex items-center space-x-1.5 px-3 py-1.5 bg-forge-800 hover:bg-forge-750 text-slate-200 border border-white/[0.08] rounded-lg text-xs font-medium transition"
                >
                  <RotateCcw className="w-3.5 h-3.5 text-brand-400" />
                  <span>Replay Delivery</span>
                </button>

                <button
                  onClick={() => handleDiagnose(false)}
                  disabled={diagnosisLoading}
                  className="flex items-center space-x-1.5 px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold shadow-md shadow-indigo-950/40 transition disabled:opacity-50"
                >
                  <Sparkles className={`w-3.5 h-3.5 ${diagnosisLoading ? 'animate-spin' : ''}`} />
                  <span>Diagnose with Gemini</span>
                </button>
              </div>
            </div>

            {/* Visual Lifecycle Stepper */}
            <div className="card-surface p-4 sm:p-5 border border-white/[0.08] space-y-3">
              <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider block">
                Delivery Lifecycle Progression
              </span>

              <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-5 gap-2 text-xs">
                {/* Step 1: Ingested */}
                <div className="p-2.5 rounded-lg bg-forge-950 border border-emerald-500/30 space-y-1">
                  <div className="flex items-center space-x-1.5 text-emerald-400 font-bold text-[11px]">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>1. Ingested</span>
                  </div>
                  <div className="text-[10px] text-slate-400">Transactional outbox</div>
                </div>

                {/* Step 2: Queued */}
                <div className="p-2.5 rounded-lg bg-forge-950 border border-emerald-500/30 space-y-1">
                  <div className="flex items-center space-x-1.5 text-emerald-400 font-bold text-[11px]">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>2. Outbox Fanout</span>
                  </div>
                  <div className="text-[10px] text-slate-400">BullMQ distributed queue</div>
                </div>

                {/* Step 3: Lease */}
                <div className="p-2.5 rounded-lg bg-forge-950 border border-emerald-500/30 space-y-1">
                  <div className="flex items-center space-x-1.5 text-emerald-400 font-bold text-[11px]">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>3. Lease Claimed</span>
                  </div>
                  <div className="text-[10px] text-slate-400">30s crash-safe lock</div>
                </div>

                {/* Step 4: Dispatched */}
                <div className="p-2.5 rounded-lg bg-forge-950 border border-emerald-500/30 space-y-1">
                  <div className="flex items-center space-x-1.5 text-emerald-400 font-bold text-[11px]">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>4. HTTP Dispatched</span>
                  </div>
                  <div className="text-[10px] text-slate-400">Undici pooled client</div>
                </div>

                {/* Step 5: Terminal / Evaluated */}
                <div
                  className={`p-2.5 rounded-lg bg-forge-950 border space-y-1 ${
                    lifecycle.step5 === 'success'
                      ? 'border-emerald-500/40 text-emerald-400'
                      : lifecycle.step5 === 'dead_letter'
                      ? 'border-purple-500/40 text-purple-400'
                      : lifecycle.step5 === 'retry'
                      ? 'border-amber-500/40 text-amber-400'
                      : 'border-white/[0.08] text-slate-400'
                  }`}
                >
                  <div className="flex items-center space-x-1.5 font-bold text-[11px]">
                    {lifecycle.step5 === 'success' ? (
                      <CheckCircle2 className="w-3.5 h-3.5" />
                    ) : lifecycle.step5 === 'dead_letter' ? (
                      <ShieldAlert className="w-3.5 h-3.5" />
                    ) : (
                      <Clock className="w-3.5 h-3.5" />
                    )}
                    <span className="capitalize">
                      {lifecycle.step5 === 'success'
                        ? '5. Succeeded'
                        : lifecycle.step5 === 'dead_letter'
                        ? '5. Dead-Lettered'
                        : '5. Retrying'}
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-400">
                    {delivery.next_retry_at
                      ? `Retry: ${new Date(delivery.next_retry_at).toLocaleTimeString()}`
                      : 'Terminal state'}
                  </div>
                </div>
              </div>
            </div>

            {/* Replay Prompt Drawer */}
            {showReplayPrompt && (
              <form
                onSubmit={handleReplay}
                className="card-surface p-4 sm:p-5 border border-brand-500/40 space-y-3 animate-in fade-in"
              >
                <div className="text-xs font-semibold text-slate-200 flex items-center space-x-2">
                  <RotateCcw className="w-4 h-4 text-brand-400" />
                  <span>Execute Delivery Replay</span>
                </div>
                <p className="text-xs text-slate-400">
                  HookForge will enqueue a fresh delivery attempt with a new lease, preserving original event payload and linking replay lineage.
                </p>
                <div>
                  <label htmlFor="replay-audit-reason" className="block text-[11px] font-medium text-slate-300 mb-1">
                    Replay Audit Reason *
                  </label>
                  <input
                    id="replay-audit-reason"
                    type="text"
                    required
                    value={replayReason}
                    onChange={(e) => setReplayReason(e.target.value)}
                    placeholder="e.g. Downstream endpoint recovered; manual operator retry."
                    className="w-full px-3 py-2 text-xs bg-forge-950 border border-white/[0.1] rounded-lg text-slate-100 focus:outline-none focus:border-brand-500"
                  />
                </div>
                <div className="flex justify-end space-x-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setShowReplayPrompt(false)}
                    className="px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isReplaying}
                    className="px-4 py-1.5 text-xs font-semibold bg-brand-600 hover:bg-brand-500 text-white rounded-lg transition shadow flex items-center space-x-1.5"
                  >
                    {isReplaying && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                    <span>{isReplaying ? 'Enqueueing...' : 'Confirm Replay'}</span>
                  </button>
                </div>
              </form>
            )}

            {/* GEMINI INCIDENT COPILOT DIAGNOSIS PANEL */}
            {diagnosisLoading ? (
              <div className="bg-indigo-950/20 border border-indigo-800/40 p-8 rounded-xl text-center space-y-3">
                <Sparkles className="w-8 h-8 text-indigo-400 animate-spin mx-auto" />
                <div className="text-sm font-semibold text-slate-200">Incident Copilot Reasoning...</div>
                <p className="text-xs text-slate-400 max-w-md mx-auto">
                  Google Gemini is analyzing attempt timelines, failure classes, and response headers to determine root cause and actionable operator remediation.
                </p>
              </div>
            ) : diagnosisError ? (
              <div className="bg-rose-950/40 border border-rose-800/60 p-4 rounded-xl text-xs text-rose-300">
                <div className="font-semibold">Gemini Incident Copilot Unavailable</div>
                <div className="mt-1">{diagnosisError}</div>
              </div>
            ) : diagnosis ? (
              <div className="bg-indigo-950/25 border border-indigo-700/50 rounded-xl p-5 space-y-4 shadow-lg">
                <div className="flex items-center justify-between border-b border-indigo-900/60 pb-3">
                  <div className="flex items-center space-x-2.5">
                    <Sparkles className="w-5 h-5 text-indigo-400 shrink-0" />
                    <div>
                      <h4 className="font-bold text-slate-100 text-sm tracking-tight">{diagnosis.incident_title}</h4>
                      <div className="text-[11px] text-indigo-300/80">AI Incident Copilot Diagnosis</div>
                    </div>
                  </div>

                  <div className="flex items-center space-x-2">
                    {/* Severity Badge */}
                    <span
                      className={`px-2.5 py-0.5 rounded text-[11px] font-bold uppercase font-mono ${
                        diagnosis.severity === 'critical'
                          ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                          : diagnosis.severity === 'high'
                          ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                          : 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                      }`}
                    >
                      {diagnosis.severity}
                    </span>

                    {/* Confidence */}
                    <span className="text-[11px] font-mono text-slate-400 bg-forge-950 px-2 py-0.5 rounded border border-white/[0.08]">
                      {Math.round(diagnosis.confidence * 100)}% Confidence
                    </span>

                    <button
                      onClick={() => handleDiagnose(true)}
                      className="p-1 text-slate-400 hover:text-slate-200"
                      title="Force refresh diagnosis"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* AMBIGUOUS DELIVERY WARNING BANNER */}
                {diagnosis.ambiguous_delivery_warning && (
                  <div className="bg-amber-950/60 border border-amber-600/70 p-3.5 rounded-xl text-xs text-amber-200 flex items-start space-x-3">
                    <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-bold text-amber-300">Ambiguous Delivery Warning:</span> Connection timed out or dropped after request transmission. Downstream merchant endpoint may have executed this webhook without returning a response. Verify idempotency with merchant before replaying to prevent duplicate mutations!
                    </div>
                  </div>
                )}

                {/* Fault Domain & Root Cause */}
                <div className="bg-forge-950 p-4 rounded-xl border border-white/[0.08] space-y-2">
                  <div className="flex items-center space-x-2 text-xs">
                    <span className="text-slate-400 font-semibold uppercase tracking-wider text-[10px]">
                      Fault Domain:
                    </span>
                    <span className="font-mono text-indigo-300 bg-indigo-950/60 px-2 py-0.5 rounded border border-indigo-900 text-[11px]">
                      {diagnosis.fault_domain}
                    </span>
                  </div>
                  <p className="text-xs text-slate-200 leading-relaxed">
                    {diagnosis.root_cause_explanation}
                  </p>
                </div>

                {/* Recommended Actions */}
                {Array.isArray(diagnosis.recommended_operator_actions) && diagnosis.recommended_operator_actions.length > 0 && (
                  <div className="space-y-1.5">
                    <h5 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                      Recommended Remediation Actions
                    </h5>
                    <ul className="space-y-1 text-xs text-slate-300">
                      {diagnosis.recommended_operator_actions.map((act, idx) => (
                        <li key={idx} className="flex items-start space-x-2 bg-forge-950 p-2.5 rounded-lg border border-white/[0.06]">
                          <span className="text-emerald-400 font-bold">✓</span>
                          <span>{act}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Suggested Policy Adjustment */}
                {diagnosis.suggested_policy_adjustment && (
                  <div className="bg-forge-950 p-3.5 rounded-xl border border-white/[0.08] space-y-1.5">
                    <div className="text-xs font-semibold text-indigo-300 flex items-center space-x-1.5">
                      <Sliders className="w-3.5 h-3.5" />
                      <span>Suggested Policy Adjustment</span>
                    </div>
                    {typeof diagnosis.suggested_policy_adjustment === 'object' ? (
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono">
                        {Object.entries(diagnosis.suggested_policy_adjustment).map(([key, val]) => (
                          <div key={key} className="bg-forge-900 p-2 rounded-lg border border-white/[0.06]">
                            <div className="text-[10px] text-slate-400 uppercase">{key.replace('_', ' ')}</div>
                            <div className="text-slate-200 font-bold mt-0.5">{String(val)}</div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-slate-300 font-mono">
                        {String(diagnosis.suggested_policy_adjustment)}
                      </p>
                    )}
                  </div>
                )}

                {/* Merchant Issue Report (Copyable) */}
                {diagnosis.merchant_issue_summary && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <h5 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                        Merchant Issue Communication Summary
                      </h5>
                      <button
                        onClick={handleCopyMerchantReport}
                        className="text-xs text-indigo-300 hover:text-indigo-200 flex items-center space-x-1"
                      >
                        {reportCopied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{reportCopied ? 'Copied' : 'Copy Report'}</span>
                      </button>
                    </div>
                    <textarea
                      readOnly
                      rows={3}
                      value={diagnosis.merchant_issue_summary}
                      className="w-full p-2.5 bg-forge-950 border border-white/[0.08] rounded-lg text-xs font-mono text-slate-300 select-all focus:outline-none"
                    />
                  </div>
                )}
              </div>
            ) : null}

            {/* Dead Letter Panel (if applicable) */}
            {delivery.dead_letter && (
              <div className="bg-purple-950/30 border border-purple-800/60 p-4 rounded-xl space-y-2">
                <div className="flex items-center space-x-2 text-purple-300 text-xs font-bold uppercase tracking-wider">
                  <ShieldAlert className="w-4 h-4 text-purple-400" />
                  <span>Dead Letter Queue Record</span>
                </div>
                <div className="text-xs text-slate-300">
                  <span className="text-slate-400 font-medium">Exhaustion Reason:</span> {delivery.dead_letter.reason}
                </div>
                <div className="text-xs text-slate-300">
                  <span className="text-slate-400 font-medium">Final Error:</span>{' '}
                  <span className="font-mono text-rose-300">{delivery.dead_letter.final_error}</span>
                </div>
                <div className="text-[11px] text-slate-400 font-mono">
                  Failed at: {new Date(delivery.dead_letter.failed_at).toLocaleString()}
                </div>
              </div>
            )}

            {/* Original Event Payload */}
            <div className="card-surface p-4 border border-white/[0.08] space-y-2">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center space-x-1.5">
                  <Code className="w-3.5 h-3.5 text-brand-400" />
                  <span>Original Event Payload ({delivery.event_type})</span>
                </h4>
                <button
                  onClick={handleCopyPayload}
                  className="text-xs text-slate-400 hover:text-slate-200 flex items-center space-x-1"
                >
                  {payloadCopied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  <span>{payloadCopied ? 'Copied' : 'Copy JSON'}</span>
                </button>
              </div>
              <pre className="p-3 bg-forge-950 border border-white/[0.08] rounded-xl text-xs font-mono text-slate-300 overflow-x-auto max-h-48 leading-relaxed">
                {JSON.stringify(delivery.payload, null, 2)}
              </pre>
            </div>

            {/* Chronological Attempts Timeline */}
            <div className="space-y-3">
              <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center space-x-1.5">
                <Clock className="w-3.5 h-3.5 text-sky-400" />
                <span>Delivery Attempts History ({delivery.attempts?.length || 0} attempts)</span>
              </h4>

              {Array.isArray(delivery.attempts) && delivery.attempts.length > 0 ? (
                <div className="space-y-3">
                  {delivery.attempts.map((att) => (
                    <div
                      key={att.id}
                      className="card-surface p-4 space-y-3 border border-white/[0.08]"
                    >
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <div className="flex items-center space-x-2">
                          <span className="font-bold text-xs text-slate-100">
                            Attempt #{att.attempt_number}
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                              att.http_status && att.http_status >= 200 && att.http_status < 300
                                ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                                : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                            }`}
                          >
                            HTTP {att.http_status ?? 'No Response'}
                          </span>
                          {att.failure_class && (
                            <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-forge-950 text-amber-300 border border-amber-500/25">
                              {att.failure_class}
                            </span>
                          )}
                        </div>

                        <div className="flex items-center space-x-3 text-xs text-slate-400 font-mono">
                          {att.latency_ms !== null && <span>{att.latency_ms} ms</span>}
                          <span>{new Date(att.created_at).toLocaleTimeString()}</span>
                        </div>
                      </div>

                      {/* Request Headers */}
                      {att.request_headers && Object.keys(att.request_headers).length > 0 && (
                        <div className="bg-forge-950 p-2.5 rounded-lg border border-white/[0.05] text-[11px] font-mono space-y-1">
                          <span className="text-[10px] text-slate-400 uppercase font-sans font-semibold block">
                            Dispatched Headers:
                          </span>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 text-slate-300">
                            {Object.entries(att.request_headers).map(([k, v]) => (
                              <div key={k} className="truncate">
                                <span className="text-slate-500">{k}:</span> {v}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Response Excerpt if present */}
                      {att.response_body_excerpt && (
                        <div className="bg-forge-950 p-2.5 rounded-lg border border-white/[0.05] text-xs font-mono text-slate-300 overflow-x-auto">
                          <div className="text-[10px] text-slate-400 uppercase font-sans mb-1 font-semibold">
                            Response Excerpt:
                          </div>
                          <div className="break-all">{att.response_body_excerpt}</div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-slate-400 p-6 text-center card-surface border border-white/[0.06]">
                  No delivery attempts dispatched yet. Lease is pending or scheduled for future retry.
                </div>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};
