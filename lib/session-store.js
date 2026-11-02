const session = require("express-session");
module.exports = class PgStore extends session.Store {
  constructor(pool) {
    super();
    this.pool = pool;
  }
  get(sid, cb) {
    this.pool
      .query("SELECT data FROM app_sessions WHERE sid=$1 AND expires>now()", [
        sid,
      ])
      .then((r) => cb(null, r.rows[0]?.data))
      .catch(cb);
  }
  set(sid, data, cb = () => {}) {
    this.pool
      .query(
        "WITH expired AS (DELETE FROM app_sessions WHERE expires<now()) INSERT INTO app_sessions(sid,data,expires) VALUES($1,$2,$3) ON CONFLICT(sid) DO UPDATE SET data=$2,expires=$3",
        [sid, data, new Date(data.cookie.expires || Date.now() + 86400000)],
      )
      .then(() => cb())
      .catch(cb);
  }
  destroy(sid, cb = () => {}) {
    this.pool
      .query("DELETE FROM app_sessions WHERE sid=$1", [sid])
      .then(() => cb())
      .catch(cb);
  }
};
