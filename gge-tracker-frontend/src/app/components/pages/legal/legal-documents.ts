export type LegalDocumentId = 'legal' | 'privacy';

export interface LegalFact {
  labelKey: string;
  key: string;
}

export type LegalBlock =
  | { kind: 'paragraph'; key: string }
  | { kind: 'list'; introKey?: string; keys: string[] }
  | { kind: 'facts'; facts: LegalFact[] }
  | { kind: 'link'; route: string; key: string };

export interface LegalSection {
  titleKey: string;
  level: 2 | 3;
  blocks: LegalBlock[];
}

export interface LegalDocument {
  id: LegalDocumentId;
  titleKey: string;
  updatedOn: string;
  introKeys: string[];
  sections: LegalSection[];
}

const paragraphs = (...keys: string[]): LegalBlock[] => keys.map((key) => ({ kind: 'paragraph', key }));

const processingRecord = (prefix: string, titleKey: string, extraFacts: LegalFact[] = []): LegalSection => ({
  titleKey,
  level: 3,
  blocks: [
    {
      kind: 'facts',
      facts: [
        { labelKey: 'privacy.label-data', key: `${prefix}-data` },
        { labelKey: 'privacy.label-purpose', key: `${prefix}-purpose` },
        { labelKey: 'privacy.label-basis', key: `${prefix}-basis` },
        ...extraFacts,
        { labelKey: 'privacy.label-retention', key: `${prefix}-retention` },
      ],
    },
  ],
});

export const LEGAL_NOTICE: LegalDocument = {
  id: 'legal',
  titleKey: 'legal.title',
  updatedOn: '2026-10-04',
  introKeys: ['legal.intro'],
  sections: [
    {
      titleKey: 'legal.publisher-title',
      level: 2,
      blocks: paragraphs('legal.publisher-1', 'legal.publisher-2', 'legal.publisher-3'),
    },
    { titleKey: 'legal.host-title', level: 2, blocks: paragraphs('legal.host-1', 'legal.host-2') },
    {
      titleKey: 'legal.terms-title',
      level: 2,
      blocks: [
        ...paragraphs('legal.terms-1', 'legal.terms-2', 'legal.terms-accuracy', 'legal.terms-availability'),
        {
          kind: 'list',
          introKey: 'legal.terms-rules',
          keys: ['legal.terms-rule-1', 'legal.terms-rule-2', 'legal.terms-rule-3', 'legal.terms-rule-4'],
        },
        ...paragraphs('legal.terms-enforcement'),
      ],
    },
    { titleKey: 'legal.api-title', level: 2, blocks: paragraphs('legal.api-1', 'legal.api-2') },
    { titleKey: 'legal.liability-title', level: 2, blocks: paragraphs('legal.liability-1', 'legal.liability-2') },
    { titleKey: 'legal.ip-title', level: 2, blocks: paragraphs('legal.ip-1', 'legal.ip-2', 'legal.ip-3') },
    {
      titleKey: 'legal.report-title',
      level: 2,
      blocks: paragraphs('legal.report-1', 'legal.report-2', 'legal.report-3'),
    },
    {
      titleKey: 'legal.data-title',
      level: 2,
      blocks: [...paragraphs('legal.data-1'), { kind: 'link', route: '/privacy', key: 'legal.data-link' }],
    },
    { titleKey: 'legal.law-title', level: 2, blocks: paragraphs('legal.law-1', 'legal.law-2') },
  ],
};

export const PRIVACY_POLICY: LegalDocument = {
  id: 'privacy',
  titleKey: 'privacy.title',
  updatedOn: '2026-10-04',
  introKeys: ['privacy.intro'],
  sections: [
    {
      titleKey: 'privacy.summary-title',
      level: 2,
      blocks: [
        {
          kind: 'list',
          keys: ['privacy.summary-1', 'privacy.summary-2', 'privacy.summary-3', 'privacy.summary-4'],
        },
      ],
    },
    { titleKey: 'privacy.controller-title', level: 2, blocks: paragraphs('privacy.controller-1') },
    { titleKey: 'privacy.visitors-title', level: 2, blocks: paragraphs('privacy.visitors-1') },
    processingRecord('privacy.logs', 'privacy.logs-title'),
    processingRecord('privacy.ratelimit', 'privacy.ratelimit-title'),
    processingRecord('privacy.cloudflare', 'privacy.cloudflare-title'),
    processingRecord('privacy.storage', 'privacy.storage-title'),
    processingRecord('privacy.github', 'privacy.github-title'),
    processingRecord('privacy.contact', 'privacy.contact-title'),
    processingRecord('privacy.apikeys', 'privacy.apikeys-title'),
    { titleKey: 'privacy.game-title', level: 2, blocks: paragraphs('privacy.game-1') },
    processingRecord('privacy.game', 'privacy.game-record-title', [
      { labelKey: 'privacy.label-source', key: 'privacy.game-source' },
      { labelKey: 'privacy.label-recipients', key: 'privacy.game-recipients' },
    ]),
    {
      titleKey: 'privacy.game-objection-title',
      level: 3,
      blocks: paragraphs('privacy.game-objection-1', 'privacy.game-objection-2', 'privacy.game-objection-3'),
    },
    {
      titleKey: 'privacy.recipients-title',
      level: 2,
      blocks: [
        {
          kind: 'list',
          introKey: 'privacy.recipients-1',
          keys: ['privacy.recipient-ovh', 'privacy.recipient-cloudflare', 'privacy.recipient-github'],
        },
      ],
    },
    { titleKey: 'privacy.transfers-title', level: 2, blocks: paragraphs('privacy.transfers-1') },
    { titleKey: 'privacy.cookies-title', level: 2, blocks: paragraphs('privacy.cookies-1', 'privacy.cookies-2') },
    {
      titleKey: 'privacy.rights-title',
      level: 2,
      blocks: paragraphs('privacy.rights-1', 'privacy.rights-2', 'privacy.rights-3'),
    },
    { titleKey: 'privacy.security-title', level: 2, blocks: paragraphs('privacy.security-1') },
    {
      titleKey: 'privacy.changes-title',
      level: 2,
      blocks: [...paragraphs('privacy.changes-1'), { kind: 'link', route: '/legal', key: 'privacy.legal-link' }],
    },
  ],
};

export const LEGAL_DOCUMENTS: Record<LegalDocumentId, LegalDocument> = {
  legal: LEGAL_NOTICE,
  privacy: PRIVACY_POLICY,
};
