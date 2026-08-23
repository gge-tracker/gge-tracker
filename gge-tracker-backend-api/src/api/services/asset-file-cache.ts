import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import path from 'node:path';

const MAX_FILENAME_LENGTH = 120;

/**
 * Versioned on-disk cache for the Goodgame Empire assets the API serves
 */
export abstract class AssetFileCache {
  private static readonly ROOT = path.join(__dirname, './../assets/cache');

  public static async read(version: string, name: string): Promise<Buffer | null> {
    try {
      return await fs.promises.readFile(this.resolve(version, name));
    } catch {
      return null;
    }
  }

  public static async has(version: string, name: string): Promise<boolean> {
    try {
      await fs.promises.access(this.resolve(version, name));
      return true;
    } catch {
      return false;
    }
  }

  public static async write(version: string, name: string, data: Buffer): Promise<void> {
    const target = this.resolve(version, name);
    try {
      await fs.promises.mkdir(path.dirname(target), { recursive: true });
      // Rename is atomic on the same filesystem, so a concurrent reader never sees a partial file
      const temporary = `${target}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
      await fs.promises.writeFile(temporary, data);
      await fs.promises.rename(temporary, target);
    } catch (error) {
      console.error('[AssetFileCache] failed to write %s: %s', target, error);
    }
  }

  public static async pruneOtherVersions(keep: string): Promise<void> {
    const kept = this.safeSegment(keep);
    try {
      const entries = await fs.promises.readdir(this.ROOT, { withFileTypes: true });
      await Promise.all(
        entries
          .filter((entry) => entry.isDirectory() && entry.name !== kept)
          .map((entry) => fs.promises.rm(path.join(this.ROOT, entry.name), { recursive: true, force: true })),
      );
    } catch {}
  }

  private static resolve(version: string, name: string): string {
    return path.join(this.ROOT, this.safeSegment(version), this.safeFileName(name));
  }

  private static safeSegment(value: string): string {
    const cleaned = String(value ?? '')
      .toLowerCase()
      .replaceAll(/[^\da-z]/g, '');
    return cleaned || '0';
  }

  private static safeFileName(name: string): string {
    const cleaned = String(name ?? '')
      .toLowerCase()
      .replaceAll(/[^\d._a-z-]/g, '');
    if (!cleaned) throw new Error('Empty asset cache file name');
    if (cleaned.length <= MAX_FILENAME_LENGTH) return cleaned;
    const extension = path.extname(cleaned);
    const digest = crypto.createHash('sha256').update(cleaned).digest('hex').slice(0, 16);
    return `${cleaned.slice(0, MAX_FILENAME_LENGTH - extension.length - 17)}-${digest}${extension}`;
  }
}
