const Pool = require("pg").Pool;
const url = require("url");

const params = url.parse(
  "postgres://jftxenel:RIpmfeppx6Hfmp6x0swD02-UzlgKNSyx@hattie.db.elephantsql.com/jftxenel"
);
const auth = params.auth.split(":");

const pool = new Pool({
  user: auth[0],
  password: auth[1],
  host: params.hostname,
  port: params.port,
  database: params.pathname.split("/")[1],
});

module.exports = pool;
