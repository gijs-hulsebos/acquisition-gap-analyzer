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
  FormInput,
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
import type { AnalysisResult, Gap } from "@/lib/types";

type View = "landing" | "loading" | "results";
type DashboardSection = "overview" | "gaps" | "competitors" | "evidence";

const LOADING_STEPS = [
  { label: "Crawling site", detail: "Pages and links" },
  { label: "Reading services", detail: "Offer structure" },
  { label: "Checking paths", detail: "CTA to contact" },
  { label: "Ranking gaps", detail: "Best fixes first" },
];

const GAP_ICONS = {
  cta: MousePointerClick,
  "service-page": FileSearch,
  "conversion-path": Link2,
  "form-friction": FormInput,
  "message-consistency": MessageSquareText,
  "trust-signals": ShieldCheck,
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
      setActiveSection(["overview", "gaps", "competitors", "evidence"].includes(section) ? section : "overview");
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
        <a className={activeSection === "competitors" ? "active" : undefined} href="#competitors" aria-current={activeSection === "competitors" ? "location" : undefined} onClick={(event) => navigateTo(event, "competitors")}><Search size={17} /> Competitors</a>
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
  const types: Array<AnalysisResult["pages"][number]["type"]> = ["Homepage", "Service", "Contact", "Other"];
  const counts = types.map((type) => ({ type, count: result.pages.filter((page) => page.type === type).length }));

  return (
    <div className="composition-list" aria-label={counts.map((item) => `${item.type}: ${item.count}`).join(", ")}>
      {counts.map((item) => <span key={item.type}>{item.type} <strong>{item.count}</strong></span>)}
    </div>
  );
}

function GapCard({ gap }: { gap: Gap }) {
  const Icon = GAP_ICONS[gap.id];
  return (
    <details className={`finding-row ${gap.rank === 1 ? "finding-row-primary" : ""}`} open={gap.rank === 1 ? true : undefined}>
      <summary>
        <span className="finding-rank">0{gap.rank}</span>
        <span className={`gap-icon gap-icon-${gap.id}`}><Icon size={19} /></span>
        <div className="finding-title">
          <div><span className={`severity severity-${gap.severity.toLowerCase()}`}>{gap.severity}</span></div>
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
              {evidence.source === "competitor" && <small className="competitor-evidence-label">Likely public search competitor</small>}
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
  return "Visitors may lose momentum before contact.";
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
        <p>{readinessExplanation(result.score)}</p>
      </div>
      <div className="readiness-context">
        <div><span><ShieldCheck size={13} /> {result.confidence} confidence</span><small>MVP heuristic · public website evidence</small></div>
        <a href="#gaps">View fixes <ArrowRight size={12} /></a>
      </div>
    </section>
  );
}

function AcquisitionJourney({ result }: { result: AnalysisResult }) {
  const categories = new Map(result.readiness.categories.map((category) => [category.id, category]));
  const average = (ids: Array<AnalysisResult["readiness"]["categories"][number]["id"]>) => {
    const scores = ids.map((id) => categories.get(id)?.score).filter((score): score is number => score !== null && score !== undefined);
    return scores.length ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length) : null;
  };
  const stages = [
    {
      id: "understand",
      number: "01",
      label: "Understand the offer",
      signalLabel: "Offer",
      score: average(["service-page-coverage", "message-consistency"]),
      categoryIds: ["service-page-coverage", "message-consistency"] as const,
      explanation: "Is the offer immediately clear?",
    },
    {
      id: "confidence",
      number: "02",
      label: "Build confidence",
      signalLabel: "CTA",
      score: average(["cta-clarity", "trust-signals"]),
      categoryIds: ["cta-clarity", "trust-signals"] as const,
      explanation: "Is the next step clear and credible?",
    },
    {
      id: "enquiry",
      number: "03",
      label: "Complete the enquiry",
      signalLabel: "Path",
      score: average(["conversion-path-quality", "form-friction"]),
      categoryIds: ["conversion-path-quality", "form-friction"] as const,
      explanation: "Can visitors enquire without friction?",
    },
  ];
  const [activeStageId, setActiveStageId] = useState(() => {
    const scored = stages.filter((stage) => stage.score !== null);
    return [...scored].sort((a, b) => (a.score || 0) - (b.score || 0))[0]?.id || stages[0].id;
  });
  const activeStage = stages.find((stage) => stage.id === activeStageId) || stages[0];
  const stageStatus = (score: number | null) => score === null ? "No data" : score >= 75 ? "Strong" : score >= 50 ? "Watch" : "Friction";

  return (
    <section className="journey-panel" aria-labelledby="journey-heading">
      <header className="journey-heading">
        <div><span>Journey</span><h2 id="journey-heading">Visit → enquiry</h2></div>
      </header>
      <div className="journey-flow" role="group" aria-label="Acquisition journey stages">
        {stages.map((stage) => (
          <button
            className={stage.id === activeStage.id ? "active" : ""}
            type="button"
            aria-pressed={stage.id === activeStage.id}
            aria-label={`${stage.label}: ${stageStatus(stage.score)}${stage.score === null ? "" : `, ${stage.score}`}`}
            onClick={() => setActiveStageId(stage.id)}
            key={stage.id}
          >
            <span className="journey-node">{stage.number}</span>
            <span className="journey-stage-copy"><strong>{stage.signalLabel}</strong></span>
            <span className="journey-value">{stage.score ?? "—"}</span>
            <span className="journey-meter"><i style={{ width: `${stage.score ?? 0}%` }} /></span>
            <span className="journey-hover-card" role="tooltip">
              <strong>{stage.label}</strong>
              <span>{stage.explanation}</span>
              <small>
                {stage.categoryIds.map((id) => {
                  const signal = categories.get(id);
                  return `${signal?.label}: ${signal?.score ?? "not scored"}`;
                }).join(" · ")}
              </small>
            </span>
          </button>
        ))}
      </div>
      <div className="journey-detail" aria-live="polite">
        <strong>{activeStage.label}</strong>
      </div>
    </section>
  );
}

function CompetitorComparison({ result }: { result: AnalysisResult }) {
  const competitors = result.competitors.competitors;
  const ctaScore = result.readiness.categories.find((item) => item.id === "cta-clarity")?.score;
  const trustScore = result.readiness.categories.find((item) => item.id === "trust-signals")?.score;
  const pathValue = result.stats.conversionPathSteps === null ? "Not visible" : result.stats.conversionPathSteps === 0 ? "Form on page" : `${result.stats.conversionPathSteps} steps`;
  const rows = [
    { label: "Dedicated service pages", site: `${result.stats.servicePages} found`, values: competitors.map((item) => item.dedicatedServicePage ? "Visible" : "Not clear") },
    { label: "CTA clarity", site: ctaScore === null || ctaScore === undefined ? "Not scored" : `${ctaScore}/100`, values: competitors.map((item) => `${item.ctaClarity}/100`) },
    { label: "Direct conversion path", site: pathValue, values: competitors.map((item) => item.conversionPathSteps === 0 ? "Form on page" : item.conversionPathSteps === 1 ? "1 step" : "Not visible") },
    { label: "Trust signals", site: trustScore === null || trustScore === undefined ? "Not scored" : `${trustScore}/100`, values: competitors.map((item) => `${item.trustSignals.length} types`) },
  ];
  const hasShorterPath = competitors.some((item) => item.conversionPathSteps !== null && result.stats.conversionPathSteps !== null && item.conversionPathSteps < result.stats.conversionPathSteps);
  const hasClearerCta = competitors.some((item) => ctaScore !== null && ctaScore !== undefined && item.ctaClarity > ctaScore);
  const hasTrustContext = result.gaps.some((gap) => gap.id === "trust-signals") && competitors.some((item) => item.trustSignals.length > 0);
  const comparisonSignals = [
    hasShorterPath ? "shorter direct quote paths" : null,
    hasTrustContext ? "more visible trust proof" : null,
    !hasShorterPath && hasClearerCta ? "clearer calls to action" : null,
  ].filter((item): item is string => Boolean(item));
  const competitorLead = competitors.length === 2 ? "Two" : competitors.length === 1 ? "One" : "No";
  const comparisonSummary = comparisonSignals.length
    ? `${competitorLead} likely public search competitor${competitors.length === 1 ? "" : "s"} show ${comparisonSignals.join(" and ")} on their selected pages.`
    : "A compact comparison of the selected commercial pages returned by public search.";

  return (
    <section className="competitor-section" id="competitors">
      <div className="section-heading competitor-heading">
        <div>
          <h2>Likely public search competitors</h2>
        </div>
        <span className="finding-count">{competitors.length} checked</span>
      </div>
      <p className="competitor-summary">{comparisonSummary}</p>
      {competitors.length ? (
        <div
          className="competitor-table"
          role="table"
          aria-label="Lightweight competitor comparison"
          style={{ "--comparison-columns": competitors.length + 1 } as CSSProperties}
        >
          <div className="competitor-table-row competitor-table-head" role="row">
            <span>Signal</span>
            <strong>{result.companyName}</strong>
            {competitors.map((item) => (
              <a href={item.url} target="_blank" rel="noreferrer" key={item.url}>
                <small>{item.label}</small>{item.name}<ExternalLink size={11} />
              </a>
            ))}
          </div>
          {rows.map((row) => (
            <div className="competitor-table-row" role="row" key={row.label}>
              <span>{row.label}</span><strong>{row.site}</strong>
              {row.values.map((value, index) => <span key={`${row.label}-${competitors[index]?.url}`}>{value}</span>)}
            </div>
          ))}
          <footer>{result.competitors.note}</footer>
        </div>
      ) : (
        <div className="competitor-empty"><Search size={18} /><span>{result.competitors.note}</span></div>
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
        <section className="score-method" aria-labelledby="score-method-heading">
          <div className="technical-subheading"><div><span>SCORING METHOD</span><h3 id="score-method-heading">Weighted category breakdown</h3></div><small>{result.readiness.assessedWeight}% assessed</small></div>
          <div className="score-method-rows">
            {result.readiness.categories.map((category) => (
              <div key={category.id}><span>{category.label}</span><small>{category.weight}% weight</small><strong>{category.score ?? "Not scored"}</strong></div>
            ))}
          </div>
          <p>{result.readiness.formula} · {result.score === null ? `A score needs ${result.readiness.minimumWeight}% assessed weight and two readable pages.` : `Conversion readiness: ${result.score}%.`}</p>
        </section>

        <section className="crawl-detail" aria-labelledby="crawl-detail-heading">
          <div className="technical-subheading"><div><span>CRAWL COVERAGE</span><h3 id="crawl-detail-heading">Evidence inventory</h3></div><PageComposition result={result} /></div>
          <div className="technical-metrics" aria-label="Crawl statistics">
            <MetricCard icon={Globe2} value={result.stats.pagesCrawled} label="Pages" />
            <MetricCard icon={Link2} value={result.stats.internalLinks} label="Links" />
            <MetricCard icon={MousePointerClick} value={result.stats.ctasFound} label="CTAs" />
            <MetricCard icon={FormInput} value={result.stats.formsFound} label="Forms" />
            <MetricCard icon={BarChart3} value={routeValue} label="Path" />
            <MetricCard icon={ShieldCheck} value={result.stats.trustSignals} label="Trust types" />
          </div>
        </section>

        <section className="report-scope" aria-labelledby="report-scope-heading">
          <div><CircleAlert size={15} /><strong id="report-scope-heading">What this scan does not verify</strong></div>
          <ul>
            <li>Forms are detected, not submitted.</li>
            <li>CTA text is read from HTML; visual prominence is not measured.</li>
            <li>Trust signals may be on the same page without being beside the CTA.</li>
            <li>Only eight pages are analyzed, so routes through uncrawled pages are not visible.</li>
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

          <section className="gaps-section" id="gaps">
            <div className="section-heading">
              <div><h2>Priority findings</h2></div>
              <span className="finding-count">{result.gaps.length} findings</span>
            </div>
            <div className="gap-list">{result.gaps.map((gap) => <GapCard gap={gap} key={gap.id} />)}</div>
          </section>

          <CompetitorComparison result={result} />
          <TechnicalDetails result={result} />

          <aside className="report-disclaimer" aria-label="Report scope disclaimer">
            <CircleAlert size={15} />
            <p><strong>Report scope.</strong> This heuristic uses public HTML evidence from up to eight crawled pages. It does not submit forms, measure CTA prominence, confirm trust-signal proximity or detect routes through pages outside the crawl.</p>
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

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mode === "fixture" ? { mode: "fixture" } : { url }),
      });
      const payload = (await response.json()) as AnalysisResult | { error?: string };
      if (!response.ok || !("gaps" in payload)) {
        throw new Error("error" in payload ? payload.error || "The website could not be analyzed." : "The website could not be analyzed.");
      }

      await minimumDelay;
      window.clearInterval(interval);
      setLoadingStep(4);
      await new Promise((resolve) => setTimeout(resolve, 380));
      setResult(payload);
      setView("results");
    } catch (caught) {
      window.clearInterval(interval);
      setError(caught instanceof Error ? caught.message : "The website could not be analyzed.");
      setView("landing");
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
