import _ from 'lodash';
import {
  AlterProcessor,
  ColumnInfo,
  ConstraintInfo,
  DatabaseInfo,
  NamedObjectInfo,
  SqlDialect,
  TableInfo,
} from '../../types';
import { DatabaseInfoAlterProcessor } from './database-info-alter-processor';
import { DatabaseAnalyser } from './DatabaseAnalyser';

interface AlterOperation_CreateTable {
  operationType: 'createTable';
  newObject: TableInfo;
}

interface AlterOperation_DropTable {
  operationType: 'dropTable';
  oldObject: TableInfo;
}

interface AlterOperation_RenameTable {
  operationType: 'renameTable';
  object: TableInfo;
  newName: string;
}

interface AlterOperation_CreateColumn {
  operationType: 'createColumn';
  newObject: ColumnInfo;
}

interface AlterOperation_ChangeColumn {
  operationType: 'changeColumn';
  oldObject: ColumnInfo;
  newObject: ColumnInfo;
}

interface AlterOperation_RenameColumn {
  operationType: 'renameColumn';
  object: ColumnInfo;
  newName: string;
}

interface AlterOperation_DropColumn {
  operationType: 'dropColumn';
  oldObject: ColumnInfo;
}

interface AlterOperation_CreateConstraint {
  operationType: 'createConstraint';
  newObject: ConstraintInfo;
}

interface AlterOperation_ChangeConstraint {
  operationType: 'changeConstraint';
  oldObject: ConstraintInfo;
  newObject: ConstraintInfo;
}

interface AlterOperation_DropConstraint {
  operationType: 'dropConstraint';
  oldObject: ConstraintInfo;
}

interface AlterOperation_RenameConstraint {
  operationType: 'renameConstraint';
  object: ConstraintInfo;
  newName: string;
}
interface AlterOperation_RecreateTable {
  operationType: 'recreateTable';
  table: TableInfo;
  operations: AlterOperation[];
}

type AlterOperation =
  | AlterOperation_CreateColumn
  | AlterOperation_ChangeColumn
  | AlterOperation_DropColumn
  | AlterOperation_CreateConstraint
  | AlterOperation_ChangeConstraint
  | AlterOperation_DropConstraint
  | AlterOperation_CreateTable
  | AlterOperation_DropTable
  | AlterOperation_RenameTable
  | AlterOperation_RenameColumn
  | AlterOperation_RenameConstraint
  | AlterOperation_RecreateTable;

export class AlterPlan {
  public operations: AlterOperation[] = [];
  constructor(public db: DatabaseInfo, public dialect: SqlDialect) {}

  createTable(table: TableInfo) {
    this.operations.push({
      operationType: 'createTable',
      newObject: table,
    });
  }

  dropTable(table: TableInfo) {
    this.operations.push({
      operationType: 'dropTable',
      oldObject: table,
    });
  }

  createColumn(column: ColumnInfo) {
    this.operations.push({
      operationType: 'createColumn',
      newObject: column,
    });
  }

  changeColumn(oldColumn: ColumnInfo, newColumn: ColumnInfo) {
    this.operations.push({
      operationType: 'changeColumn',
      oldObject: oldColumn,
      newObject: newColumn,
    });
  }

  dropColumn(column: ColumnInfo) {
    this.operations.push({
      operationType: 'dropColumn',
      oldObject: column,
    });
  }

  createConstraint(constraint: ConstraintInfo) {
    this.operations.push({
      operationType: 'createConstraint',
      newObject: constraint,
    });
  }

  changeConstraint(oldConstraint: ConstraintInfo, newConstraint: ConstraintInfo) {
    this.operations.push({
      operationType: 'changeConstraint',
      oldObject: oldConstraint,
      newObject: newConstraint,
    });
  }

  dropConstraint(constraint: ConstraintInfo) {
    this.operations.push({
      operationType: 'dropConstraint',
      oldObject: constraint,
    });
  }

  renameTable(table: TableInfo, newName: string) {
    this.operations.push({
      operationType: 'renameTable',
      object: table,
      newName,
    });
  }

  renameColumn(column: ColumnInfo, newName: string) {
    this.operations.push({
      operationType: 'renameColumn',
      object: column,
      newName,
    });
  }

  renameConstraint(constraint: ConstraintInfo, newName: string) {
    this.operations.push({
      operationType: 'renameConstraint',
      object: constraint,
      newName,
    });
  }

  recreateTable(table: TableInfo, operations: AlterOperation[]) {
    this.operations.push({
      operationType: 'recreateTable',
      table,
      operations,
    });
  }

  run(processor: AlterProcessor) {
    for (const op of this.operations) {
      runAlterOperation(op, processor);
    }
  }

  _getDependendColumnConstraints(column: ColumnInfo, dependencyDefinition) {
    const table = this.db.tables.find(x => x.pureName == column.pureName && x.schemaName == column.schemaName);
    const fks = dependencyDefinition?.includes('dependencies')
      ? table.dependencies.filter(fk => fk.columns.find(col => col.refColumnName == column.columnName))
      : [];
    const constraints = _.compact([
      dependencyDefinition?.includes('primaryKey') ? table.primaryKey : null,
      ...(dependencyDefinition?.includes('foreignKeys') ? table.foreignKeys : []),
      ...(dependencyDefinition?.includes('indexes') ? table.indexes : []),
      ...(dependencyDefinition?.includes('uniques') ? table.uniques : []),
    ]).filter(cnt => cnt.columns.find(col => col.columnName == column.columnName));

    return [...fks, ...constraints];
  }

  _addLogicalDependencies(): AlterOperation[] {
    const lists = this.operations.map(op => {
      if (op.operationType == 'dropColumn') {
        const constraints = this._getDependendColumnConstraints(op.oldObject, this.dialect.dropColumnDependencies);

        const res: AlterOperation[] = [
          ...constraints.map(oldObject => {
            const opRes: AlterOperation = {
              operationType: 'dropConstraint',
              oldObject,
            };
            return opRes;
          }),
          op,
        ];
        return res;
      }

      if (op.operationType == 'changeColumn') {
        const constraints = this._getDependendColumnConstraints(op.oldObject, this.dialect.changeColumnDependencies);

        const res: AlterOperation[] = [
          ...constraints.map(oldObject => {
            const opRes: AlterOperation = {
              operationType: 'dropConstraint',
              oldObject,
            };
            return opRes;
          }),
          op,
          ..._.reverse([...constraints]).map(newObject => {
            const opRes: AlterOperation = {
              operationType: 'createConstraint',
              newObject,
            };
            return opRes;
          }),
        ];
        return res;
      }

      if (op.operationType == 'dropTable') {
        return [
          ...(op.oldObject.dependencies || []).map(oldObject => ({
            operationType: 'dropConstraint',
            oldObject,
          })),
          op,
        ];
      }

      return [op];
    });

    return _.flatten(lists);
  }

  _transformToImplementedOps(): AlterOperation[] {
    const lists = this.operations.map(op => {
      return (
        this._testTableRecreate(op, 'createColumn', this.dialect.createColumn, 'newObject') ||
        this._testTableRecreate(op, 'dropColumn', this.dialect.dropColumn, 'oldObject') ||
        this._testTableRecreate(op, 'createConstraint', obj => this._canCreateConstraint(obj), 'newObject') ||
        this._testTableRecreate(op, 'dropConstraint', obj => this._canDropConstraint(obj), 'oldObject') ||
        this._testTableRecreate(op, 'changeColumn', this.dialect.changeColumn, 'newObject') || [op]
      );
    });

    return _.flatten(lists);
  }

  _canCreateConstraint(cnt: ConstraintInfo) {
    if (cnt.constraintType == 'primaryKey') return this.dialect.createPrimaryKey;
    if (cnt.constraintType == 'foreignKey') return this.dialect.createForeignKey;
    if (cnt.constraintType == 'index') return this.dialect.createIndex;
    if (cnt.constraintType == 'unique') return this.dialect.createUnique;
    if (cnt.constraintType == 'check') return this.dialect.createCheck;
    return null;
  }

  _canDropConstraint(cnt: ConstraintInfo) {
    if (cnt.constraintType == 'primaryKey') return this.dialect.dropPrimaryKey;
    if (cnt.constraintType == 'foreignKey') return this.dialect.dropForeignKey;
    if (cnt.constraintType == 'index') return this.dialect.dropIndex;
    if (cnt.constraintType == 'unique') return this.dialect.dropUnique;
    if (cnt.constraintType == 'check') return this.dialect.dropCheck;
    return null;
  }

  _testTableRecreate(
    op: AlterOperation,
    operationType: string,
    isAllowed: boolean | Function,
    objectField: string
  ): AlterOperation[] | null {
    if (op.operationType == operationType) {
      if (_.isFunction(isAllowed)) {
        if (isAllowed(op[objectField])) return null;
      } else {
        if (isAllowed) return null;
      }

      // console.log('*****************RECREATED NEEDED', op, operationType, isAllowed);
      // console.log(this.dialect);
      const table = this.db.tables.find(
        x => x.pureName == op[objectField].pureName && x.schemaName == op[objectField].schemaName
      );
      return [
        {
          operationType: 'recreateTable',
          table,
          operations: [op],
        },
      ];
    }
    return null;
  }

  _groupTableRecreations(): AlterOperation[] {
    const res = [];
    const recreates = {};
    for (const op of this.operations) {
      if (op.operationType == 'recreateTable') {
        const recreate = {
          ...op,
          operations: [...op.operations],
        };
        res.push(recreate);
        recreates[`${op.table.schemaName}||${op.table.pureName}`] = recreate;
      } else {
        // @ts-ignore
        const oldObject: TableInfo = op.oldObject;
        if (oldObject) {
          const recreated = recreates[`${oldObject.schemaName}||${oldObject.pureName}`];
          if (recreated) {
            recreated.operations.push(op);
            continue;
          }
        }
        res.push(op);
      }
    }
    return res;
  }

  transformPlan() {
    // console.log('*****************OPERATIONS0', this.operations);

    this.operations = this._addLogicalDependencies();

    // console.log('*****************OPERATIONS1', this.operations);

    this.operations = this._transformToImplementedOps();

    // console.log('*****************OPERATIONS2', this.operations);

    this.operations = this._groupTableRecreations();

    // console.log('*****************OPERATIONS3', this.operations);
  }
}

export function runAlterOperation(op: AlterOperation, processor: AlterProcessor) {
  switch (op.operationType) {
    case 'createTable':
      processor.createTable(op.newObject);
      break;
    case 'changeColumn':
      processor.changeColumn(op.oldObject, op.newObject);
      break;
    case 'createColumn':
      processor.createColumn(op.newObject, []);
      break;
    case 'dropColumn':
      processor.dropColumn(op.oldObject);
      break;
    case 'dropTable':
      processor.dropTable(op.oldObject);
      break;
    case 'changeConstraint':
      processor.changeConstraint(op.oldObject, op.newObject);
      break;
    case 'createConstraint':
      processor.createConstraint(op.newObject);
      break;
    case 'dropConstraint':
      processor.dropConstraint(op.oldObject);
      break;
    case 'renameColumn':
      processor.renameColumn(op.object, op.newName);
      break;
    case 'renameTable':
      processor.renameTable(op.object, op.newName);
      break;
    case 'renameConstraint':
      processor.renameConstraint(op.object, op.newName);
      break;
    case 'recreateTable':
      {
        const newTable = _.cloneDeep(op.table);
        const newDb = DatabaseAnalyser.createEmptyStructure();
        newDb.tables.push(newTable);
        // console.log('////////////////////////////newTable1', newTable);
        op.operations.forEach(child => runAlterOperation(child, new DatabaseInfoAlterProcessor(newDb)));
        // console.log('////////////////////////////op.operations', op.operations);
        // console.log('////////////////////////////op.table', op.table);
        // console.log('////////////////////////////newTable2', newTable);
        processor.recreateTable(op.table, newTable);
      }
      break;
  }
}
