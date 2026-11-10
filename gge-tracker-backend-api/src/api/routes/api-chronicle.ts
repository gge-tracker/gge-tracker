import * as express from 'express';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ApiHelper } from '../helper/api-helper';
import { HttpCache } from '../helper/http-cache';
import { SeoHead } from '../helper/seo-head';
import { RouteErrorMessagesEnum } from '../enums/errors.enums';
import { ChronicleCardCopy } from '../services/chronicle-card-copy';
import {
  CHRONICLE_LINK_CARD,
  CHRONICLE_STORY_CARD,
  ChronicleCard,
  ChronicleCardAssets,
  ChronicleCardData,
} from '../services/chronicle-card';
import { ShareCardRenderer } from '../services/share-card-renderer';
import { ApiProfiles, ProfileContext } from './api-profiles';
import { ApiSeo } from './api-seo';

interface ChronicleServerRow {
  tier: string;
  tracked_days: number;
  data_from: number;
  data_until: number;
  built_at: number;
}

interface ChroniclePlayer {
  id: number | string;
  name: string;
  tier: string;
  rival: { id: number | string; name: string } | null;
  alliance: { name: string | null };
  persona: string | null;
  might: { gain: number; higherThanPct: number; monthly: (number | null)[] };
  loot: { total: number; higherThanPct: number };
  events: { runs: number };
  rhythm: { activeDays: number };
}

interface ChronicleAnswer {
  year: number;
  server: string;
  serverLabel: string;
  status: 'ready' | 'too-recent';
  tier: string;
  trackedDays: number;
  dataFrom: number;
  dataUntil: number;
  builtAt: number;
  player: ChroniclePlayer | null;
}

interface ChronicleSubject {
  context: ProfileContext;
  year: number;
}

const FIRST_YEAR = 2026;
const LAST_YEAR = 2100;
const UNKNOWN_TABLE = /UNKNOWN_TABLE|Code: 60/;

function serverLabel(server: string): string {
  return server.replace(/^E4K_/, 'E4K ').replace(/^PARTNER_/, '');
}

function shortDate(seconds: number, locale: string): string {
  return new Date(seconds * 1000).toLocaleDateString(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

export abstract class ApiChronicle implements ApiHelper {
  private static readonly CACHE_SECONDS = 3600;
  private static readonly HEAD_MAX_AGE_SECONDS = 900;
  private static readonly CARD_MAX_AGE_SECONDS = 3600;

  private static cardAssets: ChronicleCardAssets | null = null;

  public static async getChronicle(request: express.Request, response: express.Response): Promise<void> {
    try {
      const subject = this.parseSubject(request);
      if (!subject) {
        response.status(ApiHelper.HTTP_BAD_REQUEST).send({ error: RouteErrorMessagesEnum.InvalidPlayerId });
        return;
      }
      const answer = await this.read(subject);
      if (!answer) {
        response.status(ApiHelper.HTTP_NOT_FOUND).send({ error: RouteErrorMessagesEnum.ChronicleNotFound });
        return;
      }
      response.status(ApiHelper.HTTP_OK).send(answer);
    } catch (error) {
      this.answerFailure(error, 'getChronicle', request, response);
    }
  }

  public static async getCard(request: express.Request, response: express.Response): Promise<void> {
    try {
      const subject = this.parseSubject(request);
      const answer = subject ? await this.read(subject) : null;
      if (!subject || !answer?.player) {
        response.status(ApiHelper.HTTP_NOT_FOUND).send({ error: RouteErrorMessagesEnum.ChronicleNotFound });
        return;
      }
      const isStory = request.query.format === 'story';
      const copy = await ChronicleCardCopy.forLanguage(request.query.lang);
      const key = `chronicle:card:${subject.year}:${subject.context.id}:${isStory ? 'story' : 'link'}:${copy.lang}:${copy.version}:${answer.builtAt}`;
      if (
        HttpCache.handleConditional(request, response, {
          etag: HttpCache.etagFromCacheKey(key),
          dataVersion: null,
          maxAgeSeconds: ChronicleCardCopy.readsLocalFiles ? 0 : this.CARD_MAX_AGE_SECONDS,
        })
      ) {
        return;
      }
      const size = isStory ? CHRONICLE_STORY_CARD : CHRONICLE_LINK_CARD;
      const html = ChronicleCard.html(this.cardData(answer, copy), size, this.assets(), copy);
      await ApiSeo.sendCachedCard(request, response, key, () => ShareCardRenderer.renderHtml(key, html, size));
    } catch (error) {
      this.answerFailure(error, 'getChronicleCard', request, response);
    }
  }

  public static async getHead(request: express.Request, response: express.Response): Promise<void> {
    try {
      const subject = this.parseSubject(request);
      const answer = subject ? await this.read(subject) : null;
      const copy = await ChronicleCardCopy.forLanguage(request.query.lang);
      response.setHeader('Cache-Control', `public, max-age=${this.HEAD_MAX_AGE_SECONDS}`);
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.status(ApiHelper.HTTP_OK).send(this.headDocument(subject, answer, copy));
    } catch (error) {
      this.answerFailure(error, 'getChronicleHead', request, response);
    }
  }

  private static headDocument(
    subject: ChronicleSubject | null,
    answer: ChronicleAnswer | null,
    copy: ChronicleCardCopy,
  ): string {
    const player = answer?.player;
    if (!subject || !answer || !player) {
      return SeoHead.render({
        path: '/',
        title: `The Chronicle · ${SeoHead.SITE_NAME}`,
        description: 'A year of Goodgame Empire, told from complete hourly history.',
        heading: 'The Chronicle',
        image: SeoHead.genericImage(),
        imageAlt: SeoHead.SITE_NAME,
        indexable: false,
        type: 'website',
      });
    }
    const path = `/chronicle/${subject.year}/${subject.context.id}`;
    const heading = copy.text('title', { year: subject.year });
    const origin = [answer.serverLabel, player.alliance.name].filter(Boolean).join(' · ');
    const stats = `${copy.text('cardLoot')}: ${ShareCardRenderer.compact(player.loot.total)} · ${copy.text('eventsLead')}: ${player.events.runs}`;
    const language = copy.lang === 'en' ? '' : `&lang=${copy.lang}`;
    return SeoHead.render({
      path,
      title: `${player.name} · ${heading} · ${answer.serverLabel} · ${SeoHead.SITE_NAME}`,
      description: `${player.name} · ${origin} · ${stats}`,
      heading: `${player.name} · ${heading}`,
      image: `${SeoHead.apiUrl()}/assets/og/chronicle/${subject.year}/${subject.context.id}.jpg?v=${answer.builtAt}.${copy.version}${language}`,
      imageAlt: `${player.name} · ${heading} · ${answer.serverLabel}`,
      indexable: false,
      type: 'profile',
    });
  }

  private static parseSubject(request: express.Request): ChronicleSubject | null {
    const year = Number(request.params.year);
    if (!Number.isInteger(year) || year < FIRST_YEAR || year > LAST_YEAR) return null;
    const id = ApiHelper.verifyIdWithCountryCode(request.params.playerId);
    const context = id === false ? null : ApiProfiles.contextFor(id, new Set());
    return context ? { context, year } : null;
  }

  private static async read(subject: ChronicleSubject): Promise<ChronicleAnswer | null> {
    const key = `chronicle:${subject.year}:${subject.context.server}:${subject.context.localId}`;
    const cached = await ApiHelper.redisClient.get(key).catch((): null => null);
    if (cached) return JSON.parse(cached) as ChronicleAnswer;

    const answer = await this.readStored(subject).catch((error: unknown) => {
      if (UNKNOWN_TABLE.test(String(error))) return null;
      throw error;
    });
    if (answer) void ApiHelper.updateCache(key, answer, this.CACHE_SECONDS);
    return answer;
  }

  private static async readStored(subject: ChronicleSubject): Promise<ChronicleAnswer | null> {
    const { context, year } = subject;
    const clickhouse = await ApiHelper.ggeTrackerManager.getClickHouseInstance();
    const servers = await clickhouse.query({
      query: `
        SELECT tier, tracked_days, toUnixTimestamp(data_from) AS data_from,
          toUnixTimestamp(data_until) AS data_until, toUnixTimestamp(built_at) AS built_at
        FROM ggetracker_global.year_chronicle_server
        WHERE year = {year:UInt16} AND server = {server:String}
        ORDER BY built_at DESC
        LIMIT 1`,
      query_params: { year, server: context.server },
      format: 'JSONEachRow',
    });
    const [server] = await servers.json<ChronicleServerRow>();
    if (!server) return null;

    const answer: ChronicleAnswer = {
      year,
      server: context.server,
      serverLabel: serverLabel(context.server),
      status: server.tier === 'too-recent' ? 'too-recent' : 'ready',
      tier: server.tier,
      trackedDays: Number(server.tracked_days),
      dataFrom: Number(server.data_from),
      dataUntil: Number(server.data_until),
      builtAt: Number(server.built_at),
      player: null,
    };
    if (answer.status === 'too-recent') return answer;

    const players = await clickhouse.query({
      query: `
        SELECT payload
        FROM ggetracker_global.year_chronicle
        WHERE year = {year:UInt16} AND server = {server:String} AND player_id = {playerId:UInt32}
          AND built_at = toDateTime({builtAt:UInt32})
        LIMIT 1`,
      query_params: { year, server: context.server, playerId: context.localId, builtAt: answer.builtAt },
      format: 'JSONEachRow',
    });
    const [row] = await players.json<{ payload: string }>();
    if (!row) return null;
    answer.player = this.withPublicIds(JSON.parse(row.payload) as ChroniclePlayer, context);
    return answer;
  }

  private static withPublicIds(player: ChroniclePlayer, context: ProfileContext): ChroniclePlayer {
    return {
      ...player,
      id: String(context.id),
      rival: player.rival ? { ...player.rival, id: `${player.rival.id}${context.code}` } : null,
    };
  }

  private static cardData(answer: ChronicleAnswer, copy: ChronicleCardCopy): ChronicleCardData {
    const player = answer.player!;
    return {
      year: answer.year,
      server: answer.serverLabel,
      name: player.name,
      allianceName: player.alliance.name,
      persona: player.persona,
      mightGain: player.might.gain,
      mightHigherThanPct: player.might.higherThanPct,
      lootTotal: player.loot.total,
      lootHigherThanPct: player.loot.higherThanPct,
      eventRuns: player.events.runs,
      activeDays: player.rhythm.activeDays,
      monthly: player.might.monthly,
      dataRange: this.dataRange(answer, copy),
    };
  }

  private static dataRange(answer: ChronicleAnswer, copy: ChronicleCardCopy): string {
    const from = shortDate(answer.dataFrom, copy.locale);
    return answer.tier === 'full'
      ? copy.text('cardRange', { from, to: shortDate(answer.dataUntil - 1, copy.locale), year: answer.year })
      : copy.text('cardSince', { date: from, year: answer.year });
  }

  private static assets(): ChronicleCardAssets {
    this.cardAssets ??= {
      backdrop: this.dataUri('backdrop.webp', 'image/webp'),
      backdropTall: this.dataUri('backdrop-tall.webp', 'image/webp'),
      titleFont: this.dataUri('title.woff2', 'font/woff2'),
      numberFont: this.dataUri('number.woff2', 'font/woff2'),
    };
    return this.cardAssets;
  }

  private static dataUri(file: string, mime: string): string {
    const content = readFileSync(path.resolve(process.cwd(), 'card-assets/chronicle', file));
    return `data:${mime};base64,${content.toString('base64')}`;
  }

  private static answerFailure(
    error: unknown,
    label: string,
    request: express.Request,
    response: express.Response,
  ): void {
    const { code, message } = ApiHelper.getHttpMessageResponse(ApiHelper.HTTP_INTERNAL_SERVER_ERROR);
    response.status(code).send({ error: message });
    ApiHelper.logError(error, label, request);
  }
}
