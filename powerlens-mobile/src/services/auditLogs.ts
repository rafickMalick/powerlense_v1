import { api } from './api';
import type { AuditLog } from '@/types/models';

export async function getAuditLogs(limit?: number): Promise<AuditLog[]> {
  const { data } = await api.get<AuditLog[]>('/audit-logs', { params: { limit } });
  return data;
}

/**
 * Journalise un événement observable uniquement côté client (consultation
 * d'écran, déconnexion…) — le frontend reste un client pur : toute action
 * visible doit être tracée côté backend (cf. claude.md "VÉRIFICATION DU
 * FRONTEND"). Échec silencieux volontaire : un défaut réseau ne doit jamais
 * bloquer la navigation de l'utilisateur.
 */
export async function logEvent(action: string, metadata?: Record<string, unknown>): Promise<void> {
  try {
    await api.post('/audit/events', { action, metadata });
  } catch {
    // non-bloquant
  }
}
