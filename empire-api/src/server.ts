import appFactory from './app.controller.js';
import { SocketService } from './utils/ws/sockets.js';

const APPLICATION_PORT = process.env.PORT ?? 3000;

/**
 * Prints a stylized ASCII art header to the console, including the application port
 * The header uses ANSI escape codes for colored output
 */
function printHeader(): void {
  const magenta_color = '\u001B[35m';
  const reset_color = '\u001B[0m';
  console.log(String.raw` ${reset_color}
  ${magenta_color}                                              __                        __
  ${magenta_color}              ____   ____   ____           _/  |_____________    ____ |  | __ ___________
  ${magenta_color}              / ___\ / ___\_/ __ \   ______ \   __\_  __ \__  \ _/ ___\|  |/ // __ \_  __ \
  ${magenta_color}            / /_/  > /_/  >  ___/  /_____/  |  |  |  | \// __ \\  \___|    <\  ___/|  | \/
  ${magenta_color}            \___  /\___  / \___  >          |__|  |__|  (____  /\___  >__|_ \\___  >__|
  ${magenta_color}            /_____//_____/      \/                            \/     \/     \/    \/
  ${magenta_color}
  ${magenta_color}                            🟢 GGE Tracker Empire-API running at PORT: ${APPLICATION_PORT}
`);
  console.log(reset_color);
}

SocketService.initialize();
console.log('Getting sockets...');
const sockets = await SocketService.getSockets();
SocketService.connectSockets(sockets);
const app = appFactory(sockets);
await new Promise((resolve) => setTimeout(resolve, 10_000));
app.listen(APPLICATION_PORT, () => printHeader());
