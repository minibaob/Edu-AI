// 仅用于本地演练的凭据无关假数据库。
// 复刻真实适配器用到的语义：from().select()/insertIfAbsent()/update() 返回可链式、可 await 的
// 构建器；order() 只接受普通列名。
// 写入结果控制（一次性）：control.mode = 'reject' | 'drop' 影响下一次写入；
// control.dropTable = '<table>' 只让指定表的下一次写入「已提交但响应丢失」。
// control.rejectTable = '<table>' 只让指定表的下一次写入被明确拒绝（没有提交）。
// control.writes 记录每一次写入尝试的表名，用于断言「不重放」。
// 不要把它打进 Function 包。
export function createFakeDb(control = { mode: 'ok', dropTable: null, rejectTable: null, writes: [] }) {
  if (!Array.isArray(control.writes)) control.writes = [];
  const tables = new Map();
  const rows = (table) => {
    if (!tables.has(table)) tables.set(table, []);
    return tables.get(table);
  };
  const pick = (row, columns) => (columns === '*' || columns === null
    ? { ...row }
    : Object.fromEntries(columns.split(',').map((c) => [c.trim(), row[c.trim()]])));

  const takeMode = (table) => {
    if (control.dropTable === table) { control.dropTable = null; return 'drop'; }
    if (control.rejectTable === table) { control.rejectTable = null; return 'reject'; }
    const mode = control.mode ?? 'ok';
    control.mode = 'ok';
    return mode;
  };

  function builder(table, mode, values) {
    const filters = [];
    let columns = '*';
    let orderBy = null, orderAscending = true, maxRows = Infinity, execution;
    const run = () => {
      const list = rows(table);
      const match = (row) => filters.every(([key, value]) => row[key] === value);

      if (mode === 'read') {
        const selected = list.filter(match);
        if (orderBy) {
          selected.sort((a, b) => {
            const cmp = String(a[orderBy]).localeCompare(String(b[orderBy]));
            return orderAscending ? cmp : -cmp;
          });
        }
        return { data: selected.slice(0, maxRows).map((row) => pick(row, columns)), error: null };
      }

      control.writes.push(table);

      if (mode === 'insert') {
        const incoming = Array.isArray(values.row) ? values.row : [values.row];
        const unique = (values.onConflict ?? '').split(',').map((c) => c.trim()).filter(Boolean);
        const keyOf = (row) => unique.map((k) => String(row[k])).join('|');
        // 每次写入构建一次键集合，避免逐行全表扫描（大批量导入时为 O(n²)）。
        const existingKeys = unique.length > 0 ? new Set(list.map(keyOf)) : null;
        const batchKeys = new Set();
        const batch = [];
        for (const row of incoming) {
          if (existingKeys) {
            const key = keyOf(row);
            if (existingKeys.has(key) || batchKeys.has(key)) continue;
            batchKeys.add(key);
          }
          batch.push(row);
        }
        if (batch.length === 0) return { data: [], error: null };
        const writeMode = takeMode(table);
        if (writeMode === 'reject') return { data: null, error: { code: 'write_failed', status: 409 } };
        // 'drop'：数据已提交，只是响应没回来。
        for (const row of batch) list.push({ ...row });
        if (writeMode === 'drop') throw new Error('simulated response loss');
        return { data: batch.map((row) => pick(row, columns)), error: null };
      }

      const writeMode = takeMode(table);
      if (writeMode === 'reject') return { data: null, error: { code: 'write_failed', status: 409 } };
      const matched = list.filter(match);
      for (const row of matched) Object.assign(row, values.row);
      if (writeMode === 'drop') throw new Error('simulated response loss');
      return { data: matched.map((row) => pick(row, columns)), error: null };
    };

    const chain = {
      eq(key, value) { filters.push([key, value]); return chain; },
      limit(count) { maxRows = count; return chain; },
      order(name, options) { orderBy = String(name); orderAscending = options?.ascending !== false; return chain; },
      select(names) { if (typeof names === 'string') columns = names; return chain; },
      then(resolve, reject) { execution ??= Promise.resolve().then(run); return execution.then(resolve, reject); },
    };
    return chain;
  }

  return {
    from(table) {
      return {
        select: (columns) => builder(table, 'read', null).select(columns),
        insertIfAbsent: (row, options) => builder(table, 'insert', { row, onConflict: options?.onConflict }),
        update: (row) => builder(table, 'update', { row }),
      };
    },
    // 仅测试使用：读取原始行，用于断言存储内容（例如不含明文口令）。
    dump: (table) => rows(table).map((row) => ({ ...row })),
  };
}
