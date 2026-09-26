import { useMemo, useState } from 'react';
import { PRODUCT_COLORS, STATUS_COLORS } from '../constants';
import { daysUntil, formatMoney } from '../format';

export default function OverviewTab({ entries, groups = [] }) {
  const [groupId, setGroupId] = useState('all');
  const scoped = useMemo(() => {
    if (groupId === 'all') return entries;
    if (groupId === 'none') return entries.filter((entry) => !entry.group_id);
    return entries.filter((entry) => String(entry.group_id) === String(groupId));
  }, [entries, groupId]);

  const stats = useMemo(() => {
    const active = scoped.filter((e) => e.status === 'active');
    const totalInvested = active.reduce((sum, e) => sum + Number(e.amount || 0), 0);
    const totalMaturity = active.reduce((sum, e) => sum + Number(e.maturity_amount || 0), 0);
    const gain = totalMaturity - totalInvested;
    const gainPct = totalInvested > 0 ? (gain / totalInvested) * 100 : 0;

    const byProduct = {};
    for (const e of active) {
      byProduct[e.product] = (byProduct[e.product] || 0) + Number(e.amount || 0);
    }
    const productData = Object.entries(byProduct).map(([name, value]) => ({ name, value }));

    const byStatus = {};
    for (const e of scoped) {
      byStatus[e.status] = (byStatus[e.status] || 0) + 1;
    }
    const statusData = Object.entries(byStatus).map(([name, value]) => ({ name, value }));

    const upcomingAll = scoped
      .filter((e) => e.status === 'active')
      .map((e) => ({ ...e, days: daysUntil(e.date_of_maturity) }))
      .filter((e) => e.days <= 90)
      .sort((a, b) => a.days - b.days);
    const upcoming = upcomingAll.slice(0, 30);

    return {
      totalInvested,
      totalMaturity,
      gain,
      gainPct,
      activeCount: active.length,
      productData,
      statusData,
      upcoming,
      upcomingCount: upcomingAll.length,
    };
  }, [scoped]);

  if (entries.length === 0) {
    return <div className="empty-state">No entries yet. Add one from the "Finance Entries" tab to see your overview.</div>;
  }

  return (
    <div className="tab-panel">
      <div className="toolbar">
        <select value={groupId} onChange={(event) => setGroupId(event.target.value)}>
          <option value="all">All groups</option>
          <option value="none">No group</option>
          {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
        </select>
      </div>
      {scoped.length === 0 ? (
        <div className="empty-state">No entries in this group.</div>
      ) : (
      <>
      <div className="stat-grid">
        <StatCard label="Records" value={scoped.length} hint={`${stats.activeCount} active`} />
        <StatCard label="Active invested" value={`₹${formatMoney(stats.totalInvested)}`} />
        <StatCard label="Expected maturity" value={`₹${formatMoney(stats.totalMaturity)}`} accent />
        <StatCard label="Projected gain" value={`₹${formatMoney(stats.gain)}`} hint={`${stats.gainPct.toFixed(1)}% of active invested`} accent />
      </div>

      <div className="analytics-grid">
        <div className="panel">
          <h3>Due within 90 days{stats.upcomingCount > stats.upcoming.length ? ` · ${stats.upcoming.length} of ${stats.upcomingCount}` : ''}</h3>
          {stats.upcoming.length === 0 ? (
            <div className="muted">Nothing maturing in the next 90 days.</div>
          ) : (
            <ul className="upcoming-list">
              {stats.upcoming.map((e) => (
                <li key={e.id}>
                  <div className="upcoming-main">
                    <strong>{e.serial_no}</strong>
                    <span>{e.owner_name} · {e.product}</span>
                  </div>
                  <span className={e.days < 0 ? 'badge badge-danger' : 'badge badge-warn'}>
                    {e.days < 0 ? `${Math.abs(e.days)}d overdue` : `${e.days}d left`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="analytics-side">
          <Breakdown
            title="Active amount by product"
            rows={stats.productData.map((row, index) => ({
              ...row,
              color: PRODUCT_COLORS[index % PRODUCT_COLORS.length],
            }))}
            formatValue={(value) => `₹${formatMoney(value)}`}
            empty="No active instruments."
          />
          <Breakdown
            title="Entries by status"
            rows={stats.statusData.map((row) => ({
              ...row,
              color: STATUS_COLORS[row.name] || '#94a3b8',
              name: row.name[0].toUpperCase() + row.name.slice(1),
            }))}
            formatValue={(value) => String(value)}
            empty="No entries."
          />
        </div>
      </div>
      </>
      )}
    </div>
  );
}

function StatCard({ label, value, hint, accent }) {
  return (
    <div className={`stat-card${accent ? ' stat-card-accent' : ''}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}

function Breakdown({ title, rows, formatValue, empty }) {
  const max = Math.max(...rows.map((row) => row.value), 1);
  return (
    <div className="panel">
      <h3>{title}</h3>
      {rows.length === 0 ? (
        <div className="muted">{empty}</div>
      ) : (
        <ul className="bar-list">
          {rows.map((row) => (
            <li key={row.name}>
              <div className="bar-meta">
                <span>{row.name}</span>
                <strong>{formatValue(row.value)}</strong>
              </div>
              <div className="bar-track">
                <div className="bar-fill" style={{ width: `${Math.max(6, (row.value / max) * 100)}%`, background: row.color }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
