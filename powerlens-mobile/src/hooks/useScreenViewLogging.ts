import { useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { logEvent } from '@/services/auditLogs';

/**
 * Journalise chaque consultation d'écran côté backend (AuditLog, action
 * SCREEN_VIEW) — le frontend doit rester un client pur, toute action
 * visible (y compris la simple navigation) doit être tracée (cf. claude.md
 * "VÉRIFICATION DU FRONTEND").
 */
export function useScreenViewLogging(screenName: string): void {
  useFocusEffect(
    useCallback(() => {
      void logEvent('SCREEN_VIEW', { screen: screenName });
    }, [screenName]),
  );
}
