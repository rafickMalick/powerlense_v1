import type { RuleRecommendation } from '@/types/models';

/**
 * `RuleRecommendation` n'a pas de champ "risques" côté backend (voir
 * docs/v2-smart-supervisor.md) — ces points d'attention sont dérivés
 * purement côté client à partir des champs déjà disponibles (confiance,
 * type), pas une évaluation de risque du backend. Ne jamais laisser
 * entendre le contraire dans l'UI.
 */
export function getAttentionPoints(recommendation: RuleRecommendation): string[] {
  const points: string[] = [];

  if (recommendation.confidence === 'LOW') {
    points.push('Confiance faible — les données historiques disponibles sont limitées.');
  }

  if (recommendation.type === 'DELETE_RULE') {
    points.push('Cette action désactivera une règle existante — elle ne sera plus évaluée par le moteur de règles.');
  } else if (recommendation.type === 'MODIFY_RULE') {
    points.push('Cette action modifie une règle existante — le comportement actuel changera après application.');
  }

  if (recommendation.estimatedSavingsKwh == null && recommendation.estimatedSavingsEur == null) {
    points.push('Aucune économie chiffrée disponible pour cette recommandation.');
  }

  return points;
}
