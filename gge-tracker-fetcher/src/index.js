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

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url).searchParams.get("url");
    if (!url) {
      return new Response("Missing ?url=", { status: 400 });
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

