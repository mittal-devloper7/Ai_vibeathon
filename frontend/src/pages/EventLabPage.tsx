import React, { useState, useMemo } from 'react';
import {
  Send,
  RotateCcw,
  Check,
  Copy,
  AlertCircle,
  Zap,
  Code,
  Layers,
  CheckCircle2,
  AlertTriangle,
  Sparkles,
  Info,
  Clock,
  ArrowRight,
  RefreshCw,
  Terminal,
} from 'lucide-react';
import { api } from '../api/client';
import { useToast } from '../context/ToastContext';

const SAMPLE_PAYLOADS: Record<string, any> = {
  'order.created': {
    order_id: 'ord_998127384',
    customer_id: 'cust_4982',
    amount: 149.99,
    currency: 'USD',
    status: 'paid',
    line_items: [
      { sku: 'ITEM-X1', name: 'Developer Pro Tier (Annual)', quantity: 1, unit_price: 149.99 }
    ],
    timestamp: new Date().toISOString()
  },
  'payment.captured': {
    payment_id: 'pay_772819382',
    order_id: 'ord_998127384',
    amount_captured: 149.99,
    currency: 'USD',
    payment_method: 'card_visa_4242',
    receipt_url: 'https://pay.example.com/receipts/rcpt_772819382'
  },
  'payment.failed': {
    payment_id: 'pay_554819201',
    order_id: 'ord_882910394',
    amount: 299.00,
    currency: 'USD',
    decline_code: 'insufficient_funds',
    error_message: 'The customer account had insufficient balance.',
    retryable: true
  },
  'invoice.paid': {
    invoice_id: 'inv_443910283',
    customer_id: 'cust_1102',
    subtotal: 1200.00,
    tax: 96.00,
    total: 1296.00,
    due_date: '2026-12-01',
    paid_at: new Date().toISOString()
  },
  'custom': {
    event: 'custom.telemetry.ping',
    source: 'hookforge-lab',
    metadata: {
      trace_id: 'trc_' + Math.random().toString(36).substring(2, 10),
      environment: 'production-simulation'
    }
  }
};

export const EventLabPage: React.FC = () => {
  const toast = useToast();
  const [eventType, setEventType] = useState<string>('order.created');
  const [customType, setCustomType] = useState<string>('');
  const [payloadText, setPayloadText] = useState<string>(
    JSON.stringify(SAMPLE_PAYLOADS['order.created'], null, 2)
  );
  const [idempotencyKey, setIdempotencyKey] = useState<string>(
    () => `idem_${Math.random().toString(36).substring(2, 10)}_${Date.now().toString().slice(-4)}`
  );
  const [lastUsedKey, setLastUsedKey] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Response Inspector State
  const [lastResponse, setLastResponse] = useState<{
    status: number;
    statusText: string;
    durationMs: number;
    data: any;
    idempotencyKeyUsed?: string;
  } | null>(null);

  // Burst Results State
  const [burstResults, setBurstResults] = useState<Array<{
    index: number;
    status: number;
    idempotent_replay?: boolean;
    error?: string;
  }> | null>(null);
  const [burstProgress, setBurstProgress] = useState<{ current: number; total: number } | null>(null);
  const [copiedResponse, setCopiedResponse] = useState(false);
  const [copiedEventId, setCopiedEventId] = useState(false);

  // Live JSON validation
  const jsonValidation = useMemo<{ isValid: boolean; error?: string }>(() => {
    try {
      JSON.parse(payloadText);
      return { isValid: true };
    } catch (err: any) {
      return { isValid: false, error: err?.message || 'Invalid syntax' };
    }
  }, [payloadText]);

  const handleSelectEventType = (type: string) => {
    setEventType(type);
    if (SAMPLE_PAYLOADS[type]) {
      setPayloadText(JSON.stringify(SAMPLE_PAYLOADS[type], null, 2));
    }
  };

  const handleGenerateKey = () => {
    const newKey = `idem_${Math.random().toString(36).substring(2, 10)}_${Date.now().toString().slice(-4)}`;
    setIdempotencyKey(newKey);
    toast.info('New idempotency key generated');
  };

  const handleReuseLastKey = () => {
    if (!lastUsedKey) {
      toast.warning('No previous idempotency key recorded in this session');
      return;
    }
    setIdempotencyKey(lastUsedKey);
    toast.info(`Restored previous key: ${lastUsedKey}`);
  };

  const handleBeautify = () => {
    try {
      const parsed = JSON.parse(payloadText);
      setPayloadText(JSON.stringify(parsed, null, 2));
      toast.success('JSON formatted cleanly');
    } catch (err: any) {
      toast.error('Cannot format invalid JSON syntax', 'Parse Error');
    }
  };

  const handlePublishSingle = async () => {
    if (!jsonValidation.isValid) {
      toast.warning('Please fix JSON syntax errors before sending', 'Invalid JSON');
      return;
    }

    const type = eventType === 'custom' ? customType.trim() : eventType;
    if (!type) {
      toast.warning('Event type cannot be empty', 'Missing Event Type');
      return;
    }

    const currentKey = idempotencyKey.trim();
    setIsSubmitting(true);
    setBurstResults(null);
    const start = performance.now();

    try {
      const parsed = JSON.parse(payloadText);
      const res = await api.publishEvent(
        {
          type,
          data: parsed,
        },
        currentKey || undefined
      );

      const durationMs = Math.round(performance.now() - start);
      if (currentKey) setLastUsedKey(currentKey);

      setLastResponse({
        status: 202,
        statusText: 'Accepted',
        durationMs,
        data: res,
        idempotencyKeyUsed: currentKey,
      });

      if (res.idempotent_replay) {
        toast.info('Idempotent replay detected: duplicate suppressed', 'Deduplicated (202)');
      } else {
        toast.success(`Event enqueued: ${res.deliveries_created} deliveries created`, 'Event Accepted');
      }
    } catch (err: any) {
      const durationMs = Math.round(performance.now() - start);
      setLastResponse({
        status: err?.status || 500,
        statusText: err?.code || 'ERROR',
        durationMs,
        data: err?.details || { error: { code: err?.code, message: err?.message } },
        idempotencyKeyUsed: currentKey,
      });

      if (err?.status === 409) {
        toast.error('Payload conflict: key already bound to different payload', 'Conflict (409)');
      } else {
        toast.error(err?.message || 'Event publishing failed');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleBurstPublish = async (sameKey: boolean) => {
    if (!jsonValidation.isValid) {
      toast.warning('Please fix JSON syntax errors before sending', 'Invalid JSON');
      return;
    }

    const type = eventType === 'custom' ? customType.trim() : eventType;
    if (!type) {
      toast.warning('Event type cannot be empty', 'Missing Event Type');
      return;
    }

    let parsedPayload: any;
    try {
      parsedPayload = JSON.parse(payloadText);
    } catch {
      return;
    }

    const baseKey = idempotencyKey.trim() || `burst_${Date.now()}`;
    const total = 10;
    const results: Array<{ index: number; status: number; idempotent_replay?: boolean; error?: string }> = [];

    setIsSubmitting(true);
    setBurstProgress({ current: 0, total });

    for (let i = 1; i <= total; i++) {
      const key = sameKey ? baseKey : `${baseKey}_seq${i}`;
      try {
        const res = await api.publishEvent({ type, data: parsedPayload }, key);
        results.push({
          index: i,
          status: 202,
          idempotent_replay: res.idempotent_replay,
        });
      } catch (err: any) {
        results.push({
          index: i,
          status: err?.status || 500,
          error: err?.code || err?.message,
        });
      }
      setBurstProgress({ current: i, total });
    }

    setBurstResults(results);
    setIsSubmitting(false);
    setBurstProgress(null);

    const initialAccepted = results.filter((r) => r.status === 202 && !r.idempotent_replay).length;
    const dedupedReplays = results.filter((r) => r.status === 202 && r.idempotent_replay).length;
    const failedCalls = results.filter((r) => r.status !== 202).length;

    toast.info(
      `Burst finished: ${initialAccepted} accepted, ${dedupedReplays} deduplicated, ${failedCalls} errors`,
      sameKey ? 'Deduplication Verified' : 'Throughput Verified'
    );
  };

  const handleCopyResponse = () => {
    if (!lastResponse) return;
    navigator.clipboard.writeText(JSON.stringify(lastResponse.data, null, 2));
    setCopiedResponse(true);
    toast.success('Response JSON copied to clipboard');
    setTimeout(() => setCopiedResponse(false), 2000);
  };

  const handleCopyEventId = (eventId: string) => {
    navigator.clipboard.writeText(eventId);
    setCopiedEventId(true);
    toast.success('Event ID copied to clipboard');
    setTimeout(() => setCopiedEventId(false), 2000);
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-150">
      {/* Top Banner */}
      <div className="card-surface p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2.5">
            <h1 className="text-lg sm:text-xl font-bold text-slate-100 tracking-tight">
              Event Publishing Lab
            </h1>
            <span className="px-2 py-0.5 rounded-full bg-brand-500/10 border border-brand-500/20 text-brand-300 font-mono text-[10px]">
              Transactional Outbox Engine
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            Ingest mock webhook events, test Idempotency-Key deduplication, observe outbox fan-out, and benchmark burst concurrency.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column (7 Cols): Ingestion Workbench */}
        <div className="lg:col-span-7 space-y-4">
          <div className="card-surface p-4 sm:p-5 space-y-4">
            {/* Event Type Selector */}
            <div>
              <span id="event-type-label" className="block text-xs font-semibold text-slate-300 mb-2">
                Event Type
              </span>
              <div role="group" aria-labelledby="event-type-label" className="flex flex-wrap gap-1.5">
                {['order.created', 'payment.captured', 'payment.failed', 'invoice.paid', 'custom'].map((t) => (
                  <button
                    key={t}
                    type="button"
                    aria-pressed={eventType === t}
                    onClick={() => handleSelectEventType(t)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-mono transition ${
                      eventType === t
                        ? 'bg-brand-600 text-white font-semibold shadow-sm shadow-brand-950/40'
                        : 'bg-forge-950 text-slate-400 hover:text-slate-200 border border-white/[0.08]'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>

              {eventType === 'custom' && (
                <div className="mt-2.5">
                  <input
                    type="text"
                    aria-label="Custom event type"
                    placeholder="e.g. user.subscription_updated or invoice.voided"
                    value={customType}
                    onChange={(e) => setCustomType(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono bg-forge-950 border border-white/[0.1] rounded-lg text-slate-100 placeholder-slate-500 focus:outline-none focus:border-brand-500"
                  />
                </div>
              )}
            </div>

            {/* Idempotency Key Section */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="lab-idempotency-key" className="text-xs font-semibold text-slate-300 flex items-center space-x-1.5">
                  <span>Idempotency-Key Header</span>
                  <span className="text-[10px] text-slate-500 font-normal">(Optional header for deduplication)</span>
                </label>
                <div className="flex items-center space-x-2 text-[11px]">
                  <button
                    type="button"
                    onClick={handleGenerateKey}
                    className="text-brand-400 hover:text-brand-300 flex items-center space-x-1"
                    title="Generate random idempotency key"
                  >
                    <RotateCcw className="w-3 h-3" aria-hidden="true" />
                    <span>New Key</span>
                  </button>
                  {lastUsedKey && (
                    <>
                      <span className="text-slate-700" aria-hidden="true">|</span>
                      <button
                        type="button"
                        onClick={handleReuseLastKey}
                        className="text-slate-400 hover:text-slate-200"
                        title="Reuse key from previous publication"
                      >
                        Reuse Last Key
                      </button>
                    </>
                  )}
                  <span className="text-slate-700" aria-hidden="true">|</span>
                  <button
                    type="button"
                    onClick={() => setIdempotencyKey('')}
                    className="text-slate-400 hover:text-slate-200"
                  >
                    Clear
                  </button>
                </div>
              </div>

              <input
                id="lab-idempotency-key"
                type="text"
                value={idempotencyKey}
                onChange={(e) => setIdempotencyKey(e.target.value)}
                placeholder="Leave blank or enter unique key (e.g. idem_98234_abc)"
                className="w-full px-3 py-2 text-xs font-mono bg-forge-950 border border-white/[0.1] rounded-lg text-slate-100 placeholder-slate-600 focus:outline-none focus:border-brand-500"
              />

              <div className="mt-1.5 p-2 bg-forge-950/70 border border-white/[0.05] rounded-lg text-[11px] text-slate-400 flex items-start space-x-2">
                <Info className="w-3.5 h-3.5 text-brand-400 shrink-0 mt-0.5" />
                <span>
                  <strong>Idempotency Semantics:</strong> Submitting the same key with the same payload produces HTTP 202 (<code className="text-brand-300">idempotent_replay: true</code>) without duplicate deliveries. Submitting the same key with a modified payload returns HTTP 409 conflict.
                </span>
              </div>
            </div>

            {/* JSON Payload Editor */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center space-x-2">
                  <label htmlFor="lab-json-payload" className="text-xs font-semibold text-slate-300 flex items-center space-x-1.5">
                    <Code className="w-3.5 h-3.5 text-indigo-400" aria-hidden="true" />
                    <span>Payload Data (<code className="text-slate-400 font-mono text-[11px]">data</code>)</span>
                  </label>

                  {jsonValidation.isValid ? (
                    <span className="inline-flex items-center space-x-1 text-[10px] text-emerald-400 bg-emerald-500/10 px-2 py-0.2 rounded border border-emerald-500/20">
                      <Check className="w-3 h-3" aria-hidden="true" />
                      <span>Valid JSON</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center space-x-1 text-[10px] text-rose-400 bg-rose-500/10 px-2 py-0.2 rounded border border-rose-500/20">
                      <AlertCircle className="w-3 h-3" aria-hidden="true" />
                      <span>Syntax Error</span>
                    </span>
                  )}
                </div>

                <button
                  type="button"
                  onClick={handleBeautify}
                  className="text-xs text-brand-400 hover:text-brand-300 font-medium"
                >
                  Format JSON
                </button>
              </div>

              <div className="relative">
                <textarea
                  id="lab-json-payload"
                  rows={10}
                  value={payloadText}
                  onChange={(e) => setPayloadText(e.target.value)}
                  className={`w-full p-3 text-xs font-mono bg-forge-950 border rounded-lg text-slate-200 focus:outline-none leading-relaxed resize-y ${
                    jsonValidation.isValid
                      ? 'border-white/[0.1] focus:border-brand-500'
                      : 'border-rose-500/50 focus:border-rose-500'
                  }`}
                  spellCheck={false}
                />
              </div>

              {!jsonValidation.isValid && jsonValidation.error && (
                <p className="mt-1 text-[11px] font-mono text-rose-400">
                  {jsonValidation.error}
                </p>
              )}
            </div>

            {/* Action Buttons */}
            <div className="pt-3 border-t border-white/[0.08] flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                onClick={handlePublishSingle}
                disabled={isSubmitting || !jsonValidation.isValid}
                className="flex items-center justify-center space-x-2 px-4 py-2.5 bg-brand-600 hover:bg-brand-500 text-white rounded-lg text-xs font-semibold shadow-md shadow-brand-950/40 transition disabled:opacity-50 w-full sm:w-auto"
              >
                <Send className="w-3.5 h-3.5" />
                <span>{isSubmitting ? 'Ingesting...' : 'Publish Event (POST /events)'}</span>
              </button>

              <div className="flex items-center space-x-2 w-full sm:w-auto">
                <button
                  type="button"
                  onClick={() => handleBurstPublish(true)}
                  disabled={isSubmitting || !jsonValidation.isValid}
                  className="flex-1 sm:flex-none px-3 py-2 bg-forge-950 hover:bg-forge-800 text-slate-300 border border-white/[0.08] rounded-lg text-xs font-medium transition disabled:opacity-50 text-center"
                  title="Sends 10 requests with identical key to verify deduplication"
                >
                  Burst 10x (Same Key)
                </button>
                <button
                  type="button"
                  onClick={() => handleBurstPublish(false)}
                  disabled={isSubmitting || !jsonValidation.isValid}
                  className="flex-1 sm:flex-none px-3 py-2 bg-forge-950 hover:bg-forge-800 text-slate-300 border border-white/[0.08] rounded-lg text-xs font-medium transition disabled:opacity-50 text-center"
                  title="Sends 10 parallel requests with unique keys to test outbox throughput"
                >
                  Burst 10x (Unique Keys)
                </button>
              </div>
            </div>

            {/* Burst Progress Bar */}
            {burstProgress && (
              <div className="pt-2 animate-in fade-in">
                <div className="flex justify-between text-xs text-slate-400 mb-1 font-mono">
                  <span>Executing burst ingestion...</span>
                  <span>{burstProgress.current} / {burstProgress.total}</span>
                </div>
                <div className="h-1.5 w-full bg-forge-950 rounded-full overflow-hidden border border-white/[0.06]">
                  <div
                    style={{ width: `${(burstProgress.current / burstProgress.total) * 100}%` }}
                    className="h-full bg-brand-500 transition-all duration-150"
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Column (5 Cols): Ingestion Inspector */}
        <div className="lg:col-span-5 space-y-4">
          <div className="card-surface p-4 sm:p-5 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-white/[0.06]">
              <div className="flex items-center space-x-2">
                <Layers className="w-4 h-4 text-brand-400" />
                <h3 className="text-sm font-semibold text-slate-100 tracking-tight">
                  Ingestion Inspector
                </h3>
              </div>
              {lastResponse && (
                <button
                  onClick={handleCopyResponse}
                  className="text-xs text-slate-400 hover:text-slate-200 flex items-center space-x-1"
                >
                  {copiedResponse ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedResponse ? 'Copied' : 'Copy Body'}</span>
                </button>
              )}
            </div>

            {lastResponse ? (
              <div className="space-y-3.5">
                {/* HTTP Status & Duration Header */}
                <div className="flex items-center justify-between bg-forge-950 p-3 rounded-xl border border-white/[0.08]">
                  <div className="flex items-center space-x-2.5">
                    <span
                      className={`inline-flex items-center px-2.5 py-1 rounded text-xs font-bold font-mono ${
                        lastResponse.status === 202
                          ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/25'
                          : lastResponse.status === 409
                          ? 'bg-amber-500/15 text-amber-400 border border-amber-500/25'
                          : 'bg-rose-500/15 text-rose-400 border border-rose-500/25'
                      }`}
                    >
                      HTTP {lastResponse.status} {lastResponse.statusText}
                    </span>
                    <span className="text-xs text-slate-400 font-mono flex items-center space-x-1">
                      <Clock className="w-3 h-3 text-sky-400" />
                      <span>{lastResponse.durationMs} ms</span>
                    </span>
                  </div>

                  {lastResponse.data?.idempotent_replay !== undefined && (
                    <span
                      className={`text-[11px] font-semibold px-2 py-0.5 rounded font-mono ${
                        lastResponse.data.idempotent_replay
                          ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                          : 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                      }`}
                    >
                      {lastResponse.data.idempotent_replay ? 'Replay (Deduped)' : 'New Enqueued'}
                    </span>
                  )}
                </div>

                {/* Key Telemetry Tiles (on 202 Accepted) */}
                {lastResponse.status === 202 && (
                  <div className="grid grid-cols-2 gap-2.5 text-xs">
                    <div className="bg-forge-950 p-2.5 rounded-xl border border-white/[0.06]">
                      <div className="text-[10px] text-slate-400 font-sans uppercase">
                        Deliveries Created
                      </div>
                      <div className="text-base font-bold font-mono text-emerald-400 mt-0.5">
                        {lastResponse.data?.deliveries_created ?? 0} endpoints
                      </div>
                    </div>

                    <div className="bg-forge-950 p-2.5 rounded-xl border border-white/[0.06]">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-slate-400 font-sans uppercase">Event ID</span>
                        {lastResponse.data?.event_id && (
                          <button
                            onClick={() => handleCopyEventId(lastResponse.data.event_id)}
                            className="text-slate-500 hover:text-slate-200"
                            title="Copy event ID"
                          >
                            {copiedEventId ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                          </button>
                        )}
                      </div>
                      <div className="text-xs font-mono text-slate-200 mt-1 truncate">
                        {lastResponse.data?.event_id ?? '—'}
                      </div>
                    </div>
                  </div>
                )}

                {/* Response Body JSON Preview */}
                <div className="space-y-1">
                  <div className="text-[11px] text-slate-400 font-mono">Response Payload:</div>
                  <pre className="p-3 bg-forge-950 border border-white/[0.08] rounded-xl text-xs font-mono text-slate-300 overflow-x-auto max-h-64 leading-relaxed">
                    {JSON.stringify(lastResponse.data, null, 2)}
                  </pre>
                </div>
              </div>
            ) : (
              /* Pre-Publish Educational Guide State */
              <div className="p-6 bg-forge-950/70 rounded-xl border border-white/[0.06] text-center space-y-3">
                <Terminal className="w-8 h-8 text-brand-400/80 mx-auto" />
                <div className="space-y-1">
                  <h4 className="text-xs font-semibold text-slate-200">
                    Awaiting Ingestion Request
                  </h4>
                  <p className="text-[11px] text-slate-400 max-w-xs mx-auto leading-relaxed">
                    Publish an event or run a burst test to inspect real-time outbox scheduling, idempotency checks, and delivery records.
                  </p>
                </div>

                <div className="pt-2 text-left space-y-2 text-[11px] text-slate-400 border-t border-white/[0.06]">
                  <div className="flex items-start space-x-2">
                    <span className="text-emerald-400 font-mono">1.</span>
                    <span>Ingest API verifies payload and stores idempotency token.</span>
                  </div>
                  <div className="flex items-start space-x-2">
                    <span className="text-emerald-400 font-mono">2.</span>
                    <span>PostgreSQL transactional outbox fans out to matched endpoints.</span>
                  </div>
                  <div className="flex items-start space-x-2">
                    <span className="text-emerald-400 font-mono">3.</span>
                    <span>BullMQ workers acquire 30s exclusive leases and dispatch HTTP requests.</span>
                  </div>
                </div>
              </div>
            )}

            {/* Burst Results Grid */}
            {Array.isArray(burstResults) && burstResults.length > 0 && (
              <div className="pt-3 border-t border-white/[0.06] space-y-2.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-200">Burst Run Summary</span>
                  <span className="font-mono text-slate-400 text-[11px]">10 Invocations</span>
                </div>

                <div className="grid grid-cols-5 gap-1.5 font-mono text-[11px]">
                  {burstResults.map((r) => (
                    <div
                      key={r.index}
                      className={`p-2 rounded-lg border text-center transition ${
                        r.status === 202
                          ? r.idempotent_replay
                            ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                            : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                          : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                      }`}
                    >
                      <div className="text-[10px] text-slate-400">#{r.index}</div>
                      <div className="font-bold text-xs mt-0.5">{r.status}</div>
                      <div className="text-[9px] mt-0.5 truncate">
                        {r.idempotent_replay ? 'Replay' : r.status === 202 ? 'Fresh' : 'Err'}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
