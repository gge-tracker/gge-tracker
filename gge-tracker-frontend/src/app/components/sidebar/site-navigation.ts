export interface SiteNavigationItem {
  label: string;
  id?: string;
  url?: string;
  iconUrl?: string;
  iconClass?: string;
  tag?: 'bot' | 'extension';
  frequency?: 'Temps réel' | 'Par heure';
}

export interface SiteNavigationSection {
  title: string;
  items: SiteNavigationItem[];
}

export const HOME_ROUTE = '/';

export const SITE_NAVIGATION: readonly SiteNavigationSection[] = [
  {
    title: 'Rechercher et analyser',
    items: [
      { label: 'Accueil', id: HOME_ROUTE, iconUrl: '/assets/tools/home.webp' },
      { label: 'Joueurs', id: 'players', iconUrl: '/assets/tools/players.webp' },
      { label: 'Alliances', id: 'alliances', iconUrl: '/assets/tools/alliances.webp' },
      { label: 'Comparer', id: 'compare', iconUrl: '/assets/tools/ranking.webp' },
      { label: 'Changements de nom', id: 'renames', iconUrl: '/assets/tools/renames.webp' },
      { label: 'Mouvements', id: 'movements', iconUrl: '/assets/tools/movements.webp' },
    ],
  },
  {
    title: 'Outils tactiques',
    items: [
      { label: 'Cartographie', id: 'map', iconUrl: '/assets/tools/cartography.webp' },
      { label: 'Forteresses', id: 'dungeons', iconUrl: '/assets/tools/fortresses.webp', frequency: 'Temps réel' },
      {
        label: 'Îles orageuses',
        id: 'storm-tracker',
        iconUrl: '/assets/storm-tracker/fort.png',
        frequency: 'Temps réel',
      },
      { label: 'Châteaux', id: 'castles', iconUrl: '/assets/tools/castles.webp', frequency: 'Temps réel' },
    ],
  },
  {
    title: 'Scores et classements',
    items: [
      {
        label: 'temp_server_name_tooltip',
        id: 'live/outer-realms',
        iconUrl: '/assets/tools/or.webp',
        frequency: 'Temps réel',
      },
      { label: 'Le Grand Tournoi', id: 'grand-tournament', iconUrl: '/assets/tools/gt.webp', frequency: 'Par heure' },
      { label: 'Tournoi de la Faille', id: 'rift-raid', iconUrl: '/assets/tools/rift.webp', frequency: 'Par heure' },
      { label: 'Scores finaux', id: 'events', iconUrl: '/assets/tools/events.webp' },
      {
        label: 'Roue des richesses inimaginables',
        id: 'woa',
        iconUrl: '/assets/tools/woa.webp',
      },
      {
        label: 'Classement des aigues-marines',
        id: 'stormy-isles',
        iconUrl: '/assets/tools/aquamarine.webp',
        frequency: 'Par heure',
      },
    ],
  },
  {
    title: 'Analytique',
    items: [
      { label: 'Statistiques', id: 'statistics', iconUrl: '/assets/tools/stats.webp' },
      { label: 'Offres', id: 'offers', iconUrl: '/assets/tools/shop.webp' },
    ],
  },
  {
    title: 'Défis quotidiens',
    items: [{ label: 'Qui est-ce ?', id: 'guess', iconUrl: '/assets/tools/guess.webp' }],
  },
  {
    title: 'À découvrir',
    items: [
      {
        label: 'empire-rankings.io',
        url: 'https://danadum.github.io/empire-rankings/',
        iconUrl: '/assets/tools/empire-rankings.webp',
      },
      {
        label: 'GGE Assistant',
        url: 'https://top.gg/bot/1472309793065533493',
        iconClass: 'fa-brands fa-discord',
        tag: 'bot',
      },
      {
        label: 'GGE WebSocket Studio',
        url: 'https://chromewebstore.google.com/detail/gge-websocket-studio/deaaangkjfdcpegbebpdhkiknaniomeg',
        iconClass: 'fa-brands fa-chrome',
        tag: 'extension',
      },
    ],
  },
];
