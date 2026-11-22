import * as express from 'express';
import { ClientQuotas } from '../guard/client-quotas';
import { BYPASSED_ROUTES } from '../guard/bypassed-routes';
import { CHRONICLE_RENDER_BUDGET, SHARE_CARD_RENDER_BUDGET } from '../guard/render-budget';
import { ApiHelper } from '../helper/api-helper';
import { ApiKeyRegistry } from '../services/api-key-registry';
import {
  CHRONICLE_RENDERS_MAXIMUM,
  DEFAULT_POINTS,
  DEFAULT_WINDOW_SECONDS,
  GAME_COMMAND_MAXIMUMS,
  RATE_LIMIT_MAXIMUMS,
} from './api-admin-keys';

export abstract class ApiAdminLimits implements ApiHelper {
  public static getLimits(_request: express.Request, response: express.Response): void {
    const standard = ClientQuotas.DEFAULT_LIMITS.standard;
    const realtime = ClientQuotas.DEFAULT_LIMITS.realtime;
    response.status(ApiHelper.HTTP_OK).send({
      channel: process.env.API_CHANNEL === 'beta' ? 'beta' : 'public',
      key_cache_seconds: Math.round(ApiKeyRegistry.CACHE_TTL_MS / 1000),
      bypassed_routes: BYPASSED_ROUTES.map((route) => route.label),
      limits: [
        {
          name: 'requests',
          routes: 'every route except the bypassed ones',
          anonymous: { points: ApiHelper.RATE_LIMIT_POINTS, window_seconds: ApiHelper.RATE_LIMIT_DURATION_SECONDS },
          key_default: { points: DEFAULT_POINTS, window_seconds: DEFAULT_WINDOW_SECONDS },
          key_fields: {
            rate_limit_points: { min: 1, max: RATE_LIMIT_MAXIMUMS.rate_limit_points },
            rate_limit_window_seconds: { min: 1, max: RATE_LIMIT_MAXIMUMS.rate_limit_window_seconds },
          },
          refusal: '429 RATE_LIMITED',
        },
        {
          name: 'daily requests',
          routes: 'every route except the bypassed ones',
          anonymous: { per_day: ClientQuotas.ANONYMOUS_DAILY_REQUESTS },
          key_default: null,
          key_fields: {},
          refusal: '429 DAILY_QUOTA_EXCEEDED',
        },
        {
          name: 'castle',
          routes: '/castle/player, /castle/search, /castle/analysis with kingdomId 0 or none (standard bridge)',
          anonymous: { per_minute: standard.anonymous.perMinute, per_day: standard.anonymous.perDay },
          key_default: { per_minute: standard.partner.perMinute, per_day: standard.partner.perDay },
          key_fields: {
            game_commands_per_minute: { min: 1, max: GAME_COMMAND_MAXIMUMS.game_commands_per_minute },
            game_commands_per_day: { min: 1, max: GAME_COMMAND_MAXIMUMS.game_commands_per_day },
          },
          refusal: '429 GAME_COMMAND_QUOTA_EXCEEDED',
        },
        {
          name: 'outer kingdoms',
          routes: '/castle/analysis with kingdomId 1, 2 or 3 (realtime bridge)',
          anonymous: { per_minute: realtime.anonymous.perMinute, per_day: realtime.anonymous.perDay },
          key_default: { per_minute: realtime.partner.perMinute, per_day: realtime.partner.perDay },
          key_fields: {},
          refusal: '429 GAME_COMMAND_QUOTA_EXCEEDED',
        },
        {
          name: 'chronicle cards',
          routes: '/assets/og/chronicle/* when the image is not cached yet',
          anonymous: { per_minute: CHRONICLE_RENDER_BUDGET.anonymousPerMinute },
          key_default: { per_minute: CHRONICLE_RENDER_BUDGET.partnerPerMinute(null) },
          key_fields: { chronicle_renders_per_minute: { min: 1, max: CHRONICLE_RENDERS_MAXIMUM } },
          refusal: '429 RATE_LIMITED',
        },
        {
          name: 'share cards',
          routes: 'the other /assets/og/* images when not cached yet',
          anonymous: { per_minute: SHARE_CARD_RENDER_BUDGET.anonymousPerMinute },
          key_default: { per_minute: SHARE_CARD_RENDER_BUDGET.partnerPerMinute(null) },
          key_fields: {},
          refusal: '429 RATE_LIMITED',
        },
      ],
    });
  }
}
