export type ChronicleSlide =
  | 'cover'
  | 'climb'
  | 'summit'
  | 'great-day'
  | 'plunder'
  | 'battlefield'
  | 'beyond'
  | 'glory'
  | 'rhythm'
  | 'hours'
  | 'banner'
  | 'rival'
  | 'persona'
  | 'wall';

export const EVENT_NAME_KEYS: Record<string, string> = {
  nomad: 'Nomades',
  samurai: 'Samouraïs',
  bloodcrow: 'Corbeaux de sang',
  berimond: 'Royaume de Berimond',
  war_realms: 'Guerre des royaumes',
};

export const SLIDE_SCENES: Record<ChronicleSlide, string> = {
  cover: 'tavern',
  climb: 'climb',
  summit: 'climb',
  'great-day': 'keeps',
  plunder: 'realms',
  battlefield: 'tournament',
  beyond: 'beyond',
  glory: 'glory',
  rhythm: 'cartography',
  hours: 'scouting',
  banner: 'council',
  rival: 'lists',
  persona: 'crossroads',
  wall: 'rift',
};
