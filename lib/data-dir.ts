import "server-only";
import path from "path";

// JSON-file store location (used when DATABASE_URL is unset).
// Railway's default filesystem is EPHEMERAL (wiped every deploy) — attach a
// Railway Volume (mounted at e.g. /data) and set DATA_DIR=/data, or just set
// DATABASE_URL to use Postgres instead. Locally falls back to ./data.
export const DATA_DIR =
  process.env.DATA_DIR ?? path.join(process.cwd(), "data");
