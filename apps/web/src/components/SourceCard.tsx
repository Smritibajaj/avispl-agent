import type { ContentType, JourneyStage } from "@avispl/shared";
import type { ToolHit } from "../lib/tool-logic";

export const STAGE_LABEL: Record<JourneyStage, string> = {
  plan_design: "Plan & design",
  choose_platform: "Choose platform",
  deploy: "Deploy",
  run_support: "Run & support",
  proof: "Proof",
};

const TYPE_LABEL: Record<ContentType, string> = {
  page: "Web page",
  ebook: "eBook",
  interactive_ebook: "Interactive eBook",
  pdf: "PDF",
  blog: "Blog",
  case_study: "Case study",
  webcast: "Webcast",
  industry_page: "Industry page",
  disclosure: "Disclosure",
  support_info: "Support info",
};

interface Props {
  hit: ToolHit;
  cited: boolean;
}

export function SourceCard({ hit, cited }: Props) {
  return (
    <article
      id={`card-${hit.chunkId}`}
      className={`source-card${cited ? "" : " is-uncited"}`}
    >
      <header className="source-card-head">
        <span className="ref-badge">{hit.ref}</span>
        <a className="source-title" href={hit.sourceUrl} target="_blank" rel="noopener noreferrer">
          {hit.pageTitle || hit.title}
        </a>
      </header>
      {hit.section && <div className="source-section">{hit.section}</div>}
      <div className="badges">
        <span className={`badge stage stage-${hit.journeyStage}`}>{STAGE_LABEL[hit.journeyStage]}</span>
        <span className="badge">{TYPE_LABEL[hit.contentType]}</span>
        {hit.pageRange && <span className="badge">pp. {hit.pageRange}</span>}
        {hit.edition && <span className={`badge${hit.edition === "2021" ? " warn" : ""}`}>Edition {hit.edition}</span>}
        {hit.lastModified && <span className="badge muted">Updated {hit.lastModified}</span>}
        {hit.flags.legacyPlatform && <span className="badge warn">Older platform generation</span>}
        {hit.flags.metricsAreEstimates && <span className="badge warn">Figures are estimates</span>}
      </div>
      {hit.csOrganization && (
        <div className="source-meta">
          {hit.csOrganization}
          {hit.csRoomsCount ? ` · ${hit.csRoomsCount} rooms` : ""}
        </div>
      )}
    </article>
  );
}
