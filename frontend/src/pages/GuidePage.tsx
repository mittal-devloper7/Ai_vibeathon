import React, { useState } from 'react';
import {
  BookOpen,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  ArrowLeft,
  Copy,
  Check,
  Radio,
  Send,
  Layers,
  ShieldCheck,
  ShieldAlert,
  Zap,
  Clock,
  Terminal,
  Database,
  Cpu,
  Sparkles,
  ChevronRight,
  HelpCircle,
  ExternalLink,
  Code,
  Sliders,
  RotateCcw,
  AlertCircle,
  Server,
  Key,
} from 'lucide-react';
import { useToast } from '../context/ToastContext';
import { TabType } from '../components/Header';

interface GuidePageProps {
  onNavigate?: (tab: TabType) => void;
}

interface CodeSnippetProps {
  code: string;
  language?: string;
  title?: string;
}

const CodeSnippet: React.FC<CodeSnippetProps> = ({ code, language = 'json', title }) => {
  const toast = useToast();
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    toast.success('Snippet copied to clipboard');
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="rounded-xl overflow-hidden border border-white/[0.08] bg-forge-950 my-3 font-mono text-xs">
      <div className="px-3.5 py-2 bg-forge-900 border-b border-white/[0.06] flex items-center justify-between">
        <span className="text-[11px] text-slate-400 font-sans font-medium">
          {title || language.toUpperCase()}
        </span>
        <button
          onClick={handleCopy}
          className="text-slate-400 hover:text-slate-200 flex items-center space-x-1 text-[11px] font-sans transition"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      <pre className="p-3.5 overflow-x-auto text-slate-200 leading-relaxed max-h-72">
        {code}
      </pre>
    </div>
  );
};

export const GuidePage: React.FC<GuidePageProps> = ({ onNavigate }) => {
  const [currentChapter, setCurrentChapter] = useState<number>(1);

  const chapters = [
    { id: 1, title: 'Introduction', subtitle: 'How Webhooks Work & Why HookForge Exists', icon: Database },
    { id: 2, title: 'Getting Started', subtitle: 'Adding Your First Webhook URL', icon: Radio },
    { id: 3, title: 'Publishing Events', subtitle: 'Sending Messages & Receipt IDs', icon: Send },
    { id: 4, title: 'Understanding Deliveries', subtitle: 'Jobs, Attempts & Status Colors', icon: Layers },
    { id: 5, title: 'Reliability Engine', subtitle: 'Smart Retries, Jitter & Circuit Breakers', icon: Zap },
    { id: 6, title: 'Replay & Recovery', subtitle: 'Fixing Failures with AI & Replaying', icon: RotateCcw },
    { id: 7, title: 'Troubleshooting Playbook', subtitle: 'Simple Fixes for Common Problems', icon: ShieldAlert },
  ];

  const activeChapterInfo = chapters.find((c) => c.id === currentChapter) || chapters[0]!;

  return (
    <div className="space-y-6 animate-in fade-in duration-150">
      {/* Guide Header Banner */}
      <div className="card-surface p-5 sm:p-6 border border-white/[0.08] relative overflow-hidden">
        <div className="absolute top-0 right-0 w-80 h-80 bg-brand-500/10 rounded-full blur-3xl pointer-events-none -mr-20 -mt-20" />
        <div className="relative z-10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center space-x-2 px-2.5 py-0.5 rounded-full bg-brand-500/10 border border-brand-500/25 text-brand-300 text-xs font-mono mb-2">
              <BookOpen className="w-3.5 h-3.5" />
              <span>HookForge Beginner Guide & Handbook</span>
            </div>
            <h1 className="text-xl sm:text-2xl font-bold text-slate-100 tracking-tight">
              Interactive Webhook Guide & Handbook
            </h1>
            <p className="text-xs text-slate-300 mt-1 max-w-2xl leading-relaxed">
              Learn how webhooks work, how HookForge guarantees messages never get lost, and how to test, debug, and recover failed events with step-by-step guides.
            </p>
          </div>

          <div className="flex items-center space-x-3 shrink-0">
            <span className="text-xs font-mono text-slate-400">
              Chapter <strong className="text-brand-300">{currentChapter}</strong> of {chapters.length}
            </span>
            <div className="w-24 h-2 bg-forge-950 rounded-full overflow-hidden border border-white/[0.08]">
              <div
                style={{ width: `${(currentChapter / chapters.length) * 100}%` }}
                className="h-full bg-brand-500 transition-all duration-300"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Main Grid: Sidebar + Chapter Content */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Navigation Sidebar (4 Cols) */}
        <div className="lg:col-span-4 space-y-2">
          {/* Mobile Chapter Selector */}
          <div className="lg:hidden card-surface p-3 border border-white/[0.08]">
            <label className="block text-xs font-semibold text-slate-400 mb-1">
              Select Handbook Chapter:
            </label>
            <select
              value={currentChapter}
              onChange={(e) => setCurrentChapter(Number(e.target.value))}
              className="w-full px-3 py-2 text-xs font-medium bg-forge-950 border border-white/[0.1] rounded-lg text-slate-100 focus:outline-none focus:border-brand-500"
            >
              {chapters.map((ch) => (
                <option key={ch.id} value={ch.id}>
                  Ch. {ch.id}: {ch.title}
                </option>
              ))}
            </select>
          </div>

          {/* Desktop Sticky Chapters List */}
          <div className="hidden lg:block card-surface p-3 space-y-1 border border-white/[0.08] sticky top-20">
            <div className="px-3 py-2 text-[11px] font-semibold text-slate-400 uppercase tracking-wider border-b border-white/[0.06] mb-1">
              Handbook Chapters
            </div>
            {chapters.map((ch) => {
              const Icon = ch.icon;
              const isActive = ch.id === currentChapter;
              return (
                <button
                  key={ch.id}
                  onClick={() => setCurrentChapter(ch.id)}
                  className={`w-full flex items-center space-x-3 p-2.5 rounded-xl text-left transition-all duration-150 ${
                    isActive
                      ? 'bg-forge-800 text-brand-300 border border-brand-500/30 shadow-sm'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-forge-850/60'
                  }`}
                >
                  <div
                    className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 border ${
                      isActive
                        ? 'bg-brand-500/15 border-brand-500/30 text-brand-400'
                        : 'bg-forge-950 border-white/[0.06] text-slate-500'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold truncate tracking-tight text-slate-200">
                      {ch.id}. {ch.title}
                    </div>
                    <div className="text-[10px] text-slate-400 truncate">
                      {ch.subtitle}
                    </div>
                  </div>
                  {isActive && <ChevronRight className="w-3.5 h-3.5 text-brand-400 shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>

        {/* Right Content Pane (8 Cols) */}
        <div className="lg:col-span-8 space-y-6">
          <div className="card-surface p-6 sm:p-7 border border-white/[0.08] space-y-6">
            {/* Chapter Header */}
            <div className="pb-4 border-b border-white/[0.08] flex items-center justify-between">
              <div className="space-y-1">
                <div className="text-xs font-mono font-semibold text-brand-400 uppercase tracking-wider">
                  CHAPTER {activeChapterInfo.id}
                </div>
                <h2 className="text-xl font-bold text-slate-100 tracking-tight">
                  {activeChapterInfo.title}
                </h2>
                <p className="text-xs text-slate-400">
                  {activeChapterInfo.subtitle}
                </p>
              </div>

              <div className="w-10 h-10 rounded-xl bg-brand-500/10 border border-brand-500/25 flex items-center justify-center text-brand-400 shrink-0">
                <activeChapterInfo.icon className="w-5 h-5" />
              </div>
            </div>

            {/* CHAPTER 1: INTRODUCTION */}
            {currentChapter === 1 && (
              <div className="space-y-5 text-xs text-slate-300 leading-relaxed">
                {/* In Simple Words Callout Box */}
                <div className="p-3.5 bg-brand-500/10 border border-brand-500/25 rounded-xl space-y-1">
                  <span className="text-xs font-bold text-brand-300 uppercase tracking-wider flex items-center space-x-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-brand-400" />
                    <span>In Simple Words</span>
                  </span>
                  <p className="text-xs text-slate-200 leading-relaxed">
                    A webhook is like an automatic text message sent to an app whenever something happens, such as when a customer pays for an order. HookForge makes sure these alerts never get lost, even if a computer crashes or the internet hiccups.
                  </p>
                </div>

                <div>
                  <h3 className="text-sm font-semibold text-slate-100 mb-1.5 flex items-center space-x-2">
                    <Zap className="w-4 h-4 text-brand-400" />
                    <span>The Problem: Why Normal Webhooks Fail</span>
                  </h3>
                  <p>
                    Imagine you ordered a pizza online. How do you find out when it is ready?
                  </p>
                  <ul className="list-disc pl-5 mt-2 space-y-1 text-slate-400">
                    <li>
                      <strong className="text-slate-200">Asking over and over (Polling):</strong> Calling the pizza shop every 30 seconds asking <em>"Is it ready yet?"</em> This wastes everyone's time, uses battery, and slows down servers.
                    </li>
                    <li>
                      <strong className="text-slate-200">Automatic Text Alert (Webhook):</strong> The pizza shop sends you one text message the instant the pizza comes out of the oven. This is much faster and smarter!
                    </li>
                  </ul>
                  <p className="mt-2 text-slate-300">
                    <strong className="text-slate-100">The "Fire-and-Forget" Risk:</strong> In most apps, the server sends the webhook message once into the void. If your computer lost WiFi for just 5 seconds, or if the merchant's server was restarting, the message vanishes forever. That is called "fire-and-forget", and it causes lost orders and unhappy customers.
                  </p>
                </div>

                <div className="p-4 bg-forge-950 rounded-xl border border-white/[0.06] space-y-2">
                  <h4 className="text-xs font-semibold text-brand-300 uppercase tracking-wider flex items-center space-x-1.5">
                    <Database className="w-3.5 h-3.5 text-brand-400" />
                    <span>HookForge's Solution: Write It in the Notebook First</span>
                  </h4>
                  <p className="text-slate-300">
                    HookForge never relies on luck. When an event happens (like <code className="font-mono text-brand-300">order.created</code>), HookForge writes it down in a permanent database notebook (PostgreSQL) before doing anything else.
                  </p>
                  <p className="text-slate-400 text-[11px]">
                    Even if the computer shuts off, the message is safely saved. A background delivery worker picks it up from the notebook and keeps trying until the receiver replies with <strong className="text-emerald-400">200 OK</strong> (meaning <em>"Got it, thank you!"</em>).
                  </p>
                </div>

                {/* Architecture Visual Step Diagram */}
                <div className="card-surface p-4 border border-white/[0.06] space-y-2.5">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 block">
                    How HookForge Safely Delivers Every Message
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 text-center text-[11px] font-mono">
                    <div className="p-2.5 bg-forge-950 rounded-lg border border-white/[0.08]">
                      <div className="text-brand-400 font-bold mb-0.5">1. Save in Notebook</div>
                      <div className="text-[10px] text-slate-400">Stored safely in database</div>
                    </div>
                    <div className="p-2.5 bg-forge-950 rounded-lg border border-white/[0.08]">
                      <div className="text-brand-400 font-bold mb-0.5">2. Queue for Delivery</div>
                      <div className="text-[10px] text-slate-400">Placed in line to send</div>
                    </div>
                    <div className="p-2.5 bg-forge-950 rounded-lg border border-white/[0.08]">
                      <div className="text-brand-400 font-bold mb-0.5">3. 30s Safety Lock</div>
                      <div className="text-[10px] text-slate-400">Worker claims job safely</div>
                    </div>
                    <div className="p-2.5 bg-forge-950 rounded-lg border border-white/[0.08]">
                      <div className="text-brand-400 font-bold mb-0.5">4. Send Signed HTTP</div>
                      <div className="text-[10px] text-slate-400">Delivered with secure seal</div>
                    </div>
                  </div>
                </div>

                <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/25 text-amber-200 space-y-1">
                  <div className="font-bold flex items-center space-x-1.5">
                    <AlertTriangle className="w-4 h-4 text-amber-400" />
                    <span>Why "Exactly-Once" Over the Internet Is Impossible</span>
                  </div>
                  <p className="text-[11px] text-amber-300/90 leading-relaxed">
                    Imagine you tell your friend a secret, and they nod, but right as they speak their phone call drops. Did they hear you, or did the call drop before they heard? You have to repeat it just in case! In the same way, if a receiver gets a webhook but their internet cuts out before sending back <code className="font-mono text-white">200 OK</code>, HookForge will retry. HookForge guarantees <strong className="text-white">At-Least-Once Delivery</strong> (we will never drop your message). The receiver simply checks the order receipt number so they never process the same order twice!
                  </p>
                </div>

                {onNavigate && (
                  <div className="pt-2 flex justify-start">
                    <button
                      onClick={() => onNavigate('overview')}
                      className="inline-flex items-center space-x-2 px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-500 text-white font-semibold shadow-md transition"
                    >
                      <span>View Live Telemetry Overview</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* CHAPTER 2: GETTING STARTED */}
            {currentChapter === 2 && (
              <div className="space-y-5 text-xs text-slate-300 leading-relaxed">
                {/* In Simple Words Callout Box */}
                <div className="p-3.5 bg-brand-500/10 border border-brand-500/25 rounded-xl space-y-1">
                  <span className="text-xs font-bold text-brand-300 uppercase tracking-wider flex items-center space-x-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-brand-400" />
                    <span>In Simple Words</span>
                  </span>
                  <p className="text-xs text-slate-200 leading-relaxed">
                    To receive webhook alerts, you need to tell HookForge where to send them by registering a web address (URL). HookForge gives you a secret password for that URL so your server can verify that every incoming message is authentic.
                  </p>
                </div>

                <div>
                  <h3 className="text-sm font-semibold text-slate-100 mb-1 flex items-center space-x-2">
                    <Radio className="w-4 h-4 text-brand-400" />
                    <span>Registering a Webhook Endpoint (6 Easy Steps)</span>
                  </h3>
                  <p>
                    Follow this 6-step walkthrough to register where HookForge should send alerts:
                  </p>
                </div>

                <div className="space-y-3">
                  <div className="p-3 bg-forge-950 rounded-xl border border-white/[0.06] flex items-start space-x-3">
                    <span className="w-5 h-5 rounded-full bg-brand-500/15 border border-brand-500/30 text-brand-300 flex items-center justify-center font-mono font-bold text-[10px] shrink-0 mt-0.5">
                      1
                    </span>
                    <div>
                      <strong className="text-slate-100">Open Endpoints:</strong> Click the <strong className="text-brand-300">Endpoints</strong> tab in the top navigation bar.
                    </div>
                  </div>

                  <div className="p-3 bg-forge-950 rounded-xl border border-white/[0.06] flex items-start space-x-3">
                    <span className="w-5 h-5 rounded-full bg-brand-500/15 border border-brand-500/30 text-brand-300 flex items-center justify-center font-mono font-bold text-[10px] shrink-0 mt-0.5">
                      2
                    </span>
                    <div>
                      <strong className="text-slate-100">Click "Register Endpoint":</strong> Click the purple button to open the registration form.
                    </div>
                  </div>

                  <div className="p-3 bg-forge-950 rounded-xl border border-white/[0.06] flex items-start space-x-3">
                    <span className="w-5 h-5 rounded-full bg-brand-500/15 border border-brand-500/30 text-brand-300 flex items-center justify-center font-mono font-bold text-[10px] shrink-0 mt-0.5">
                      3
                    </span>
                    <div>
                      <strong className="text-slate-100">Enter Your Destination URL:</strong> Type the web address where your server listens for alerts. For testing on your computer, click one of our simulator presets (like <code className="font-mono text-brand-300">http://localhost:4000/scenario/success</code>).
                    </div>
                  </div>

                  <div className="p-3 bg-forge-950 rounded-xl border border-white/[0.06] flex items-start space-x-3">
                    <span className="w-5 h-5 rounded-full bg-brand-500/15 border border-brand-500/30 text-brand-300 flex items-center justify-center font-mono font-bold text-[10px] shrink-0 mt-0.5">
                      4
                    </span>
                    <div>
                      <strong className="text-slate-100">Choose Events to Receive:</strong> Click chips like <code className="font-mono text-slate-200">order.created</code> or type your own event names.
                    </div>
                  </div>

                  <div className="p-3 bg-forge-950 rounded-xl border border-white/[0.06] flex items-start space-x-3">
                    <span className="w-5 h-5 rounded-full bg-brand-500/15 border border-brand-500/30 text-brand-300 flex items-center justify-center font-mono font-bold text-[10px] shrink-0 mt-0.5">
                      5
                    </span>
                    <div>
                      <strong className="text-slate-100">Set Retry Rules:</strong> Choose how many times HookForge should retry if your server is offline (default is 5 attempts), and how long to wait before timing out.
                    </div>
                  </div>

                  <div className="p-3 bg-forge-950 rounded-xl border border-white/[0.06] flex items-start space-x-3">
                    <span className="w-5 h-5 rounded-full bg-brand-500/15 border border-brand-500/30 text-brand-300 flex items-center justify-center font-mono font-bold text-[10px] shrink-0 mt-0.5">
                      6
                    </span>
                    <div>
                      <strong className="text-slate-100">Save Your Secret Key:</strong> HookForge displays a secret password starting with <code className="font-mono text-brand-300">whsec_...</code>. Copy and save it safely! HookForge only shows it once to protect your security.
                    </div>
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="text-xs font-semibold text-slate-200 flex items-center space-x-1.5">
                    <ShieldCheck className="w-4 h-4 text-brand-400" />
                    <span>The Tamper-Proof Stamp (HTTP Request Headers)</span>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    Every message sent by HookForge comes with a digital seal (<code className="font-mono text-slate-300">X-HookForge-Signature</code>). Your server uses your secret key to check this seal. If anyone tries to modify the message on the way, the seal breaks, and you know not to trust it!
                  </p>
                  <CodeSnippet
                    title="Dispatched HTTP POST Request Headers"
                    language="http"
                    code={`POST /scenario/success HTTP/1.1
Host: localhost:4000
Content-Type: application/json
X-HookForge-Delivery-Id: del_01928374-abcd-ef01-2345-6789abcdef01
X-HookForge-Event-Type: order.created
X-HookForge-Timestamp: 1732456789
X-HookForge-Signature: t=1732456789,v1=a1b2c3d4e5f67890abcdef1234567890abcdef1234567890abcdef1234567890`}
                  />
                </div>

                {onNavigate && (
                  <div className="pt-2 flex justify-start">
                    <button
                      onClick={() => onNavigate('endpoints')}
                      className="inline-flex items-center space-x-2 px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-500 text-white font-semibold shadow-md transition"
                    >
                      <Radio className="w-4 h-4" />
                      <span>Register Your First Endpoint</span>
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* CHAPTER 3: PUBLISHING YOUR FIRST EVENT */}
            {currentChapter === 3 && (
              <div className="space-y-5 text-xs text-slate-300 leading-relaxed">
                {/* In Simple Words Callout Box */}
                <div className="p-3.5 bg-brand-500/10 border border-brand-500/25 rounded-xl space-y-1">
                  <span className="text-xs font-bold text-brand-300 uppercase tracking-wider flex items-center space-x-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-brand-400" />
                    <span>In Simple Words</span>
                  </span>
                  <p className="text-xs text-slate-200 leading-relaxed">
                    Whenever something happens in your app, you publish an event with a unique receipt number (called an Idempotency Key). HookForge makes sure your event is safely recorded and delivered to every endpoint listening for it.
                  </p>
                </div>

                <div>
                  <h3 className="text-sm font-semibold text-slate-100 mb-1 flex items-center space-x-2">
                    <Send className="w-4 h-4 text-brand-400" />
                    <span>Publishing an Event in the Event Lab</span>
                  </h3>
                  <p>
                    Follow these simple steps to publish and test a webhook message:
                  </p>
                </div>

                <ol className="list-decimal pl-5 space-y-2">
                  <li><strong className="text-slate-100">Open Event Lab:</strong> Click <strong className="text-brand-300">"Event Lab"</strong> in the top navigation bar.</li>
                  <li><strong className="text-slate-100">Pick an Event Type:</strong> Select an event like <code className="font-mono text-brand-300">order.created</code> or type your own custom tag.</li>
                  <li><strong className="text-slate-100">Inspect the Idempotency Key:</strong> This is a unique receipt number (like a grocery receipt barcode). Click <strong className="text-brand-300">"New Key"</strong> to generate a fresh one, or type a custom ID (e.g. <code className="font-mono text-slate-300">order_checkout_48291</code>).</li>
                  <li><strong className="text-slate-100">Review the Event Details (JSON):</strong> Check the order information (such as price, customer ID, and currency). Click <strong className="text-brand-300">"Format JSON"</strong> to clean up indentation.</li>
                  <li><strong className="text-slate-100">Click "Publish Event":</strong> HookForge receives the event, writes it to the database notebook, and creates delivery jobs for all matching endpoints.</li>
                  <li><strong className="text-slate-100">Review the Result:</strong> Look at the response card below to see the <strong className="text-emerald-400">202 Accepted</strong> confirmation and delivery tracking IDs.</li>
                </ol>

                <div className="space-y-2">
                  <div className="text-xs font-semibold text-slate-200">Sample Event Payload:</div>
                  <CodeSnippet
                    title="order.created.json"
                    language="json"
                    code={JSON.stringify(
                      {
                        type: 'order.created',
                        data: {
                          order_id: 'ord_998127384',
                          customer_id: 'cust_4982',
                          amount: 149.99,
                          currency: 'USD',
                          status: 'paid',
                          timestamp: '2026-11-24T14:30:00Z',
                        },
                      },
                      null,
                      2
                    )}
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <div className="p-3.5 bg-forge-950 rounded-xl border border-emerald-500/25 space-y-1">
                    <span className="font-bold text-emerald-400 text-xs flex items-center space-x-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>HTTP 202 Accepted (Success)</span>
                    </span>
                    <p className="text-[11px] text-slate-300">
                      Great news! The event is safely stored in the notebook. If you accidentally click "Publish" twice with the exact same receipt key and payload, HookForge safely ignores the duplicate (<code className="font-mono text-emerald-300">idempotent_replay: true</code>) without sending extra copies!
                    </p>
                  </div>

                  <div className="p-3.5 bg-forge-950 rounded-xl border border-rose-500/25 space-y-1">
                    <span className="font-bold text-rose-400 text-xs flex items-center space-x-1.5">
                      <AlertCircle className="w-3.5 h-3.5" />
                      <span>HTTP 409 Conflict (Duplicate Key Warning)</span>
                    </span>
                    <p className="text-[11px] text-slate-300">
                      Warning: You used a receipt key that was already submitted earlier, but with <em>different</em> order details! HookForge blocks this to prevent someone from accidentally changing an order that was already completed.
                    </p>
                  </div>
                </div>

                {onNavigate && (
                  <div className="pt-2 flex justify-start">
                    <button
                      onClick={() => onNavigate('lab')}
                      className="inline-flex items-center space-x-2 px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-500 text-white font-semibold shadow-md transition"
                    >
                      <Send className="w-4 h-4" />
                      <span>Open Event Lab</span>
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* CHAPTER 4: UNDERSTANDING DELIVERIES */}
            {currentChapter === 4 && (
              <div className="space-y-5 text-xs text-slate-300 leading-relaxed">
                {/* In Simple Words Callout Box */}
                <div className="p-3.5 bg-brand-500/10 border border-brand-500/25 rounded-xl space-y-1">
                  <span className="text-xs font-bold text-brand-300 uppercase tracking-wider flex items-center space-x-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-brand-400" />
                    <span>In Simple Words</span>
                  </span>
                  <p className="text-xs text-slate-200 leading-relaxed">
                    A "Delivery" is the overall job to deliver one message to one URL, while an "Attempt" is each individual time HookForge knocks on your door. If your server is busy on the first try, HookForge will make another attempt until it gets through.
                  </p>
                </div>

                <div>
                  <h3 className="text-sm font-semibold text-slate-100 mb-1 flex items-center space-x-2">
                    <Layers className="w-4 h-4 text-brand-400" />
                    <span>Deliveries vs. Delivery Attempts</span>
                  </h3>
                  <p>
                    Understanding this difference makes debugging super easy:
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="p-4 bg-forge-950 rounded-xl border border-white/[0.08] space-y-1.5">
                    <div className="text-xs font-bold text-slate-100 font-mono flex items-center space-x-1.5">
                      <span className="text-brand-400 font-bold">1.</span>
                      <span>Delivery (The Entire Job)</span>
                    </div>
                    <p className="text-[11px] text-slate-400">
                      Think of this as the package tracking number. It tracks the complete mission to get one message to one destination, including whether it succeeded, how many tries it took, and if anyone replayed it.
                    </p>
                  </div>

                  <div className="p-4 bg-forge-950 rounded-xl border border-white/[0.08] space-y-1.5">
                    <div className="text-xs font-bold text-slate-100 font-mono flex items-center space-x-1.5">
                      <span className="text-brand-400 font-bold">2.</span>
                      <span>Delivery Attempt (Each Individual Knock)</span>
                    </div>
                    <p className="text-[11px] text-slate-400">
                      Each individual try by the courier. HookForge records the exact millisecond it knocked, what response code came back (like 200 or 503), how fast the server answered, and any error message.
                    </p>
                  </div>
                </div>

                <div className="space-y-2">
                  <h4 className="text-xs font-semibold text-slate-200 uppercase tracking-wider">
                    The 5 Delivery Statuses (Explained by Color)
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2 font-mono text-[11px]">
                    <div className="p-2.5 rounded-lg bg-forge-950 border border-white/[0.06]">
                      <span className="text-amber-400 font-bold block">pending</span>
                      <span className="text-[10px] text-slate-400 font-sans">Waiting in line to be sent</span>
                    </div>
                    <div className="p-2.5 rounded-lg bg-forge-950 border border-white/[0.06]">
                      <span className="text-sky-400 font-bold block">in_progress</span>
                      <span className="text-[10px] text-slate-400 font-sans">Courier is delivering it now</span>
                    </div>
                    <div className="p-2.5 rounded-lg bg-forge-950 border border-white/[0.06]">
                      <span className="text-emerald-400 font-bold block">succeeded</span>
                      <span className="text-[10px] text-slate-400 font-sans">Delivered! Server said 200 OK</span>
                    </div>
                    <div className="p-2.5 rounded-lg bg-forge-950 border border-white/[0.06]">
                      <span className="text-rose-400 font-bold block">failed</span>
                      <span className="text-[10px] text-slate-400 font-sans">Attempt failed; will retry soon</span>
                    </div>
                    <div className="p-2.5 rounded-lg bg-forge-950 border border-white/[0.06]">
                      <span className="text-purple-400 font-bold block">dead_letter</span>
                      <span className="text-[10px] text-slate-400 font-sans">Ran out of retries; saved in drawer</span>
                    </div>
                  </div>
                </div>

                {onNavigate && (
                  <div className="pt-2 flex justify-start">
                    <button
                      onClick={() => onNavigate('deliveries')}
                      className="inline-flex items-center space-x-2 px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-500 text-white font-semibold shadow-md transition"
                    >
                      <Layers className="w-4 h-4" />
                      <span>Explore Deliveries</span>
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* CHAPTER 5: RELIABILITY ENGINE */}
            {currentChapter === 5 && (
              <div className="space-y-5 text-xs text-slate-300 leading-relaxed">
                {/* In Simple Words Callout Box */}
                <div className="p-3.5 bg-brand-500/10 border border-brand-500/25 rounded-xl space-y-1">
                  <span className="text-xs font-bold text-brand-300 uppercase tracking-wider flex items-center space-x-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-brand-400" />
                    <span>In Simple Words</span>
                  </span>
                  <p className="text-xs text-slate-200 leading-relaxed">
                    HookForge uses smart rules to make sure retries do not crash a struggling server. If a receiver has problems, HookForge automatically waits longer between retries, adds random seconds to avoid stampedes, and pauses traffic if the receiver needs time to recover.
                  </p>
                </div>

                <div>
                  <h3 className="text-sm font-semibold text-slate-100 mb-1 flex items-center space-x-2">
                    <Zap className="w-4 h-4 text-brand-400" />
                    <span>HookForge's Built-In Superpowers</span>
                  </h3>
                  <p>
                    Here is how HookForge protects both you and the receiving servers:
                  </p>
                </div>

                <div className="space-y-3">
                  <div className="p-3.5 bg-forge-950 rounded-xl border border-white/[0.06] space-y-1">
                    <strong className="text-slate-100 block">1. Exponential Backoff with Jitter (Smart Waiting):</strong>
                    <p className="text-slate-400">
                      If someone is sick in bed, you don't ring their doorbell every second. HookForge waits longer after each failure (e.g. 1 second, 2 seconds, 4 seconds, 8 seconds). It also adds a little bit of random timing ("jitter") so hundreds of workers don't rush the receiver's door at the exact same millisecond.
                    </p>
                  </div>

                  <div className="p-3.5 bg-forge-950 rounded-xl border border-white/[0.06] space-y-1">
                    <strong className="text-slate-100 block">2. Circuit Breaker (Safety Fuse for Servers):</strong>
                    <p className="text-slate-400">
                      Just like an electrical fuse stops a fire in your home, HookForge's circuit breaker protects sick servers. If an endpoint fails 5 times in a row, the breaker flips to <code className="font-mono text-rose-400">OPEN</code> and pauses deliveries. Once the cool-down timer finishes, it moves to <code className="font-mono text-amber-400">HALF_OPEN</code> and sends just one test message to see if the server has healed.
                    </p>
                  </div>

                  <div className="p-3.5 bg-forge-950 rounded-xl border border-white/[0.06] space-y-1">
                    <strong className="text-slate-100 block">3. Crash-Safe 30-Second Leases:</strong>
                    <p className="text-slate-400">
                      When a delivery worker starts sending a message, it borrows a 30-second lease. If that worker's computer suddenly crashes or loses power, HookForge's background cleaner notices the expired lease and gives the job to another worker so no message is ever forgotten.
                    </p>
                  </div>
                </div>

                <div className="p-4 bg-forge-950 rounded-xl border border-white/[0.08] space-y-2">
                  <span className="text-xs font-semibold text-brand-300 uppercase tracking-wider block">
                    Real-World Example: A Merchant Server Crashes and Recovers
                  </span>
                  <div className="space-y-1.5 text-[11px] text-slate-300">
                    <div className="flex items-start space-x-2">
                      <span className="text-brand-400 font-mono font-bold">1.</span>
                      <span>A customer buys shoes online; HookForge immediately tries to send <code className="font-mono text-slate-200">order.created</code> to the store.</span>
                    </div>
                    <div className="flex items-start space-x-2">
                      <span className="text-brand-400 font-mono font-bold">2.</span>
                      <span>The store's server is rebooting and replies with <code className="font-mono text-rose-400">HTTP 503 (Please wait 30 seconds)</code>.</span>
                    </div>
                    <div className="flex items-start space-x-2">
                      <span className="text-brand-400 font-mono font-bold">3.</span>
                      <span>HookForge reads the request, pauses, and schedules attempt #2 for exactly 30 seconds later without spamming the store.</span>
                    </div>
                    <div className="flex items-start space-x-2">
                      <span className="text-brand-400 font-mono font-bold">4.</span>
                      <span>On attempt #2, the store server has finished rebooting and answers <code className="font-mono text-emerald-400">HTTP 200 OK</code>. The delivery turns green (<code className="font-mono text-emerald-400">succeeded</code>)!</span>
                    </div>
                  </div>
                </div>

                {onNavigate && (
                  <div className="pt-2 flex justify-start">
                    <button
                      onClick={() => onNavigate('overview')}
                      className="inline-flex items-center space-x-2 px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-500 text-white font-semibold shadow-md transition"
                    >
                      <Zap className="w-4 h-4" />
                      <span>Inspect Live Circuit Breakers</span>
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* CHAPTER 6: REPLAY & RECOVERY */}
            {currentChapter === 6 && (
              <div className="space-y-5 text-xs text-slate-300 leading-relaxed">
                {/* In Simple Words Callout Box */}
                <div className="p-3.5 bg-brand-500/10 border border-brand-500/25 rounded-xl space-y-1">
                  <span className="text-xs font-bold text-brand-300 uppercase tracking-wider flex items-center space-x-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-brand-400" />
                    <span>In Simple Words</span>
                  </span>
                  <p className="text-xs text-slate-200 leading-relaxed">
                    When a message runs out of retries, it moves to the Dead-Letter Queue instead of disappearing. You can ask our AI helper to diagnose what went wrong, fix your server, and click "Replay" to send a fresh copy.
                  </p>
                </div>

                <div>
                  <h3 className="text-sm font-semibold text-slate-100 mb-1 flex items-center space-x-2">
                    <RotateCcw className="w-4 h-4 text-brand-400" />
                    <span>How to Rescue Failed Messages (Dead-Letter Queue)</span>
                  </h3>
                  <p>
                    If all retries fail, the message is placed safely in the Dead-Letter Queue (DLQ). Here is how you rescue it:
                  </p>
                </div>

                <div className="space-y-3">
                  <div className="p-3 bg-forge-950 rounded-xl border border-white/[0.06] flex items-start space-x-3">
                    <span className="w-5 h-5 rounded-full bg-brand-500/15 border border-brand-500/30 text-brand-300 flex items-center justify-center font-mono font-bold text-[10px] shrink-0 mt-0.5">
                      1
                    </span>
                    <div>
                      <strong className="text-slate-100">Find the Failed Messages:</strong> Open the <strong className="text-brand-300">Deliveries</strong> tab and click the <code className="font-mono text-purple-300">dead_letter</code> filter button.
                    </div>
                  </div>

                  <div className="p-3 bg-forge-950 rounded-xl border border-white/[0.06] flex items-start space-x-3">
                    <span className="w-5 h-5 rounded-full bg-brand-500/15 border border-brand-500/30 text-brand-300 flex items-center justify-center font-mono font-bold text-[10px] shrink-0 mt-0.5">
                      2
                    </span>
                    <div>
                      <strong className="text-slate-100">Click "Inspect":</strong> Click the eye icon or Inspect button to see every attempt, error code, and timestamp.
                    </div>
                  </div>

                  <div className="p-3 bg-forge-950 rounded-xl border border-white/[0.06] flex items-start space-x-3">
                    <span className="w-5 h-5 rounded-full bg-brand-500/15 border border-brand-500/30 text-brand-300 flex items-center justify-center font-mono font-bold text-[10px] shrink-0 mt-0.5">
                      3
                    </span>
                    <div>
                      <strong className="text-slate-100">Click "Diagnose with Gemini":</strong> HookForge's built-in AI will analyze the error logs and explain in plain English why the server rejected the message and how to fix it.
                    </div>
                  </div>

                  <div className="p-3 bg-forge-950 rounded-xl border border-white/[0.06] flex items-start space-x-3">
                    <span className="w-5 h-5 rounded-full bg-brand-500/15 border border-brand-500/30 text-brand-300 flex items-center justify-center font-mono font-bold text-[10px] shrink-0 mt-0.5">
                      4
                    </span>
                    <div>
                      <strong className="text-slate-100">Fix the Problem on Your Server:</strong> Use the AI's advice to turn your server back on, fix a bug in your code, or open firewall permissions.
                    </div>
                  </div>

                  <div className="p-3 bg-forge-950 rounded-xl border border-white/[0.06] flex items-start space-x-3">
                    <span className="w-5 h-5 rounded-full bg-brand-500/15 border border-brand-500/30 text-brand-300 flex items-center justify-center font-mono font-bold text-[10px] shrink-0 mt-0.5">
                      5
                    </span>
                    <div>
                      <strong className="text-slate-100">Click "Replay Delivery":</strong> Type a brief note (e.g. <em>"Restarted store server"</em>) and click Replay. HookForge immediately sends a fresh copy (<code className="font-mono text-indigo-300">Replay #1</code>) so your customer gets their notification!
                    </div>
                  </div>
                </div>

                {onNavigate && (
                  <div className="pt-2 flex justify-start">
                    <button
                      onClick={() => onNavigate('deliveries')}
                      className="inline-flex items-center space-x-2 px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-500 text-white font-semibold shadow-md transition"
                    >
                      <RotateCcw className="w-4 h-4" />
                      <span>Explore Deliveries</span>
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* CHAPTER 7: TROUBLESHOOTING PLAYBOOK */}
            {currentChapter === 7 && (
              <div className="space-y-5 text-xs text-slate-300 leading-relaxed">
                {/* In Simple Words Callout Box */}
                <div className="p-3.5 bg-brand-500/10 border border-brand-500/25 rounded-xl space-y-1">
                  <span className="text-xs font-bold text-brand-300 uppercase tracking-wider flex items-center space-x-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-brand-400" />
                    <span>In Simple Words</span>
                  </span>
                  <p className="text-xs text-slate-200 leading-relaxed">
                    Encountering an error? Don't worry! Here is a simple cheat-sheet for the most common webhook problems and the exact steps to fix them in seconds.
                  </p>
                </div>

                <div>
                  <h3 className="text-sm font-semibold text-slate-100 mb-1 flex items-center space-x-2">
                    <ShieldAlert className="w-4 h-4 text-brand-400" />
                    <span>Quick Fixes for Common Problems</span>
                  </h3>
                  <p>
                    Match your error with the cards below for immediate solutions:
                  </p>
                </div>

                <div className="space-y-3">
                  <div className="p-3.5 bg-forge-950 rounded-xl border border-white/[0.06] space-y-1">
                    <div className="font-bold text-slate-100 flex items-center space-x-1.5">
                      <span className="text-rose-400 font-mono">1.</span>
                      <span>Receiver Returns HTTP 500 or 503 (Server Error):</span>
                    </div>
                    <p className="text-slate-400">
                      <strong>What it means:</strong> The receiving computer crashed, ran out of memory, or had a bug while reading the webhook payload.
                    </p>
                    <p className="text-slate-300 text-[11px]">
                      <strong>How to fix it:</strong> Open the delivery modal, check the response excerpt, fix the crash on the receiving server, and click <em>"Replay"</em>.
                    </p>
                  </div>

                  <div className="p-3.5 bg-forge-950 rounded-xl border border-white/[0.06] space-y-1">
                    <div className="font-bold text-slate-100 flex items-center space-x-1.5">
                      <span className="text-amber-400 font-mono">2.</span>
                      <span>Connection Timeout (Nobody Answered):</span>
                    </div>
                    <p className="text-slate-400">
                      <strong>What it means:</strong> HookForge knocked on the door, but the receiver didn't answer before time ran out (or dropped the connection mid-way).
                    </p>
                    <p className="text-slate-300 text-[11px]">
                      <strong>How to fix it:</strong> Double-check that your destination URL is spelled correctly and that your test server (e.g. port 4000) is running. Gemini AI will highlight this as an <em>Ambiguous Delivery</em> if the request finished sending before dropping.
                    </p>
                  </div>

                  <div className="p-3.5 bg-forge-950 rounded-xl border border-white/[0.06] space-y-1">
                    <div className="font-bold text-slate-100 flex items-center space-x-1.5">
                      <span className="text-rose-400 font-mono">3.</span>
                      <span>HTTP 409 Conflict (Duplicate Receipt Key):</span>
                    </div>
                    <p className="text-slate-400">
                      <strong>What it means:</strong> You tried publishing an event using a receipt key (Idempotency Key) that was already used for a different order.
                    </p>
                    <p className="text-slate-300 text-[11px]">
                      <strong>How to fix it:</strong> In the Event Lab, click the <em>"New Key"</em> button to generate a fresh, unique receipt number.
                    </p>
                  </div>

                  <div className="p-3.5 bg-forge-950 rounded-xl border border-white/[0.06] space-y-1">
                    <div className="font-bold text-slate-100 flex items-center space-x-1.5">
                      <span className="text-amber-400 font-mono">4.</span>
                      <span>Circuit Breaker is OPEN (Deliveries Paused):</span>
                    </div>
                    <p className="text-slate-400">
                      <strong>What it means:</strong> The receiver failed 5 times in a row, so HookForge paused new deliveries to give the server breathing room.
                    </p>
                    <p className="text-slate-300 text-[11px]">
                      <strong>How to fix it:</strong> Check the Overview page to see the cool-down countdown. Once the timer reaches zero, send a test event to verify the server has recovered.
                    </p>
                  </div>

                  <div className="p-3.5 bg-forge-950 rounded-xl border border-white/[0.06] space-y-1">
                    <div className="font-bold text-slate-100 flex items-center space-x-1.5">
                      <span className="text-sky-400 font-mono">5.</span>
                      <span>HTTP 429 Rate Limit Exceeded (Too Fast!):</span>
                    </div>
                    <p className="text-slate-400">
                      <strong>What it means:</strong> More webhook events were sent in one minute than your endpoint's speed limit allows.
                    </p>
                    <p className="text-slate-300 text-[11px]">
                      <strong>How to fix it:</strong> Go to the Endpoints page, edit the endpoint, and raise the <code className="font-mono text-slate-200">rate_limit_per_minute</code> setting to allow more traffic.
                    </p>
                  </div>

                  <div className="p-3.5 bg-forge-950 rounded-xl border border-white/[0.06] space-y-1">
                    <div className="font-bold text-slate-100 flex items-center space-x-1.5">
                      <span className="text-purple-400 font-mono">6.</span>
                      <span>Dead Letter Queue (Safe Keeping):</span>
                    </div>
                    <p className="text-slate-400">
                      <strong>What it means:</strong> All 5 automatic retry attempts failed. The message is safely preserved so it is never lost.
                    </p>
                    <p className="text-slate-300 text-[11px]">
                      <strong>How to fix it:</strong> Open Deliveries, click <em>"Inspect"</em>, consult <em>"Diagnose with Gemini"</em>, fix the server issue, and hit <em>"Replay"</em>.
                    </p>
                  </div>
                </div>

                {onNavigate && (
                  <div className="pt-2 flex justify-start">
                    <button
                      onClick={() => onNavigate('overview')}
                      className="inline-flex items-center space-x-2 px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-500 text-white font-semibold shadow-md transition"
                    >
                      <span>Return to System Overview</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Chapter Footer Navigation */}
            <div className="pt-5 border-t border-white/[0.08] flex items-center justify-between text-xs">
              <button
                disabled={currentChapter === 1}
                onClick={() => setCurrentChapter((prev) => Math.max(1, prev - 1))}
                className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-forge-800 hover:bg-forge-750 text-slate-300 disabled:opacity-30 disabled:pointer-events-none transition"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Previous Chapter</span>
              </button>

              <span className="text-slate-500 font-mono text-[11px] hidden sm:inline">
                HookForge Operational Handbook
              </span>

              <button
                disabled={currentChapter === chapters.length}
                onClick={() => setCurrentChapter((prev) => Math.min(chapters.length, prev + 1))}
                className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-500 text-white font-semibold shadow transition disabled:opacity-30 disabled:pointer-events-none"
              >
                <span>Next Chapter</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
