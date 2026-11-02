import { createPersistedStore } from '../lib/store';

export interface Settings {
  /** Anzeigesprache fuer Kartennamen und -texte. */
  lang: 'de' | 'en';
  /** Im Auto-Scan sichere Treffer direkt uebernehmen. */
  autoAdd: boolean;
}

export const settingsStore = createPersistedStore<Settings>('yugi.settings', { lang: 'de', autoAdd: true });
