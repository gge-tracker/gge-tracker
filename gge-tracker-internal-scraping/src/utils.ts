//                                   __                        __
//    ____   ____   ____           _/  |_____________    ____ |  | __ ___________
//   / ___\ / ___\_/ __ \   ______ \   __\_  __ \__  \ _/ ___\|  |/ // __ \_  __ \
//  / /_/  > /_/  >  ___/  /_____/  |  |  |  | \// __ \\  \___|    <\  ___/|  | \/
//  \___  /\___  / \___  >          |__|  |__|  (____  /\___  >__|_ \\___  >__|
// /_____//_____/      \/                            \/     \/     \/    \/
//
//  Copyrights (c) 2025 - gge-tracker.com & gge-tracker contributors
//

/**
 * Utility class providing logging and progress reporting functionalities.
 */
class Utils {
  private static currentLogs = [];

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
   * Logs a message to the standard output with a timestamp and stores it in the current logs.
   *
   * @param message - The message components to log. All arguments are joined into a single string.
   */
  public static logMessage(...message: Array<any>): void {
    const messageStr: string = message.join(' ');
    const time: string = new Date().toLocaleTimeString();
    const logMessage: string = `[${time}] ${messageStr}\n`;
    process.stdout.write(logMessage);
    Utils.currentLogs.push(logMessage);
  }

  /**
   * Writes the current logs to a file in the `/app/logs` directory.
   * The filename format depends on the number of critical logs:
   * - If `nbCriticals` is greater than 0, the file is named with a `-CRITICAL.log` suffix.
   * - Otherwise, the file includes the minute and has a `.log` extension.
   *
   * The log file is created synchronously and contains all entries from `Utils.currentLogs`.
   * After writing, `Utils.currentLogs` is cleared.
   *
   * @param nbCriticals - The number of critical log entries.
   * @param server - The server identifier (default is `'FR1'`).
   */
  public static logsAllInFile(nbCriticals: number, server = 'FR1'): void {
    try {
      const date: Date = new Date();
      const year: number = date.getFullYear();
      const month: string = date.getMonth() < 9 ? `0${date.getMonth() + 1}` : `${date.getMonth() + 1}`;
      const day: string = date.getDate() < 10 ? `0${date.getDate()}` : `${date.getDate()}`;
      const hour: string = date.getHours() < 10 ? `0${date.getHours()}` : `${date.getHours()}`;
      const minutes: string = date.getMinutes() < 10 ? `0${date.getMinutes()}` : `${date.getMinutes()}`;
      let fileName: string;
      if (nbCriticals > 0) {
        fileName = `/app/logs/${year}-${month}-${day}-${hour}h-${server}-CRITICAL.log`;
      } else {
        fileName = `/app/logs/${year}-${month}-${day}-${hour}h-${minutes}m-${server}.log`;
      }
      const fs = require('fs');
      fs.writeFileSync(fileName, Utils.currentLogs.join('\n'));
    } catch (error) {
      console.error('Error in logsAllFile', error);
    } finally {
      Utils.currentLogs = [];
    }
  }
}

export default Utils;
