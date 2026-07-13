//                                   __                        __
//    ____   ____   ____           _/  |_____________    ____ |  | __ ___________
//   / ___\ / ___\_/ __ \   ______ \   __\_  __ \__  \ _/ ___\|  |/ // __ \_  __ \
//  / /_/  > /_/  >  ___/  /_____/  |  |  |  | \// __ \\  \___|    <\  ___/|  | \/
//  \___  /\___  / \___  >          |__|  |__|  (____  /\___  >__|_ \\___  >__|
// /_____//_____/      \/                            \/     \/     \/    \/
//
//  Copyrights (c) 2026 - gge-tracker.com & gge-tracker contributors
//
import * as path from 'path';
import { pino, destination, stdTimeFunctions, Logger } from 'pino';

const isDevelopment: boolean = process.env.ENVIRONMENT === 'development';

/**
 * Structured logger writing NDJSON to stdout. The Docker `json-file` driver persists it and
 * Promtail ships it to Loki (see `monitoring/promtail-config.yml`), so no log file is written
 * by the process itself.
 *
 * Every record carries `service`, `script` and `server` so a single run can be isolated in
 * Grafana. In development the output is piped through `pino-pretty` for human reading.
 */
const logger: Logger = pino(
  {
    level: process.env.LOG_LEVEL ?? 'info',
    base: {
      service: 'internal-scraping',
      script: path.basename(process.argv[1] ?? 'unknown', '.js'),
      server: process.env.LOG_SUFFIX ?? process.env.TARGET_LOG_SUFFIX,
    },
    timestamp: stdTimeFunctions.isoTime,
    formatters: { level: (label: string) => ({ level: label }) },
    ...(isDevelopment
      ? { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } } }
      : {}),
  },
  // These are short-lived one-shot containers that may `process.exit()` on an error path;
  // synchronous writes guarantee the last records are not lost on exit.
  isDevelopment ? undefined : destination({ sync: true }),
);

/**
 * Utility class providing logging and progress reporting functionalities.
 */
class Utils {
  /**
   * Writes a progress message to the standard output, displaying the current percentage
   * of completion and the current time.
   *
   * @param actualProcess - The current progress value.
   * @param maxProcess - The maximum value representing completion.
   */
  public static stdoudInfo(actualProcess: number, maxProcess: number): void {
    const percent: number = (actualProcess / maxProcess) * 100;
    const percentStr: string = percent.toFixed(2);
    const time: string = new Date().toLocaleTimeString();
    process.stdout.write(`[${time}]` + ` Work in progress ${percentStr}% (${actualProcess}/${maxProcess}).\r`);
  }

  /**
   * Logs a message at `info` level.
   *
   * @param message - The message components to log. All arguments are joined into a single string.
   */
  public static logMessage(...message: Array<any>): void {
    logger.info(Utils.formatMessage(message));
  }

  /**
   * Logs a message at `warn` level.
   *
   * @param message - The message components to log. All arguments are joined into a single string.
   */
  public static logWarning(...message: Array<any>): void {
    logger.warn(Utils.formatMessage(message));
  }

  /**
   * Logs a message at `error` level. Use this for anything counted as a critical error, so it can
   * be alerted on in Grafana with `{service="internal-scraping", level="error"}`.
   *
   * @param message - The message components to log. All arguments are joined into a single string.
   */
  public static logError(...message: Array<any>): void {
    logger.error(Utils.formatMessage(message));
  }

  /**
   * Emits the closing record of a run. Replaces the previous per-run log file: instead of encoding
   * severity in a `-CRITICAL.log` filename, the summary is logged at `error` level when the run
   * produced critical errors and at `info` level otherwise.
   *
   * The `server` label is not taken from here but from `LOG_SUFFIX`, which identifies the container.
   * A single container runs several scopes (the server itself, plus pseudo-scopes such as
   * `GLOBAL_RANKING` or `GT_TOURNAMENT`), so the argument is recorded as `scope` instead.
   *
   * @param nbCriticals - The number of critical errors recorded during the run.
   * @param scope - The scope that just finished (default is `'FR1'`).
   */
  public static flushRunSummary(nbCriticals: number, scope = 'FR1'): void {
    const summary = { event: 'run_summary', scope, criticalErrors: nbCriticals };
    if (nbCriticals > 0) {
      logger.error(summary, `Run finished with ${nbCriticals} critical error(s)`);
    } else {
      logger.info(summary, 'Run finished without critical error');
    }
  }

  public static getDiscordEmojis(): string[] {
    return [
      ':checkered_flag:',
      ':crossed_flags:',
      ':flag_ac:',
      ':flag_ad:',
      ':flag_ae:',
      ':flag_af:',
      ':flag_ag:',
      ':flag_ai:',
      ':flag_al:',
      ':flag_am:',
      ':flag_ao:',
      ':flag_aq:',
      ':flag_ar:',
      ':flag_as:',
      ':flag_at:',
      ':flag_au:',
      ':flag_aw:',
      ':flag_ax:',
      ':flag_az:',
      ':flag_ba:',
      ':flag_bb:',
      ':flag_bd:',
      ':flag_be:',
      ':flag_bf:',
      ':flag_bg:',
      ':flag_bh:',
      ':flag_bi:',
      ':flag_bj:',
      ':flag_bl:',
      ':flag_black:',
      ':flag_bm:',
      ':flag_bn:',
      ':flag_bo:',
      ':flag_bq:',
      ':flag_br:',
      ':flag_bs:',
      ':flag_bt:',
      ':flag_bv:',
      ':flag_bw:',
      ':flag_by:',
      ':flag_bz:',
      ':flag_ca:',
      ':flag_cc:',
      ':flag_cd:',
      ':flag_cf:',
      ':flag_cg:',
      ':flag_ch:',
      ':flag_ci:',
      ':flag_ck:',
      ':flag_cl:',
      ':flag_cm:',
      ':flag_cn:',
      ':flag_co:',
      ':flag_cp:',
      ':flag_cr:',
      ':flag_cu:',
      ':flag_cv:',
      ':flag_cw:',
      ':flag_cx:',
      ':flag_cy:',
      ':flag_cz:',
      ':flag_de:',
      ':flag_dg:',
      ':flag_dj:',
      ':flag_dk:',
      ':flag_dm:',
      ':flag_do:',
      ':flag_dz:',
      ':flag_ea:',
      ':flag_ec:',
      ':flag_ee:',
      ':flag_eg:',
      ':flag_eh:',
      ':flag_er:',
      ':flag_es:',
      ':flag_et:',
      ':flag_eu:',
      ':flag_fi:',
      ':flag_fj:',
      ':flag_fk:',
      ':flag_fm:',
      ':flag_fo:',
      ':flag_fr:',
      ':flag_ga:',
      ':flag_gb:',
      ':flag_gd:',
      ':flag_ge:',
      ':flag_gf:',
      ':flag_gg:',
      ':flag_gh:',
      ':flag_gi:',
      ':flag_gl:',
      ':flag_gm:',
      ':flag_gn:',
      ':flag_gp:',
      ':flag_gq:',
      ':flag_gr:',
      ':flag_gs:',
      ':flag_gt:',
      ':flag_gu:',
      ':flag_gw:',
      ':flag_gy:',
      ':flag_hk:',
      ':flag_hm:',
      ':flag_hn:',
      ':flag_hr:',
      ':flag_ht:',
      ':flag_hu:',
      ':flag_ic:',
      ':flag_id:',
      ':flag_ie:',
      ':flag_il:',
      ':flag_im:',
      ':flag_in:',
      ':flag_io:',
      ':flag_iq:',
      ':flag_ir:',
      ':flag_is:',
      ':flag_it:',
      ':flag_je:',
      ':flag_jm:',
      ':flag_jo:',
      ':flag_jp:',
      ':flag_ke:',
      ':flag_kg:',
      ':flag_kh:',
      ':flag_ki:',
      ':flag_km:',
      ':flag_kn:',
      ':flag_kp:',
      ':flag_kr:',
      ':flag_kw:',
      ':flag_ky:',
      ':flag_kz:',
      ':flag_la:',
      ':flag_lb:',
      ':flag_lc:',
      ':flag_li:',
      ':flag_lk:',
      ':flag_lr:',
      ':flag_ls:',
      ':flag_lt:',
      ':flag_lu:',
      ':flag_lv:',
      ':flag_ly:',
      ':flag_ma:',
      ':flag_mc:',
      ':flag_md:',
      ':flag_me:',
      ':flag_mf:',
      ':flag_mg:',
      ':flag_mh:',
      ':flag_mk:',
      ':flag_ml:',
      ':flag_mm:',
      ':flag_mn:',
      ':flag_mo:',
      ':flag_mp:',
      ':flag_mq:',
      ':flag_mr:',
      ':flag_ms:',
      ':flag_mt:',
      ':flag_mu:',
      ':flag_mv:',
      ':flag_mw:',
      ':flag_mx:',
      ':flag_my:',
      ':flag_mz:',
      ':flag_na:',
      ':flag_nc:',
      ':flag_ne:',
      ':flag_nf:',
      ':flag_ng:',
      ':flag_ni:',
      ':flag_nl:',
      ':flag_no:',
      ':flag_np:',
      ':flag_nr:',
      ':flag_nu:',
      ':flag_nz:',
      ':flag_om:',
      ':flag_pa:',
      ':flag_pe:',
      ':flag_pf:',
      ':flag_pg:',
      ':flag_ph:',
      ':flag_pk:',
      ':flag_pl:',
      ':flag_pm:',
      ':flag_pn:',
      ':flag_pr:',
      ':flag_ps:',
      ':flag_pt:',
      ':flag_pw:',
      ':flag_py:',
      ':flag_qa:',
      ':flag_re:',
      ':flag_ro:',
      ':flag_rs:',
      ':flag_ru:',
      ':flag_rw:',
      ':flag_sa:',
      ':flag_sb:',
      ':flag_sc:',
      ':flag_sd:',
      ':flag_se:',
      ':flag_sg:',
      ':flag_sh:',
      ':flag_si:',
      ':flag_sj:',
      ':flag_sk:',
      ':flag_sl:',
      ':flag_sm:',
      ':flag_sn:',
      ':flag_so:',
      ':flag_sr:',
      ':flag_ss:',
      ':flag_st:',
      ':flag_sv:',
      ':flag_sx:',
      ':flag_sy:',
      ':flag_sz:',
      ':flag_ta:',
      ':flag_tc:',
      ':flag_td:',
      ':flag_tf:',
      ':flag_tg:',
      ':flag_th:',
      ':flag_tj:',
      ':flag_tk:',
      ':flag_tl:',
      ':flag_tm:',
      ':flag_tn:',
      ':flag_to:',
      ':flag_tr:',
      ':flag_tt:',
      ':flag_tv:',
      ':flag_tw:',
      ':flag_tz:',
      ':flag_ua:',
      ':flag_ug:',
      ':flag_um:',
      ':flag_us:',
      ':flag_uy:',
      ':flag_uz:',
      ':flag_va:',
      ':flag_vc:',
      ':flag_ve:',
      ':flag_vg:',
      ':flag_vi:',
      ':flag_vn:',
      ':flag_vu:',
      ':flag_wf:',
      ':flag_white:',
      ':flag_ws:',
      ':flag_xk:',
      ':flag_ye:',
      ':flag_yt:',
      ':flag_za:',
      ':flag_zm:',
      ':flag_zw:',
      ':pirate_flag:',
      ':rainbow_flag: :gay_pride_flag:',
      ':transgender_flag:',
      ':triangular_flag_on_post:',
    ];
  }

  /**
   * Renders log arguments into a single message. `Error` instances are expanded to their stack
   * trace and plain objects are serialized, so neither is flattened into `[object Object]`.
   *
   * @param message - The message components to render.
   */
  private static formatMessage(message: Array<any>): string {
    return message
      .map((part: any): string => {
        if (part instanceof Error) {
          return part.stack ?? `${part.name}: ${part.message}`;
        }
        if (typeof part === 'object' && part !== null) {
          try {
            return JSON.stringify(part);
          } catch {
            return String(part);
          }
        }
        return String(part);
      })
      .join(' ');
  }
}

export default Utils;
