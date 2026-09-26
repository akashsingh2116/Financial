export function isLocalId(id) {
  return String(id).startsWith('local:');
}

export function readFormData(formData) {
  const body = {};
  let file = null;
  for (const [key, value] of formData.entries()) {
    if (typeof File !== 'undefined' && value instanceof File) {
      if (value.size > 0) {
        file = { blob: value, name: value.name, type: value.type || 'application/octet-stream' };
      }
    } else {
      body[key] = value;
    }
  }
  return { body, file, removeDocument: body.remove_document === 'true' };
}

export function entryRecord(id, parsed, existing) {
  const body = parsed.body || {};
  const rate = body.interest_rate;
  const hasFile = Boolean(parsed.file);
  return {
    id,
    serial_no: body.serial_no || '',
    owner_name: body.owner_name || '',
    product: body.product || '',
    issuer: body.issuer || null,
    amount: Number(body.amount),
    interest_rate: rate === '' || rate == null ? null : Number(rate),
    maturity_amount: Number(body.maturity_amount),
    date_of_issue: body.date_of_issue || '',
    date_of_maturity: body.date_of_maturity || '',
    nominee_name: body.nominee_name || '',
    nominee_relation: body.nominee_relation || null,
    premium_frequency: body.premium_frequency || null,
    status: body.status || 'active',
    remarks: body.remarks || null,
    group_id: body.group_id === '' || body.group_id == null ? null : body.group_id,
    document_path: hasFile ? 'local' : (parsed.removeDocument ? null : existing?.document_path || null),
    document_original_name: hasFile ? parsed.file.name : (parsed.removeDocument ? null : existing?.document_original_name || null),
    pending: true,
    created_at: existing?.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

export function noteRecord(id, data, existing) {
  return {
    id,
    title: data.title || null,
    content: data.content,
    entry_id: data.entry_id || null,
    pending: true,
    created_at: existing?.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function copyOps(ops) {
  return ops.map((op) => ({
    ...op,
    record: op.record ? { ...op.record } : op.record,
  }));
}

export function queueOperation(ops, operation) {
  const next = copyOps(ops);
  const op = { ...operation, record: operation.record ? { ...operation.record } : operation.record };

  if (op.action === 'update') {
    const create = next.find((item) => item.kind === op.kind && item.action === 'create' && item.localId === op.targetId);
    if (create) {
      create.record = { ...op.record, id: create.localId, pending: true };
      if (op.kind === 'entry') {
        create.file = op.file || (op.removeDocument ? null : create.file);
        create.record.document_original_name = create.file
          ? create.file.name
          : (op.removeDocument ? null : create.record.document_original_name);
        create.record.document_path = create.file ? 'local' : (op.removeDocument ? null : create.record.document_path);
      }
      return next;
    }
    const pendingUpdate = next.find((item) => item.kind === op.kind && item.action === 'update' && String(item.targetId) === String(op.targetId));
    if (pendingUpdate) {
      pendingUpdate.record = op.record;
      if (op.file) pendingUpdate.file = op.file;
      if (op.removeDocument) {
        pendingUpdate.removeDocument = true;
        pendingUpdate.file = null;
      }
      return next;
    }
  }

  if (op.action === 'delete') {
    const createIndex = next.findIndex((item) => item.kind === op.kind && item.action === 'create' && item.localId === op.targetId);
    if (createIndex >= 0) {
      const localId = next[createIndex].localId;
      return next.filter((item, index) => {
        if (index === createIndex) return false;
        if (item.kind === op.kind && String(item.targetId) === String(localId)) return false;
        if (op.kind === 'entry' && item.kind === 'note' && item.action === 'create' && String(item.record?.entry_id) === String(localId)) return false;
        return true;
      }).map((item) => {
        if (op.kind === 'entry' && item.kind === 'note' && String(item.record?.entry_id) === String(localId)) {
          return { ...item, record: { ...item.record, entry_id: null } };
        }
        if (op.kind === 'group' && item.kind === 'entry' && String(item.record?.group_id) === String(localId)) {
          return { ...item, record: { ...item.record, group_id: null } };
        }
        return item;
      });
    }
    const withoutUpdates = next.filter((item) => !(item.kind === op.kind && item.action === 'update' && String(item.targetId) === String(op.targetId)));
    if (withoutUpdates.some((item) => item.kind === op.kind && item.action === 'delete' && String(item.targetId) === String(op.targetId))) {
      return withoutUpdates;
    }
    withoutUpdates.push(op);
    return withoutUpdates;
  }

  next.push(op);
  return next;
}

export function applyServerId(ops, localId, serverId) {
  return ops.map((op) => {
    const copy = { ...op, record: op.record ? { ...op.record } : op.record };
    if (String(copy.targetId) === String(localId)) copy.targetId = serverId;
    if (copy.record && String(copy.record.id) === String(localId)) copy.record.id = serverId;
    if (copy.record && String(copy.record.entry_id) === String(localId)) {
      copy.record.entry_id = serverId;
    }
    if (copy.record && String(copy.record.group_id) === String(localId)) {
      copy.record.group_id = serverId;
    }
    return copy;
  });
}

export function canSend(op) {
  if (op.kind === 'note' && isLocalId(op.record?.entry_id)) return false;
  if (op.kind === 'entry' && isLocalId(op.record?.group_id)) return false;
  return true;
}

export function mergeRecords(records, ops, kind) {
  const list = records.map((row) => ({ ...row }));
  for (const op of ops.filter((item) => item.kind === kind)) {
    if (op.action === 'create') {
      if (!list.some((row) => String(row.id) === String(op.localId))) list.push({ ...op.record, pending: true });
    } else if (op.action === 'update') {
      const index = list.findIndex((row) => String(row.id) === String(op.targetId));
      if (index >= 0) list[index] = { ...list[index], ...op.record, id: list[index].id, pending: true };
      else list.push({ ...op.record, pending: true });
    } else if (op.action === 'delete') {
      const index = list.findIndex((row) => String(row.id) === String(op.targetId));
      if (index >= 0) list.splice(index, 1);
    }
  }
  if (kind === 'entry') {
    const removedGroups = new Set(
      ops.filter((op) => op.kind === 'group' && op.action === 'delete').map((op) => String(op.targetId)),
    );
    for (const row of list) {
      if (removedGroups.has(String(row.group_id))) row.group_id = null;
    }
    list.sort((a, b) => String(a.date_of_maturity).localeCompare(String(b.date_of_maturity)));
  } else if (kind === 'group') {
    list.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  } else {
    list.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
  }
  return list;
}
