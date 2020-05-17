const mssql = require('mssql');
const mysql = require('mysql');
const pg = require('pg');
const pgQueryStream = require('pg-query-stream');

const nativeModules = {
  mssql,
  mysql,
  pg,
  pgQueryStream,
};

function driverConnect(driver, connection) {
  return driver.connect(nativeModules, connection);
}

module.exports = driverConnect;
