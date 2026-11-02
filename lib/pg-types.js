// PostgreSQL DATE values represent calendar days, never timestamps or local midnight.
require("pg").types.setTypeParser(1082, (value) => value);
