import { EventType } from '@ggetracker-interfaces/empire-ranking';

const VARIANT_KEYS: Record<EventType, Record<string, string>> = {
  [EventType.OUTER_REALM]: {
    collector: 'outer.dialog_tempServer_scoring_header_collector',
    might: 'outer.dialog_tempServer_scoring_header_might',
    rankSwap: 'outer.dialog_tempServer_scoring_header_rankSwap',
  },
  [EventType.BEYOND_THE_HORIZON]: {
    AllianceCollector: 'outer.dialog_beyondTheHorizon_introduction_section1_title_AllianceCollector',
    AllianceTower: 'outer.dialog_beyondTheHorizon_introduction_section1_title_AllianceTower',
    AllianceJade: 'outer.dialog_beyondTheHorizon_introduction_section1_title_AllianceJade',
  },
};

export function eventVariantKey(type: EventType, variant: string | null | undefined): string | null {
  return variant ? (VARIANT_KEYS[type][variant] ?? null) : null;
}
