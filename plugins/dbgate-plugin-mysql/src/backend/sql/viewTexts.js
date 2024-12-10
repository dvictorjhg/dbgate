module.exports = `
select 
    TABLE_SCHEMA as Db,
	TABLE_NAME as pureName, 
    VIEW_DEFINITION as viewDefinition
from information_schema.views 
where (TABLE_SCHEMA = '#DATABASE#' OR '#DATABASE#' = 'undefined') and TABLE_NAME =OBJECT_ID_CONDITION;
`;
