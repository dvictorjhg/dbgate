import _ from 'lodash';
import { addCompleter, setCompleters } from 'ace-builds/src-noconflict/ext-language_tools';
import { getConnectionInfo, getDatabaseInfo, getSchemaList } from '../utility/metadataLoaders';
import analyseQuerySources from './analyseQuerySources';
import { getStringSettingsValue } from '../settings/settingsTools';
import { findEngineDriver, findDefaultSchema } from 'dbgate-tools';
import { getExtensions } from '../stores';

const COMMON_KEYWORDS = [
  'select',
  'where',
  'update',
  'delete',
  'group',
  'order',
  'from',
  'by',
  'create',
  'table',
  'drop',
  'alter',
  'view',
  'execute',
  'procedure',
  'distinct',
  'go',
];

function createTableLikeList(schemaList, dbinfo, schemaCondition) {
  console.log('@dvictorjhg 🔤 codeCompletion.createTableLikeList:', { schemaList, dbinfo, schemaCondition });
  return [
    ...(schemaList?.map(x => ({
      name: x.schemaName,
      value: x.schemaName,
      caption: x.schemaName,
      meta: 'schema',
      score: 1001,
    })) || []),
    ...(dbinfo.tables?.filter(schemaCondition).map(x => ({
      name: x.pureName,
      value: x.pureName,
      caption: x.pureName,
      meta: 'table',
      score: 1000,
    })) || []),
    ...(dbinfo.views?.filter(schemaCondition).map(x => ({
      name: x.pureName,
      value: x.pureName,
      caption: x.pureName,
      meta: 'view',
      score: 1000,
    })) || []),
    ...(dbinfo.matviews?.filter(schemaCondition).map(x => ({
      name: x.pureName,
      value: x.pureName,
      caption: x.pureName,
      meta: 'matview',
      score: 1000,
    })) || []),
    ...(dbinfo.functions?.filter(schemaCondition).map(x => ({
      name: x.pureName,
      value: x.pureName,
      caption: x.pureName,
      meta: 'function',
      score: 1000,
    })) || []),
    ...(dbinfo.procedures?.filter(schemaCondition).map(x => ({
      name: x.pureName,
      value: x.pureName,
      caption: x.pureName,
      meta: 'procedure',
      score: 1000,
    })) || []),
  ];
}

const getColumnCompletions = (table, meta = 'column') =>
  table.columns.map(x => ({
    name: x.columnName,
    value: x.columnName,
    caption: x.columnName,
    meta,
    score: 1000,
  }));

const getKeywordCompletions = convertUpper =>
  COMMON_KEYWORDS.map(word => ({
    name: convertUpper ? word.toUpperCase() : word,
    value: convertUpper ? word.toUpperCase() : word,
    caption: convertUpper ? word.toUpperCase() : word,
    meta: 'keyword',
    score: 800,
  }));

const getSourceObjectColumns = sourceObjects =>
  _.flatten(
    sourceObjects.map(obj =>
      (obj.columns || []).map(col => ({
        name: col.columnName,
        value: obj.alias ? `${obj.alias}.${col.columnName}` : col.columnName,
        caption: obj.alias ? `${obj.alias}.${col.columnName}` : col.columnName,
        meta: `column (${obj.pureName})`,
        score: 1200,
      }))
    )
  );

export function mountCodeCompletion({ conid, database, editor, getText }) {
  setCompleters([]);

  const getKeywordFilteredDbInfo = (dbinfo, lastKeyword) => {
    const onlyTables = ['FROM', 'JOIN', 'UPDATE', 'DELETE'].includes(lastKeyword);
    const onlyProcedures = ['EXEC', 'EXECUTE', 'CALL'].includes(lastKeyword);

    if (onlyTables) {
      console.log('@dvictorjhg 🔤 codeCompletion.getKeywordFilteredDbInfo:', { onlyTables, dbinfo });
      return {
        tables: dbinfo.tables,
        views: dbinfo.views,
        matviews: dbinfo.matviews,
        functions: dbinfo.functions,
      };
    }
    if (onlyProcedures) {
      return { procedures: dbinfo.procedures };
    }
    return dbinfo;
  };

  const getCompletionList = params => {
    // TODO: set the selected database in dbinfo
    const { qualifiedMatch, sources, dbinfo, schemaList, defaultSchema, sourceObjects, lastKeyword, convertUpper } =
      params;

    console.log('@dvictorjhg 🔤 codeCompletion.getCompletionList:', {
      qualifiedMatch,
      sources,
      dbinfo,
      schemaList,
      defaultSchema,
      sourceObjects,
      lastKeyword,
      convertUpper,
    });

    const baseList = getKeywordCompletions(convertUpper);
    const showOnlyTablesProcedures = ['FROM', 'JOIN', 'UPDATE', 'DELETE', 'EXEC', 'EXECUTE', 'CALL'].includes(
      lastKeyword
    );

    if (!qualifiedMatch) {
      return [
        ...(showOnlyTablesProcedures ? [] : baseList),
        ...createTableLikeList(
          schemaList,
          getKeywordFilteredDbInfo(dbinfo, lastKeyword),
          x => !defaultSchema || defaultSchema == x.Db
        ),
        ...(showOnlyTablesProcedures ? [] : getSourceObjectColumns(sourceObjects)),
      ];
    }

    const table = qualifiedMatch[1];
    const source = sources.find(x => (x.alias || x.name) == table);

    if (source) {
      const tableObj = dbinfo.tables.find(x => x.pureName == source.name);
      const viewObj = [...(dbinfo.views || []), ...(dbinfo.matviews || [])].find(x => x.pureName == source.name);
      return getColumnCompletions(tableObj || viewObj);
    }

    const schema = (schemaList || []).find(x => x.schemaName == qualifiedMatch[1]);
    console.log('@dvictorjhg 🔤 codeCompletion.getCompletionList.schema:', schema);
    return [
      ...(showOnlyTablesProcedures ? [] : baseList),
      ...createTableLikeList(
        schema ? [] : schemaList,
        getKeywordFilteredDbInfo(dbinfo, lastKeyword),
        schema ? x => x.Db === schema.schemaName : x => !defaultSchema || defaultSchema == x.Db
      ),
      ...(showOnlyTablesProcedures ? [] : getSourceObjectColumns(sourceObjects)),
    ];
  };

  const handleCompletions = async (editor, session, pos, prefix, callback) => {
    const cursor = session.selection.cursor;
    const line = session.getLine(cursor.row).slice(0, cursor.column);
    const dbinfo = await getDatabaseInfo({ conid, database });

    if (!dbinfo) {
      callback(null, getKeywordCompletions(false));
      return;
    }

    const schemaList = await getSchemaList({ conid, database });
    const connection = await getConnectionInfo({ conid });
    const driver = findEngineDriver(connection, getExtensions());
    const defaultSchema = findDefaultSchema(schemaList, driver.dialect);
    const convertUpper = getStringSettingsValue('sqlEditor.sqlCommandsCase', 'upperCase') == 'upperCase';

    const sources = analyseQuerySources(getText(), [
      ...dbinfo.tables.map(x => x.pureName),
      ...dbinfo.views.map(x => x.pureName),
      ...dbinfo.matviews.map(x => x.pureName),
    ]);

    const sourceObjects = sources.map(src => ({
      ...(dbinfo.tables.find(x => x.pureName == src.name) ||
        dbinfo.views.find(x => x.pureName == src.name) ||
        dbinfo.matviews.find(x => x.pureName == src.name)),
      alias: src.alias,
    }));

    const qualifiedMatch = line.match(/([a-zA-Z0-9_]+)\.([a-zA-Z0-9_]*)?$/);
    const lastKeywordMatch = line.match(/([a-zA-Z0-9_]*)\s*(([a-zA-Z0-9_]+)\.([a-zA-Z0-9_]*)?)?$/);
    const lastKeyword = lastKeywordMatch ? lastKeywordMatch[1].toUpperCase().trim() : '';

    const list = getCompletionList({
      qualifiedMatch,
      sources,
      dbinfo,
      schemaList,
      defaultSchema,
      sourceObjects,
      lastKeyword,
      convertUpper,
    });

    callback(null, list);
  };

  addCompleter({ getCompletions: handleCompletions });

  const doLiveAutocomplete = e => {
    const editor = e.editor;
    const hasCompleter = editor.completer && editor.completer.activated;
    const session = editor.session;
    const cursor = session.selection.cursor;
    const line = session.getLine(cursor.row).slice(0, cursor.column);

    if (e.command.name === 'insertstring') {
      if ((!hasCompleter && /^[a-zA-Z]/.test(e.args)) || e.args == '.') {
        editor.execCommand('startAutocomplete');
      }

      if (e.args == ' ' && /((from)|(join)|(update)|(call)|(exec)|(execute))\s*$/i.test(line)) {
        editor.execCommand('startAutocomplete');
      }
    }
  };

  editor.commands.on('afterExec', doLiveAutocomplete);
  return () => editor.commands.removeListener('afterExec', doLiveAutocomplete);
}
