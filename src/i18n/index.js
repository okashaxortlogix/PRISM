// PRISM Localization & Internationalization (i18n)
// Aligned with 13-LOCALIZATION/I18N-SPEC.md

const TRANSLATIONS = {
  en: {
    status: {
      DRAFT: 'Draft',
      SCOPING: 'Scoping',
      INGESTING: 'Ingesting',
      EVIDENCE_COLLECTION: 'Evidence Collection',
      HYPOTHESIS_GENERATION: 'Hypothesis Generation',
      HYPOTHESIS_TESTING: 'Hypothesis Testing',
      VERIFICATION: 'Verification',
      ROOT_CAUSE_REVIEW: 'Root Cause Review',
      IMPACT_ASSESSMENT: 'Impact Assessment',
      RECOMMENDATION: 'Recommendation',
      COMPLETED: 'Completed'
    },
    severity: {
      SEV1: 'SEV1 - Critical Outage',
      SEV2: 'SEV2 - Major Impairment',
      SEV3: 'SEV3 - Minor Defect'
    },
    report_title: 'PRISM Engineering Investigation Report'
  },
  de: {
    status: {
      DRAFT: 'Entwurf',
      SCOPING: 'Scoping',
      INGESTING: 'Erfassung',
      EVIDENCE_COLLECTION: 'Beweiserhebung',
      HYPOTHESIS_GENERATION: 'Hypothesenbildung',
      HYPOTHESIS_TESTING: 'Hypothesentest',
      VERIFICATION: 'Verifikation',
      ROOT_CAUSE_REVIEW: 'Ursachenprüfung',
      IMPACT_ASSESSMENT: 'Auswirkungsanalyse',
      RECOMMENDATION: 'Empfehlung',
      COMPLETED: 'Abgeschlossen'
    },
    severity: {
      SEV1: 'SEV1 - Kritischer Ausfall',
      SEV2: 'SEV2 - Schwere Beeinträchtigung',
      SEV3: 'SEV3 - Geringfügiger Fehler'
    },
    report_title: 'PRISM Technischer Untersuchungsbericht'
  },
  ja: {
    status: {
      DRAFT: '下書き',
      SCOPING: 'スコーピング',
      INGESTING: '取り込み中',
      EVIDENCE_COLLECTION: '証拠収集',
      HYPOTHESIS_GENERATION: '仮説生成',
      HYPOTHESIS_TESTING: '仮説検証',
      VERIFICATION: '検証',
      ROOT_CAUSE_REVIEW: '根本原因レビュー',
      IMPACT_ASSESSMENT: '影響評価',
      RECOMMENDATION: '推奨事項',
      COMPLETED: '完了'
    },
    severity: {
      SEV1: 'SEV1 - 重大障害',
      SEV2: 'SEV2 - 主要障害',
      SEV3: 'SEV3 - 軽微な欠陥'
    },
    report_title: 'PRISM 障害調査報告書'
  }
};

function t(locale = 'en', keyPath) {
  const dict = TRANSLATIONS[locale] || TRANSLATIONS['en'];
  const keys = keyPath.split('.');
  let current = dict;
  for (const k of keys) {
    if (current && current[k]) {
      current = current[k];
    } else {
      return keyPath;
    }
  }
  return current;
}

module.exports = {
  t,
  TRANSLATIONS
};
