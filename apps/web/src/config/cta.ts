import type { JourneyStage } from "@avispl/shared";

/**
 * TODO(the content owner): confirm the next-step wording and the destination link for each journey stage.
 * Until then every CTA links to the AVI-SPL home page (no guessed deep links).
 */
export interface Cta {
  text: string;
  href: string;
}

export const CTA_DEFAULT: Cta = {
  text: "Talk to an AVI-SPL expert",
  href: "https://avispl.com",
};

/** Contextual CTA, chosen from the journey stage that dominates an answer's citations. TODO(the content owner). */
export const CTA_BY_STAGE: Partial<Record<JourneyStage, Cta>> = {
  plan_design: { text: "Talk to an AVI-SPL expert about your room designs", href: "https://avispl.com" },
  choose_platform: { text: "Talk to an AVI-SPL expert about your platform choice", href: "https://avispl.com" },
  deploy: { text: "Talk to an AVI-SPL expert about your rollout", href: "https://avispl.com" },
  run_support: { text: "Talk to an AVI-SPL expert about monitoring and support", href: "https://avispl.com" },
  proof: { text: "Talk to an AVI-SPL expert about similar projects", href: "https://avispl.com" },
};

export const ctaFor = (stage: JourneyStage | undefined): Cta =>
  (stage && CTA_BY_STAGE[stage]) || CTA_DEFAULT;
