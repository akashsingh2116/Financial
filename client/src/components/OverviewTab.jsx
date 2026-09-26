import { useMemo } from 'react';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { PRODUCT_COLORS, STATUS_COLORS } from '../constants';
import { daysUntil, formatMoney } from '../format';

const chartTooltip = {
  background: '#171e2e',
  border: '1px solid #52607a',
  borderRadius: 8,
  color: '#f5f7fb',
};
const chartTooltipItem = { color: '#f5f7fb' };
const chartLegend = { color: '#f5f7fb' };

export default function OverviewTab({ entries }) {
  const stats = useMemo(() => {
    const active = entries.filter((e) => e.status === 'active');
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
    for (const e of entries) {
      byStatus[e.status] = (byStatus[e.status] || 0) + 1;
    }
    const statusData = Object.entries(byStatus).map(([name, value]) => ({ name, value }));

    const upcoming = entries
      .filter((e) => e.status === 'active')
      .map((e) => ({ ...e, days: daysUntil(e.date_of_maturity) }))
      .filter((e) => e.days <= 90)
      .sort((a, b) => a.days - b.days);

    return {
      totalInvested,
      totalMaturity,
      gain,
      gainPct,
      activeCount: active.length,
      productData,
      statusData,
      upcoming,
    };
  }, [entries]);

  if (entries.length === 0) {
    return <div className="empty-state">No entries yet. Add one from the "Finance Entries" tab to see your overview.</div>;
  }

  return (
    <div className="tab-panel">
      <div className="stat-grid">
        <StatCard label="Total Policies / Instruments" value={entries.length} />
        <StatCard label="Active" value={stats.activeCount} />
        <StatCard label="Active invested" value={`₹${formatMoney(stats.totalInvested)}`} hint="Active policies only" />
        <StatCard label="Expected maturity" value={`₹${formatMoney(stats.totalMaturity)}`} hint="Active policies only" accent />
        <StatCard
          label="Projected gain"
          value={`₹${formatMoney(stats.gain)} (${stats.gainPct.toFixed(1)}%)`}
          hint="Active policies only"
          accent
        />
      </div>

      <div className="panel-grid">
        <div className="panel">
          <h3>Upcoming Maturities (90 days)</h3>
          {stats.upcoming.length === 0 ? (
            <div className="muted">Nothing maturing in the next 90 days.</div>
          ) : (
            <ul className="upcoming-list">
              {stats.upcoming.map((e) => (
                <li key={e.id}>
                  <div>
                    <strong>{e.serial_no}</strong> — {e.owner_name} ({e.product})
                  </div>
                  <span className={e.days < 0 ? 'badge badge-danger' : 'badge badge-warn'}>
                    {e.days < 0 ? `${Math.abs(e.days)}d overdue` : `${e.days}d left`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="panel">
          <h3>Active amount by product</h3>
          {stats.productData.length === 0 ? (
            <div className="muted">No active instruments to chart.</div>
          ) : (
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={stats.productData} dataKey="value" nameKey="name" innerRadius={50} outerRadius={90} paddingAngle={2}>
                {stats.productData.map((entry, i) => (
                  <Cell key={entry.name} fill={PRODUCT_COLORS[i % PRODUCT_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(v) => `₹${formatMoney(v)}`} contentStyle={chartTooltip} itemStyle={chartTooltipItem} labelStyle={chartTooltipItem} />
              <Legend wrapperStyle={chartLegend} />
            </PieChart>
          </ResponsiveContainer>
          )}
        </div>

        <div className="panel">
          <h3>Entries by Status</h3>
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={stats.statusData} dataKey="value" nameKey="name" innerRadius={50} outerRadius={90} paddingAngle={2}>
                {stats.statusData.map((entry) => (
                  <Cell key={entry.name} fill={STATUS_COLORS[entry.name] || '#94a3b8'} />
                ))}
              </Pie>
              <Tooltip contentStyle={chartTooltip} itemStyle={chartTooltipItem} labelStyle={chartTooltipItem} />
              <Legend wrapperStyle={chartLegend} />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>
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
