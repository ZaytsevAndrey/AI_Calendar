import { MigrationInterface, QueryRunner } from 'typeorm';
import { toPaletteHex } from '../../modules/phases/phase-palette';

/**
 * Design system (Oct 2026): phase colors come from a ten-color palette.
 * Every stored phase color moves to the nearest palette color (CIE Lab distance).
 * Old colors are not kept, so `down` is a no-op.
 */
export class PhasePaletteColors1761810000000 implements MigrationInterface {
  name = 'PhasePaletteColors1761810000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const rows: Array<{ id: string; color: string | null }> = await queryRunner.query(
      `SELECT "id", "color" FROM "phases"`,
    );
    for (const row of rows) {
      const next = toPaletteHex(row.color);
      if (next !== row.color) {
        await queryRunner.query(`UPDATE "phases" SET "color" = $1 WHERE "id" = $2`, [next, row.id]);
      }
    }
  }

  public async down(): Promise<void> {
    // The previous free-form colors are gone; nothing to restore.
  }
}
