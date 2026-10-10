//
//                                   __                        __
//    ____   ____   ____           _/  |_____________    ____ |  | __ ___________
//   / ___\ / ___\_/ __ \   ______ \   __\_  __ \__  \ _/ ___\|  |/ // __ \_  __ \
//  / /_/  > /_/  >  ___/  /_____/  |  |  |  | \// __ \\  \___|    <\  ___/|  | \/
//  \___  /\___  / \___  >          |__|  |__|  (____  /\___  >__|_ \\___  >__|
// /_____//_____/      \/                            \/     \/     \/    \/
//
//  Copyrights (c) 2025 - gge-tracker.com & gge-tracker contributors
//
//

const ALLOWED_PREFIX = "https://empire-html5.goodgamestudios.com/default/";

export function isAllowedTarget(target) {
  if (!target?.startsWith(ALLOWED_PREFIX)) return false;
  try {
    const parsed = new URL(target);
    return parsed.origin + parsed.pathname.slice(0, "/default/".length) === ALLOWED_PREFIX.slice(0, -1) + "/";
  } catch {
    return false;
  }
}

export default {
  async fetch(request, env, ctx) {
    if (request.method !== "GET") {
      return new Response("Method not allowed", { status: 405, headers: { Allow: "GET" } });
    }
    const url = new URL(request.url).searchParams.get("url");
    if (!url) {
      return new Response("Missing ?url=", { status: 400 });
    }
    if (!isAllowedTarget(url)) {
      return new Response("Forbidden target", { status: 403 });
    }

    const retries = 3;
    let lastError;
    for (let i = 0; i < retries; i++) {
      try {
        const resp = await fetch(url);
        if (!resp.ok) throw new Error("Bad response");
        return resp;
      } catch (err) {
        lastError = err;
      }
    }
    return new Response("Failed after retries: " + lastError, { status: 500 });
  }
};
