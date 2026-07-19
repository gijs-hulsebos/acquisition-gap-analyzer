"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, FormEvent, MouseEvent as ReactMouseEvent } from "react";
import {
  ArrowRight,
  BarChart3,
  Check,
  ChevronRight,
  CircleAlert,
  Clock3,
  ExternalLink,
  FileSearch,
  Globe2,
  LayoutDashboard,
  Link2,
  LoaderCircle,
  MessageSquareText,
  MousePointerClick,
  Play,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Target,
} from "lucide-react";
import type { AnalysisResult, CompetitorScanResult, CompetitorScanStartResponse, CompetitorScanStatusResponse, Gap, PublicCompetitor } from "@/lib/types";
import { readAnalysisResponse } from "@/lib/api-response";

type View = "landing" | "loading" | "results";
type DashboardSection = "overview" | "gaps" | "evidence";

const LOADING_STEPS = [
  { label: "Crawling site", detail: "Pages and links" },
  { label: "Detecting model", detail: "Business and offer" },
  { label: "Checking journey", detail: "Actions to conversion" },
  { label: "Scoring findings", detail: "Three fixed checks" },
];

const GAP_ICONS = {
  "offer-clarity": MessageSquareText,
  "cta-clarity": MousePointerClick,
  "customer-journey-path": Link2,
};

function Brand({ onHome }: { onHome: () => void }) {
  return (
    <button className="brand" type="button" aria-label="Back to landing page" onClick={onHome}>
      <span className="brand-name">Acquisition <strong>Gap Analyzer</strong></span>
    </button>
  );
}

function AmbientBackground({ subtle = false }: { subtle?: boolean }) {
  return (
    <div className={`background-fx ${subtle ? "background-fx-subtle" : ""}`} aria-hidden="true">
      <span className="ambient-aurora aurora-one" />
      <span className="ambient-aurora aurora-two" />
      <span className="ambient-orb orb-one" />
      <span className="ambient-orb orb-two" />
      <span className="ambient-orb orb-three" />
      <span className="ambient-ring ring-one" />
      <span className="ambient-ring ring-two" />
      <span className="ambient-line line-one" />
      <span className="ambient-line line-two" />
      <span className="ambient-spark spark-one" />
      <span className="ambient-spark spark-two" />
      <span className="ambient-spark spark-three" />
      <span className="ambient-spark spark-four" />
      <span className="ambient-spark spark-five" />
      <span className="ambient-spark spark-six" />
    </div>
  );
}

function shortHost(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return value.replace(/^https?:\/\//, "").split("/")[0];
  }
}

function formatDuration(milliseconds: number) {
  if (milliseconds < 1000) return `${milliseconds} ms`;
  return `${(milliseconds / 1000).toFixed(1)} sec`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-NL", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function Landing({
  url,
  setUrl,
  error,
  onAnalyze,
  onDemo,
}: {
  url: string;
  setUrl: (url: string) => void;
  error: string;
  onAnalyze: (event: FormEvent) => void;
  onDemo: () => void;
}) {
  return (
    <div className="landing-page">
      <AmbientBackground />
      <header className="marketing-header">
        <Brand onHome={() => window.scrollTo({ top: 0, behavior: "smooth" })} />
        <nav aria-label="Main navigation">
          <a href="#how-it-works">How it works</a>
        </nav>
        <div className="header-status">
          <span className="status-dot" />
          Ready
        </div>
      </header>

      <main>
        <section className="hero" aria-labelledby="hero-heading">
          <div className="hero-copy">
            <div className="eyebrow"><span className="eyebrow-dot" /> Free website scan</div>
            <h1 id="hero-heading">
              Find the 3 gaps <span>costing you leads.</span>
            </h1>
            <p className="hero-lede">
              Enter your website. Get three clear fixes, backed by evidence.
            </p>
            <div className="hero-proof">
              <span>No signup</span><i /><span>Read-only</span><i /><span>8 pages</span>
            </div>
            <button className="demo-link" type="button" onClick={onDemo}>
              <span className="demo-play"><Play size={12} fill="currentColor" /></span>
              View demo
              <ChevronRight size={16} />
            </button>
          </div>

          <div className="hero-visual" aria-label="Start an Acquisition Gap Analyzer report">
            <div className="panel-halo" />
            <div className="analyze-panel">
              <div className="panel-accent" />
              <div className="panel-kicker"><Sparkles size={13} /> Website scan</div>
              <h2>Analyze your website</h2>
              <p>Get your top three gaps.</p>

              <form className="analyze-form" onSubmit={onAnalyze} noValidate>
                <label htmlFor="website-url">Website URL</label>
                <div className={`url-field ${error ? "url-field-error" : ""}`}>
                  <Globe2 size={19} aria-hidden="true" />
                  <input
                    id="website-url"
                    name="website"
                    inputMode="url"
                    placeholder="https://yourcompany.nl"
                    value={url}
                    onChange={(event) => setUrl(event.target.value)}
                    aria-describedby={error ? "url-error" : "url-help"}
                    autoComplete="url"
                  />
                </div>
                <button className="analyze-button" type="submit">
                  <span>Find my gaps</span><ArrowRight size={18} />
                </button>
                {error ? (
                  <div className="form-error" id="url-error" role="alert">
                    <CircleAlert size={15} /> {error}
                  </div>
                ) : (
                  <div className="form-help" id="url-help">
                    <ShieldCheck size={14} /> Read-only <span>·</span> No signup
                  </div>
                )}
              </form>
            </div>
          </div>
        </section>

        <section className="method-strip" id="how-it-works" aria-label="How the analysis works">
          <div><span>01</span><strong>Crawl</strong></div>
          <div><span>02</span><strong>Check</strong></div>
          <div><span>03</span><strong>Fix</strong></div>
        </section>
      </main>
    </div>
  );
}

function LoadingView({ url, step }: { url: string; step: number }) {
  return (
    <div className="loading-page">
      <AmbientBackground subtle />
      <header className="loading-header"><Brand onHome={() => window.location.assign("/")} /><span>Analyzing</span></header>
      <main className="loading-content">
        <section className="loading-intro">
          <div className="scan-visual">
            <div className="scan-orbit scan-orbit-one" />
            <div className="scan-orbit scan-orbit-two" />
            <div className="scan-core"><Search size={27} /></div>
            <span className="scan-pulse scan-pulse-one" />
            <span className="scan-pulse scan-pulse-two" />
          </div>
          <div className="loading-kicker"><span className="status-dot" /> Analyzing</div>
          <h1>Finding your <br />top 3 gaps.</h1>
          <p><strong>{shortHost(url)}</strong></p>
          <div className="loading-security"><ShieldCheck size={15} /> Read-only scan</div>
        </section>

        <section className="loading-card" aria-live="polite">
          <div className="loading-card-top">
            <span>PROGRESS</span>
            <strong>{step >= 4 ? "100" : 18 + step * 23}%</strong>
          </div>
          <div className="progress-track"><span style={{ width: `${step >= 4 ? 100 : 18 + step * 23}%` }} /></div>
          <ol className="loading-steps">
            {LOADING_STEPS.map((item, index) => {
              const done = index < step || step >= 4;
              const active = index === step && step < 4;
              return (
                <li className={done ? "step-done" : active ? "step-active" : ""} key={item.label}>
                  <span className="step-state">
                    {done ? <Check size={16} /> : active ? <LoaderCircle size={16} className="spin" /> : index + 1}
                  </span>
                  <div><strong>{item.label}</strong><p>{item.detail}</p></div>
                  {active && <span className="step-live">In progress</span>}
                </li>
              );
            })}
          </ol>
          <div className="loading-footnote">
            <span><span className="status-dot" /> Evidence checks</span>
            <span>Under 45 sec</span>
          </div>
        </section>
      </main>
    </div>
  );
}

function Sidebar({ result, onReset }: { result: AnalysisResult; onReset: () => void }) {
  const [activeSection, setActiveSection] = useState<DashboardSection>("overview");

  useEffect(() => {
    const syncActiveSection = () => {
      const section = window.location.hash.slice(1) as DashboardSection;
      setActiveSection(["overview", "gaps", "evidence"].includes(section) ? section : "overview");
    };

    syncActiveSection();
    window.addEventListener("hashchange", syncActiveSection);
    window.addEventListener("popstate", syncActiveSection);
    return () => {
      window.removeEventListener("hashchange", syncActiveSection);
      window.removeEventListener("popstate", syncActiveSection);
    };
  }, []);

  function navigateTo(event: ReactMouseEvent<HTMLAnchorElement>, section: DashboardSection) {
    const target = document.getElementById(section);
    if (!target) return;

    event.preventDefault();
    setActiveSection(section);
    const nextUrl = `${window.location.pathname}${window.location.search}#${section}`;
    if (window.location.hash === `#${section}`) {
      window.history.replaceState({}, "", nextUrl);
    } else {
      window.history.pushState({}, "", nextUrl);
    }
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <aside className="dashboard-sidebar">
      <div className="sidebar-brand"><Brand onHome={onReset} /></div>
      <nav aria-label="Analysis navigation">
        <a className={activeSection === "overview" ? "active" : undefined} href="#overview" aria-current={activeSection === "overview" ? "location" : undefined} onClick={(event) => navigateTo(event, "overview")}><LayoutDashboard size={17} /> Overview</a>
        <a className={activeSection === "gaps" ? "active" : undefined} href="#gaps" aria-current={activeSection === "gaps" ? "location" : undefined} onClick={(event) => navigateTo(event, "gaps")}><Target size={17} /> Findings <span>{result.gaps.length}</span></a>
        <a className={activeSection === "evidence" ? "active" : undefined} href="#evidence" aria-current={activeSection === "evidence" ? "location" : undefined} onClick={(event) => navigateTo(event, "evidence")}><FileSearch size={17} /> Technical details</a>
      </nav>
      <div className="sidebar-system">
        <small>Current report</small>
        <strong>{shortHost(result.url)}</strong>
        {result.mode === "live" && <span><i className="status-dot" /> Live analysis</span>}
      </div>
    </aside>
  );
}

function MetricCard({ icon: Icon, value, label }: { icon: typeof Globe2; value: string | number; label: string }) {
  return (
    <div className="metric-card">
      <span className="metric-icon"><Icon size={18} /></span>
      <div><span>{label}</span><strong>{value}</strong></div>
    </div>
  );
}

function PageComposition({ result }: { result: AnalysisResult }) {
  const order: Array<AnalysisResult["pages"][number]["type"]> = ["Homepage", "Category", "Product", "Service", "Cart", "Checkout", "Booking", "Application", "Pricing", "Conversion", "Other"];
  const types = order.filter((type) => result.pages.some((page) => page.type === type));
  const counts = types.map((type) => ({ type, count: result.pages.filter((page) => page.type === type).length }));

  return (
    <div className="composition-list" aria-label={counts.map((item) => `${item.type}: ${item.count}`).join(", ")}>
      {counts.map((item) => <span key={item.type}>{item.type} <strong>{item.count}</strong></span>)}
    </div>
  );
}

function FindingScoreRing({ score, label }: { score: number | null; label: string }) {
  const normalizedScore = score === null ? 0 : Math.max(0, Math.min(100, score));
  return (
    <span
      className={`finding-score-ring ${score === null ? "finding-score-ring-empty" : ""}`}
      style={{ "--finding-score": `${normalizedScore * 3.6}deg` } as CSSProperties}
      aria-label={score === null ? `${label}: insufficient data` : `${label}: ${score}%`}
    >
      <span><strong>{score === null ? "—" : `${score}%`}</strong></span>
    </span>
  );
}

function GapCard({ gap, compact = false }: { gap: Gap; compact?: boolean }) {
  const Icon = GAP_ICONS[gap.id];
  return (
    <details className={`finding-row ${gap.rank === 1 ? "finding-row-primary" : ""} ${compact ? "finding-row-compact" : ""}`} open={gap.rank === 1 ? true : undefined}>
      <summary>
        <FindingScoreRing score={gap.score} label={gap.title} />
        <span className={`gap-icon gap-icon-${gap.id}`}><Icon size={19} /></span>
        <div className="finding-title">
          <div>{gap.score === null ? <span className="severity">Insufficient data</span> : <span className={`severity severity-${gap.severity.toLowerCase()}`}>{gap.severity}</span>}</div>
          <h3>{gap.title}</h3>
          <p>{gap.summary}</p>
          <div className="finding-action-preview"><span>Recommended action</span><strong>{gap.nextAction}</strong></div>
        </div>
        <ChevronRight className="finding-chevron" size={18} />
      </summary>
      <div className="finding-detail">
        <div className="finding-evidence">
          <span>Evidence</span>
          {gap.evidence.map((evidence, index) => (
            <div key={`${evidence.url}-${index}`}>
              <p>{evidence.statement}</p>
              <a href={evidence.url} target="_blank" rel="noreferrer">{evidence.pageLabel} <ExternalLink size={11} /></a>
            </div>
          ))}
        </div>
      </div>
    </details>
  );
}

function readinessExplanation(score: number | null) {
  if (score === null) return "Not enough public evidence to score.";
  if (score >= 80) return "Clear path to enquiry.";
  if (score >= 65) return "Mostly clear, with focused friction.";
  if (score >= 50) return "Several gaps may reduce enquiries.";
  return "Visitors may lose momentum before conversion.";
}

function donutSegmentPath(startAngle: number, endAngle: number) {
  const point = (radius: number, angle: number) => {
    const radians = (angle - 90) * Math.PI / 180;
    return { x: 50 + radius * Math.cos(radians), y: 50 + radius * Math.sin(radians) };
  };
  const outerStart = point(48, startAngle);
  const outerEnd = point(48, endAngle);
  const innerStart = point(38, startAngle);
  const innerEnd = point(38, endAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;

  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A 48 48 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerEnd.x} ${innerEnd.y}`,
    `A 38 38 0 ${largeArc} 0 ${innerStart.x} ${innerStart.y}`,
    "Z",
  ].join(" ");
}

function ConversionReadiness({ result }: { result: AnalysisResult }) {
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const colors = ["#d8b4f2", "#cda0eb", "#c18ce3", "#b277d8", "#a065c8", "#8e55b5"];
  let cursor = 0;
  const segments = result.readiness.categories.flatMap((category, index) => {
    const contribution = category.score === null ? 0 : (category.score * category.weight) / 100;
    if (contribution <= 0) return [];
    const segment = {
      category,
      color: colors[index % colors.length],
      contribution,
      offset: cursor,
      visibleLength: Math.max(0, contribution - 0.56),
    };
    cursor += contribution;
    return [segment];
  });
  const hoveredSegment = segments.find(({ category }) => category.id === activeCategory);

  return (
    <section className="conversion-readiness" aria-labelledby="readiness-heading">
      <div className="readiness-score-block" aria-label={result.score === null ? "Conversion readiness: insufficient data" : `Conversion readiness: ${result.score}%`}>
        <span>Conversion readiness</span>
        <div className={`readiness-score-circle ${result.score === null ? "empty" : ""}`}>
          <svg className="readiness-segments" viewBox="0 0 100 100" aria-label="Conversion readiness score categories">
            <circle className="readiness-track" cx="50" cy="50" r="43" />
            {segments.map(({ category, color, contribution, offset, visibleLength }) => (
              <path
                className="readiness-segment"
                d={donutSegmentPath(215 + offset * 3.6, 215 + (offset + visibleLength) * 3.6)}
                fill={color}
                key={category.id}
                role="button"
                tabIndex={0}
                aria-label={`${category.label}: ${contribution.toFixed(1)} points earned from a ${category.score}% category score at ${category.weight}% weight`}
                onMouseEnter={() => setActiveCategory(category.id)}
                onMouseLeave={() => setActiveCategory(null)}
                onFocus={() => setActiveCategory(category.id)}
                onBlur={() => setActiveCategory(null)}
              >
                <title>{category.label}: {contribution.toFixed(1)} points earned</title>
              </path>
            ))}
          </svg>
          <div className="readiness-score-value"><strong>{result.score === null ? "—" : `${result.score}%`}</strong></div>
          {hoveredSegment && (
            <div className="readiness-tooltip" role="status">
              <strong>{hoveredSegment.category.label}</strong>
              <span>{hoveredSegment.contribution.toFixed(1)} pts earned · {hoveredSegment.category.weight}% weight</span>
            </div>
          )}
        </div>
      </div>
      <div className="readiness-copy">
        <div className="readiness-title-line">
          <h2 id="readiness-heading">{result.scoreLabel}</h2>
        </div>
        <p>{result.journey.businessModels.includes("Ecommerce") ? result.journey.primary.status === "incomplete" ? "Checkout path could not be estimated." : `${result.journey.primary.clicksToInterface} clicks to checkout.` : readinessExplanation(result.score)}</p>
      </div>
      <div className="readiness-context">
        <div><span><ShieldCheck size={13} /> {result.confidence} confidence</span><small>MVP heuristic · public website evidence</small></div>
        <a href="#gaps">View fixes <ArrowRight size={12} /></a>
      </div>
    </section>
  );
}

function AcquisitionJourney({ result }: { result: AnalysisResult }) {
  const journey = result.journey.primary;
  const stages = journey.stages.slice(0, 5);
  const [activeStageId, setActiveStageId] = useState(() => {
    return stages.find((stage) => stage.friction)?.order || stages[0]?.order || 1;
  });
  const activeStage = stages.find((stage) => stage.order === activeStageId) || stages[0];
  const clickLabel = journey.status === "incomplete" ? "Incomplete journey" : journey.clicksToInterface === null ? "Path unconfirmed" : `${journey.clicksToInterface} click${journey.clicksToInterface === 1 ? "" : "s"}`;
  const journeySummary = journey.additionalObservableActions === null ? clickLabel : `${clickLabel} · ${journey.additionalObservableActions} additional action${journey.additionalObservableActions === 1 ? "" : "s"}`;

  return (
    <section className="journey-panel" aria-labelledby="journey-heading">
      <header className="journey-heading">
        <div><span>Customer journey</span><h2 id="journey-heading">{journey.status === "incomplete" ? "Incomplete journey" : `Visitor → ${result.journey.primaryConversionType.toLowerCase()}`}</h2></div>
        <small>{journeySummary}</small>
      </header>
      <div className="journey-flow" role="group" aria-label="Representative customer journey" style={{ "--journey-columns": Math.max(stages.length, 1) } as CSSProperties}>
        {stages.map((stage) => (
          <button
            className={stage.order === activeStage?.order ? "active" : ""}
            type="button"
            aria-pressed={stage.order === activeStage?.order}
            aria-label={`Step ${stage.order}: ${stage.pageType}. ${stage.action}`}
            onClick={() => setActiveStageId(stage.order)}
            key={`${stage.order}-${stage.url}`}
          >
            <span className="journey-node">{String(stage.order).padStart(2, "0")}</span>
            <span className="journey-stage-copy"><strong>{stage.pageType}</strong></span>
            <span className="journey-meter"><i style={{ width: `${(stage.order / Math.max(stages.length, 1)) * 100}%` }} /></span>
            <span className="journey-hover-card" role="tooltip">
              <strong>{stage.title}</strong>
              <span>{stage.action}</span>
              <small>{stage.ctaText ? `CTA: ${stage.ctaText}` : stage.friction || "Conversion interface reached"}</small>
            </span>
          </button>
        ))}
      </div>
      <div className="journey-detail" aria-live="polite">
        <strong>{activeStage?.action || "No complete conversion route was confirmed"}</strong>
      </div>
    </section>
  );
}

function CompetitorComparison({ result, competitor }: { result: AnalysisResult; competitor: PublicCompetitor }) {
  return (
    <article className="competitor-comparison">
      <section className="comparison-company" aria-labelledby="analyzed-company-heading">
        <header>
          <div><small>Analyzed company</small><h3 id="analyzed-company-heading">{result.companyName}</h3><span>{result.overview.estimatedClicks === null ? "Journey unconfirmed" : `${result.overview.estimatedClicks} clicks to conversion`}</span></div>
          <FindingScoreRing score={result.score} label={`${result.companyName} overall`} />
        </header>
        <div className="comparison-findings">{result.gaps.map((finding) => <GapCard gap={finding} compact key={finding.id} />)}</div>
      </section>
      <section className="comparison-company comparison-company-competitor" aria-labelledby="competitor-company-heading">
        <header>
          <div><small>Confirmed direct competitor · {competitor.pagesAnalyzed} pages</small><h3 id="competitor-company-heading"><a href={competitor.url} target="_blank" rel="noreferrer">{competitor.name}<ExternalLink size={13} /></a></h3><span>{competitor.estimatedClicks === null ? "Journey unconfirmed" : `${competitor.estimatedClicks} clicks to conversion`}</span></div>
          <FindingScoreRing score={competitor.score} label={`${competitor.name} overall`} />
        </header>
        <div className="comparison-findings">{competitor.findings.map((finding) => <GapCard gap={finding} compact key={finding.id} />)}</div>
      </section>
    </article>
  );
}

function PublicCompetitorScan({ result }: { result: AnalysisResult }) {
  const [status, setStatus] = useState<"idle" | "crawling" | "complete" | "error">("idle");
  const [scan, setScan] = useState<CompetitorScanResult | null>(null);
  const [competitorUrl, setCompetitorUrl] = useState("");
  const [error, setError] = useState("");

  async function pollScan(token: string) {
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      await new Promise((resolve) => window.setTimeout(resolve, 2_500));
      const response = await fetch(`/api/competitors/status?token=${encodeURIComponent(token)}`, { cache: "no-store" });
      const payload = await response.json() as CompetitorScanStatusResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error || "The competitor crawl status could not be read.");
      if (payload.status === "processing") continue;
      if (payload.status === "failed") throw new Error(payload.error);
      setScan(payload.result);
      setStatus("complete");
      return;
    }
    throw new Error("The competitor website is still processing. Try the scan again in a moment.");
  }

  async function startScan() {
    if (!competitorUrl.trim()) {
      setError("Enter a competitor website URL.");
      return;
    }
    setStatus("crawling");
    setError("");
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch("/api/competitors/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(result.mode === "fixture" ? { mode: "fixture", selectedUrl: competitorUrl } : {
          selectedUrl: competitorUrl,
          sourceUrl: result.url,
        }),
        signal: controller.signal,
      });
      const payload = await response.json() as CompetitorScanStartResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error || "The competitor crawl could not be started.");
      window.clearTimeout(timeout);
      if (payload.status === "complete") {
        setScan(payload.result);
        setStatus("complete");
        return;
      }
      await pollScan(payload.token);
    } catch (caught) {
      setError(caught instanceof DOMException && caught.name === "AbortError" ? "The competitor crawl could not be started in time." : caught instanceof Error ? caught.message : "The competitor scan failed.");
      setStatus("error");
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function resetScan() {
    setStatus("idle");
    setScan(null);
    setCompetitorUrl("");
    setError("");
  }

  return (
    <section
      className={`public-competitor-scan ${status === "complete" ? "has-results" : ""}`}
      aria-labelledby="competitor-scan-heading"
    >
      <div className="competitor-scan-intro">
        <div className="competitor-scan-icon"><Search size={17} /></div>
        <div><span>Optional comparison</span><h2 id="competitor-scan-heading">Compare a competitor</h2><p>Enter a competitor URL to run the same analysis.</p></div>
      </div>
      {status !== "complete" && <form className="competitor-url-form" onSubmit={(event) => { event.preventDefault(); void startScan(); }}>
        <label htmlFor="competitor-url">Competitor website URL</label>
        <div><input id="competitor-url" type="url" required value={competitorUrl} onChange={(event) => setCompetitorUrl(event.target.value)} placeholder="https://competitor.nl" disabled={status === "crawling"} /><button type="submit" disabled={status === "crawling"}>{status === "crawling" ? <><LoaderCircle className="spin" size={15} /> Analyzing</> : <>Compare website <ArrowRight size={14} /></>}</button></div>
        {status === "error" && <p className="competitor-scan-error">{error}</p>}
      </form>}
      {status === "complete" && scan && (
        <div className="competitor-scan-results">
          <header><span>{scan.note}</span><button type="button" onClick={resetScan}>Scan again</button></header>
          {scan.competitor ? <div className="competitor-cards">
            <CompetitorComparison result={result} competitor={scan.competitor} />
          </div> : null}
        </div>
      )}
    </section>
  );
}

function TechnicalDetails({ result }: { result: AnalysisResult }) {
  const routeValue = result.stats.conversionPathSteps === null ? "Not found" : `${result.stats.conversionPathSteps} step${result.stats.conversionPathSteps === 1 ? "" : "s"}`;
  return (
    <details className="technical-section" id="evidence">
      <summary>
        <span><FileSearch size={16} /><strong>Crawl and scoring details</strong><small>{result.pages.length} pages</small></span>
        <ChevronRight size={16} />
      </summary>
      <div className="technical-content">
        <section className="score-method journey-method" aria-labelledby="journey-method-heading">
          <div className="technical-subheading"><div><span>CUSTOMER JOURNEY</span><h3 id="journey-method-heading">Representative conversion route</h3></div><small>{result.journey.primary.confidence} confidence</small></div>
          <div className="score-method-rows">
            <div><span>Business model</span><small>First-party evidence</small><strong>{result.journey.businessModels[0]}</strong></div>
            <div><span>Primary conversion</span><small>Commercial destination</small><strong>{result.journey.primaryConversionType}</strong></div>
            <div><span>Conversion steps</span><small>Landing page to first conversion</small><strong>{result.journey.primary.clicksToInterface ?? "Unconfirmed"}</strong></div>
          </div>
          <p>{result.journey.primary.stages.map((stage) => stage.pageType).join(" → ") || "No complete public route was detected."}</p>
        </section>

        <section className="score-method" aria-labelledby="score-method-heading">
          <div className="technical-subheading"><div><span>SCORING METHOD</span><h3 id="score-method-heading">Weighted category breakdown</h3></div><small>{result.readiness.assessedWeight}% assessed</small></div>
          <div className="score-method-rows">
            {result.readiness.categories.map((category) => (
              <div key={category.id}><span>{category.label}</span><small>{category.weight}% weight</small><strong>{category.score ?? "Not scored"}</strong></div>
            ))}
          </div>
          <p>{result.readiness.formula} · {result.score === null ? `A score requires at least three useful representative pages; ${result.stats.pagesCrawled} page${result.stats.pagesCrawled === 1 ? " was" : "s were"} returned.` : `Conversion readiness: ${result.score}%.`}</p>
        </section>

        <section className="crawl-detail" aria-labelledby="crawl-detail-heading">
          <div className="technical-subheading"><div><span>CRAWL COVERAGE</span><h3 id="crawl-detail-heading">Evidence inventory</h3></div><PageComposition result={result} /></div>
          <div className="technical-metrics" aria-label="Crawl statistics">
            <MetricCard icon={Globe2} value={result.stats.pagesCrawled} label="Pages" />
            <MetricCard icon={Link2} value={result.stats.internalLinks} label="Links" />
            <MetricCard icon={MousePointerClick} value={result.stats.actionsFound} label="Actions" />
            <MetricCard icon={BarChart3} value={routeValue} label="Path" />
          </div>
        </section>

        <section className="report-scope" aria-labelledby="report-scope-heading">
          <div><CircleAlert size={15} /><strong id="report-scope-heading">What this scan does not verify</strong></div>
          <ul>
            <li>Forms are detected, not submitted.</li>
            <li>CTA text is read from HTML; visual prominence is not measured.</li>
            <li>Up to eight representative pages are analyzed, so routes through unselected pages may not be visible.</li>
            <li>Purchases, account creation, bookings and forms are never completed.</li>
          </ul>
        </section>

        <div className="pages-table" role="table" aria-label="Crawled pages">
          <div className="pages-table-row pages-table-head" role="row"><span>Page</span><span>Type</span><span>Status</span></div>
          {result.pages.map((page, index) => (
            <div className="pages-table-row" role="row" key={`${page.url}-${index}`}>
              <div><a href={page.url} target="_blank" rel="noreferrer">{page.title}<ExternalLink size={11} /></a><small>{new URL(page.url).pathname}</small></div>
              <span className="page-type">{page.type}</span>
              <span className={`http-status ${page.statusCode >= 400 ? "http-error" : ""}`}><i /> {page.statusCode}</span>
            </div>
          ))}
        </div>
      </div>
    </details>
  );
}

function ResultsView({ result, onReset }: { result: AnalysisResult; onReset: () => void }) {
  return (
    <div className="dashboard-shell">
      <AmbientBackground subtle />
      <Sidebar result={result} onReset={onReset} />
      <main className="dashboard-main">
        <header className="dashboard-topbar">
          <div className="mobile-brand"><Brand onHome={onReset} /></div>
          <div className="breadcrumbs"><span>Analyses</span><ChevronRight size={14} /><strong>{shortHost(result.url)}</strong></div>
          <button className="new-analysis-button" type="button" onClick={onReset}><RefreshCw size={15} /> New analysis</button>
        </header>

        <div className="dashboard-content">
          <section className="company-heading" id="overview">
            <div>
              <h1>{result.companyName}</h1>
              <p><Globe2 size={14} /> {shortHost(result.url)} <span /> {result.primaryService}</p>
            </div>
            <div className="analysis-meta">
              <span><Clock3 size={14} /> {formatDate(result.analyzedAt)}</span>
              {result.mode === "live" && <span className="mode-badge">Live analysis</span>}
            </div>
          </section>

          <section className="overview-workspace" aria-label="Dashboard overview">
            <ConversionReadiness result={result} />
            <AcquisitionJourney result={result} />
          </section>

          <PublicCompetitorScan result={result} />

          <section className="gaps-section" id="gaps">
            <div className="section-heading">
              <div><h2>Priority findings</h2></div>
              <span className="finding-count">{result.gaps.length} findings</span>
            </div>
            <div className="gap-list">{result.gaps.map((gap) => <GapCard gap={gap} key={gap.id} />)}</div>
          </section>

          <TechnicalDetails result={result} />

          <aside className="report-disclaimer" aria-label="Report scope disclaimer">
            <CircleAlert size={15} />
            <p><strong>Report scope.</strong> This heuristic maps the domain and inspects up to eight representative journey pages. It never purchases, creates accounts or submits forms, and cannot confirm visual prominence, personalization, logged-in steps or routes outside the selected pages.</p>
          </aside>

          <footer className="dashboard-footer">
            <span>Processed in {formatDuration(result.stats.processingMs)}</span>
          </footer>
        </div>
      </main>
    </div>
  );
}

export default function Home() {
  const [view, setView] = useState<View>("landing");
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [loadingStep, setLoadingStep] = useState(0);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const demoAutostarted = useRef(false);

  const loadingUrl = useMemo(() => url || "noordlicht-klimaat.example", [url]);

  useEffect(() => {
    if (demoAutostarted.current || new URLSearchParams(window.location.search).get("demo") !== "1") {
      return;
    }

    demoAutostarted.current = true;
    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete("demo");
    window.history.replaceState({}, "", `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`);
    void runAnalysis("fixture");
  }, []);

  async function runAnalysis(mode: "live" | "fixture") {
    if (mode === "live" && !url.trim()) {
      setError("Enter a company website to start the analysis.");
      return;
    }

    setError("");
    setLoadingStep(0);
    setView("loading");
    const minimumDelay = new Promise((resolve) => setTimeout(resolve, 2600));
    const interval = window.setInterval(
      () => setLoadingStep((current) => Math.min(3, current + 1)),
      720,
    );
    const controller = new AbortController();
    const requestTimeout = window.setTimeout(() => controller.abort(), 58_000);

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mode === "fixture" ? { mode: "fixture" } : { url }),
        signal: controller.signal,
      });
      const payload = await readAnalysisResponse(response);

      await minimumDelay;
      window.clearInterval(interval);
      setLoadingStep(4);
      await new Promise((resolve) => setTimeout(resolve, 380));
      setResult(payload);
      setView("results");
    } catch (caught) {
      window.clearInterval(interval);
      const message = caught instanceof DOMException && caught.name === "AbortError"
        ? "The scan took too long. Please try again in a moment."
        : caught instanceof Error ? caught.message : "The website could not be analyzed.";
      setError(message);
      setView("landing");
    } finally {
      window.clearTimeout(requestTimeout);
    }
  }

  function handleAnalyze(event: FormEvent) {
    event.preventDefault();
    void runAnalysis("live");
  }

  function reset() {
    setView("landing");
    setResult(null);
    setError("");
    setUrl("");
    window.history.replaceState({}, "", `${window.location.pathname}${window.location.search}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (view === "loading") return <LoadingView url={loadingUrl} step={loadingStep} />;
  if (view === "results" && result) return <ResultsView result={result} onReset={reset} />;

  return (
    <Landing
      url={url}
      setUrl={setUrl}
      error={error}
      onAnalyze={handleAnalyze}
      onDemo={() => void runAnalysis("fixture")}
    />
  );
}
