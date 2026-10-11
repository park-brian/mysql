// The shared reader must retain each classifier's subquery boundary.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseExpression } from '@myjs/parser'
import { constantNode, readsColumn } from '../../packages/core/src/sql/compile.ts'
import { containsAggregate } from '../../packages/core/src/sql/group.ts'
import { containsWindow } from '../../packages/core/src/sql/window.ts'

test('SQL proof readers distinguish row references, volatile calls and nested query blocks', () => {
  const cases: [string, boolean, boolean, boolean, boolean][] = [
    ['IF(1,2,JSON_ARRAY(3))', true, false, false, false],
    ['ABS(a)', false, true, false, false],
    ['ABS(SUM(a))', false, true, true, false],
    ['ROW_NUMBER() OVER (ORDER BY a)', false, true, false, true],
    ['(SELECT MAX(a) FROM t)', false, false, false, false],
    ['(SELECT ROW_NUMBER() OVER (ORDER BY a) FROM t)', false, false, false, false],
    ['CASE WHEN 1 THEN ABS(a) ELSE (SELECT RAND()) END', false, true, false, false],
    ['ABS(1)+RAND()', false, false, false, false],
    ['@v+1', false, false, false, false],
  ]
  for (const [sql, constant, column, aggregate, window] of cases) {
    const expression = parseExpression(sql)
    assert.deepEqual([constantNode(expression), readsColumn(expression), containsAggregate(expression), containsWindow(expression)], [constant, column, aggregate, window], sql)
  }
})
