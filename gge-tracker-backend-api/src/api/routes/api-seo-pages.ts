import * as express from 'express';
import { ApiHelper } from '../helper/api-helper';
import { HttpCache } from '../helper/http-cache';
import { SeoHead } from '../helper/seo-head';
import { ApiEventThresholds } from './api-event-thresholds';

interface PageHead {
  title: string;
  description: string;
}

export abstract class ApiSeoPages implements ApiHelper {
  private static readonly MAX_AGE_SECONDS = 3600;

  private static readonly PAGES: Readonly<Record<string, PageHead>> = {
    '/': {
      title: 'GGE Tracker - Advanced Stats for Goodgame Empire',
      description:
        'Goodgame Empire statistics for every server: might and loot rankings, player and alliance histories, castles, events and maps, updated every hour',
    },
    '/players': {
      title: 'Player rankings',
      description:
        'Every Goodgame Empire player of your server ranked by might, loot, honor and fame, with their alliance and history',
    },
    '/alliances': {
      title: 'Alliance rankings',
      description: 'Every Goodgame Empire alliance of your server ranked by might, members and loot',
    },
    '/compare/players': {
      title: 'Compare players',
      description: 'Compare two Goodgame Empire players side by side: might, loot, events and castles over time',
    },
    '/compare/alliances': {
      title: 'Compare alliances',
      description: 'Compare two Goodgame Empire alliances side by side: might, members, loot and events over time',
    },
    '/event-thresholds': {
      title: 'Event thresholds',
      description:
        'Points needed for each rank of the Goodgame Empire kingdom events on your server, edition after edition',
    },
    '/statistics': {
      title: 'Server statistics',
      description: 'Players, alliances, might and activity of your Goodgame Empire server over time',
    },
    '/map': {
      title: 'Server map',
      description: 'The world map of your Goodgame Empire server, with alliance territories and castle positions',
    },
    '/castles': {
      title: 'Castles',
      description: 'Look up any castle of a Goodgame Empire player: position, kingdom and buildings',
    },
    '/movements': {
      title: 'Castle movements',
      description: 'Relocations, new outposts and conquests on your Goodgame Empire server, hour by hour',
    },
    '/renames/players': {
      title: 'Player name changes',
      description: 'Every Goodgame Empire player who changed their name on your server, with the old and new names',
    },
    '/renames/alliances': {
      title: 'Alliance name changes',
      description: 'Every Goodgame Empire alliance that changed its name on your server, with the old and new names',
    },
    '/dungeons': {
      title: 'Fortresses',
      description: 'Goodgame Empire fortresses of your server and when they can be attacked again',
    },
    '/storm-tracker': {
      title: 'Storm Islands tracker',
      description: 'Storm Islands forts and resource isles of your Goodgame Empire server',
    },
    '/stormy-isles': {
      title: 'Aquamarine ranking',
      description: 'The Storm Islands aquamarine leaderboard of Goodgame Empire',
    },
    '/rift-raid': {
      title: 'Rift Tournament',
      description: 'The Rift Tournament of the Goodgame Empire Rift Raid, alliance by alliance and hour by hour',
    },
    '/grand-tournament': {
      title: 'Grand Tournament',
      description: 'The Goodgame Empire Grand Tournament ranking, division by division and hour by hour',
    },
    '/events': {
      title: 'Outer Realms and Beyond the Horizon',
      description: 'Rankings of every past Outer Realms and Beyond the Horizon event of Goodgame Empire',
    },
    '/live/outer-realms': {
      title: 'Live Outer Realms',
      description: 'The Outer Realms ranking of Goodgame Empire in real time',
    },
    '/woa': {
      title: 'Wheel of Unimaginable Affluence',
      description: 'The Wheel of Unimaginable Affluence rankings of Goodgame Empire',
    },
    '/offers': {
      title: 'Store offers',
      description: 'The Goodgame Empire cash offers currently in the store',
    },
    '/guess': {
      title: 'Guess the player',
      description: 'A daily game: guess the Goodgame Empire player of the day',
    },
    '/about': {
      title: 'About',
      description: 'The analysis tool for Goodgame Empire: what it collects, from which servers and how often',
    },
    '/release-notes': {
      title: 'Release notes',
      description: 'The latest changes to GGE Tracker',
    },
    '/legal': {
      title: 'Legal notice',
      description: 'Legal notice and terms of use of gge-tracker.com',
    },
    '/privacy': {
      title: 'Privacy policy',
      description: 'How gge-tracker.com handles personal data: request logs, game data, retention and your rights',
    },
  };

  private static readonly EVENT_NAMES: Readonly<Record<string, string>> = {
    nomad: 'Nomads',
    samurai: 'Samurai',
    bloodcrow: 'War of the Bloodcrows',
    'war-realms': 'War of the Realms',
    'berimond-kingdom': 'Berimond kingdom',
    'berimond-invasion': 'Berimond invasion',
  };

  public static getPageHead(request: express.Request, response: express.Response): void {
    try {
      const path = String(request.query.path ?? '');
      const page = Object.hasOwn(this.PAGES, path) ? this.PAGES[path] : null;
      const event = path === '/event-thresholds' ? this.eventSlug(request.query.event) : null;
      const etag = HttpCache.etagFromCacheKey(
        `seo-page:${page ? path : 'unknown'}:${event ?? ''}:${SeoHead.siteUrl()}:${SeoHead.apiUrl()}`,
      );
      if (
        HttpCache.handleConditional(request, response, { etag, dataVersion: null, maxAgeSeconds: this.MAX_AGE_SECONDS })
      ) {
        return;
      }
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      const html = page ? this.render(path, page, event) : this.render('/', this.PAGES['/'], null, false);
      response.status(ApiHelper.HTTP_OK).send(html);
    } catch (error) {
      const { code, message } = ApiHelper.getHttpMessageResponse(ApiHelper.HTTP_INTERNAL_SERVER_ERROR);
      response.status(code).send({ error: message });
      ApiHelper.logError(error, 'getSeoPageHead', request);
    }
  }

  private static eventSlug(raw: unknown): string | null {
    const slug = String(raw ?? '');
    return Object.hasOwn(ApiEventThresholds.EVENT_TABLES, slug) && Object.hasOwn(this.EVENT_NAMES, slug) ? slug : null;
  }

  private static render(path: string, page: PageHead, event: string | null, indexable = true): string {
    const eventName = event ? this.EVENT_NAMES[event] : null;
    const heading = eventName ? `${eventName} thresholds` : page.title;
    const description = eventName
      ? `Points needed for each rank of ${eventName} in Goodgame Empire on your server, edition after edition`
      : page.description;
    const title = path === '/' && !eventName ? page.title : `${heading} · ${SeoHead.SITE_NAME}`;
    return SeoHead.render({
      path: event ? `${path}?event=${event}` : path,
      title,
      description,
      heading,
      image: SeoHead.genericImage(),
      imageAlt: SeoHead.SITE_NAME,
      indexable,
      type: 'website',
    });
  }
}
