module.exports = `
select CONSTRAINT_SCHEMA AS Db,
       CONSTRAINT_NAME as constraintName
  from information_schema.TABLE_CONSTRAINTS
 where (CONSTRAINT_SCHEMA = '#DATABASE#' OR '#DATABASE#' = 'undefined') and constraint_type = 'UNIQUE'
`;
