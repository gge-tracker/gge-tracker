
import { getSockets, connectSockets } from './utils/ws/sockets.js';
import appFactory from './app.js';

const APPLICATION_PORT = process.env.PORT ?? 3000;

/**
 * Prints a stylized ASCII art header to the console, including the application port
 * The header uses ANSI escape codes for colored output
 */
function printHeader() {
  const magenta_color = "\u001b[35m";
  const reset_color = "\u001b[0m";
  console.log(` ${reset_color}
  ${magenta_color}                                              __                        __
  ${magenta_color}              ____   ____   ____           _/  |_____________    ____ |  | __ ___________
  ${magenta_color}              / ___\\ / ___\\_/ __ \\   ______ \\   __\\_  __ \\__  \\ _/ ___\\|  |/ // __ \\_  __ \\
  ${magenta_color}            / /_/  > /_/  >  ___/  /_____/  |  |  |  | \\// __ \\\\  \\___|    <\\  ___/|  | \\/
  ${magenta_color}            \\___  /\\___  / \\___  >          |__|  |__|  (____  /\\___  >__|_ \\\\___  >__|
  ${magenta_color}            /_____//_____/      \\/                            \\/     \\/     \\/    \\/
  ${magenta_color}
  ${magenta_color}                            🟢 GGE Tracker Empire-API running at PORT: ${APPLICATION_PORT}
          `);
  console.log(reset_color);
}

getSockets().then(async sockets => {
    console.log("Getting sockets...");
    connectSockets(sockets);
    const app = appFactory(sockets);
    await new Promise(resolve => setTimeout(resolve, 10000));
    app.listen(APPLICATION_PORT, () => printHeader());
});
