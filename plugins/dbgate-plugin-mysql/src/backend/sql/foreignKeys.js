﻿module.exports = `
select 
	REFERENTIAL_CONSTRAINTS.CONSTRAINT_SCHEMA as Db,
	REFERENTIAL_CONSTRAINTS.CONSTRAINT_NAME as constraintName,
	REFERENTIAL_CONSTRAINTS.TABLE_NAME as pureName,
	REFERENTIAL_CONSTRAINTS.UPDATE_RULE as updateAction,
	REFERENTIAL_CONSTRAINTS.DELETE_RULE as deleteAction,
	REFERENTIAL_CONSTRAINTS.REFERENCED_TABLE_NAME as refTableName,
	KEY_COLUMN_USAGE.COLUMN_NAME as columnName,
	KEY_COLUMN_USAGE.REFERENCED_COLUMN_NAME as refColumnName
from INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS
inner join INFORMATION_SCHEMA.KEY_COLUMN_USAGE 
	on REFERENTIAL_CONSTRAINTS.TABLE_NAME = KEY_COLUMN_USAGE.TABLE_NAME 
	and REFERENTIAL_CONSTRAINTS.CONSTRAINT_NAME = KEY_COLUMN_USAGE.CONSTRAINT_NAME
	and REFERENTIAL_CONSTRAINTS.CONSTRAINT_SCHEMA = KEY_COLUMN_USAGE.CONSTRAINT_SCHEMA
where (REFERENTIAL_CONSTRAINTS.CONSTRAINT_SCHEMA = '#DATABASE#' OR '#DATABASE#' = 'undefined') and REFERENTIAL_CONSTRAINTS.TABLE_NAME =OBJECT_ID_CONDITION
order by KEY_COLUMN_USAGE.ORDINAL_POSITION
`;
