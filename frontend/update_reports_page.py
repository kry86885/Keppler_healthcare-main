import os
import re

filepath = r"d:\HOSP AI\Keppler_healthcare-main\frontend\src\pages\ReportsPage.tsx"
with open(filepath, "r", encoding="utf-8") as f:
    content = f.read()

search = """
      <div className="stat-grid module-stat-grid">
        <StatCard label="Total Billed" value={formatCurrency(overview?.billing_summary.total_billed)} />
        <StatCard label="Collected" value={formatCurrency(overview?.billing_summary.total_collected)} />
        <StatCard label="Lab Revenue" value={formatCurrency(overview?.lab_summary.total_amount)} />
        <StatCard label="Pharmacy Sales" value={formatCurrency(overview?.pharmacy_summary.sales_total)} />
        <StatCard label="Net Position" value={formatCurrency(overview?.accounts_summary.net_position)} />
        <StatCard label="ALOS" value={${overview?.alos_summary.average_los_days || 0} days} />
        <StatCard label="Monthly OP" value={overview?.hospital_summary.ip_op_counts.monthly_op || 0} />
        <StatCard label="Monthly IP" value={overview?.hospital_summary.ip_op_counts.monthly_ip || 0} />
      </div>"""

replacement = """
      <div className="panel module-panel mb-8">
        <div className="module-panel-head">
          <h3>Live Operations (Phase H Metrics)</h3>
        </div>
        <div className="stat-grid module-stat-grid">
          <StatCard label="Bed Occupancy" value={${overview?.phase_h_summary?.bed_occupancy_rate || 0}%} />
          <StatCard label="Occupied Beds" value={${overview?.phase_h_summary?.occupied_beds || 0} / } />
          <StatCard label="ICU Critical" value={overview?.phase_h_summary?.icu_critical_patients || 0} />
          <StatCard label="Active Emergencies" value={overview?.phase_h_summary?.active_emergencies || 0} />
          <StatCard label="Active Ambulances" value={overview?.phase_h_summary?.active_ambulances || 0} />
          <StatCard label="ALOS" value={${overview?.alos_summary?.average_los_days || 0} days} />
        </div>
      </div>

      <div className="panel module-panel mb-8">
        <div className="module-panel-head">
          <h3>Financial & Clinical Overview</h3>
        </div>
        <div className="stat-grid module-stat-grid">
          <StatCard label="Total Billed" value={formatCurrency(overview?.billing_summary.total_billed)} />
          <StatCard label="Collected" value={formatCurrency(overview?.billing_summary.total_collected)} />
          <StatCard label="Lab Revenue" value={formatCurrency(overview?.lab_summary.total_amount)} />
          <StatCard label="Pharmacy Sales" value={formatCurrency(overview?.pharmacy_summary.sales_total)} />
          <StatCard label="Net Position" value={formatCurrency(overview?.accounts_summary.net_position)} />
          <StatCard label="Monthly OP" value={overview?.hospital_summary.ip_op_counts.monthly_op || 0} />
          <StatCard label="Monthly IP" value={overview?.hospital_summary.ip_op_counts.monthly_ip || 0} />
        </div>
      </div>"""

content = content.replace(search, replacement)
with open(filepath, "w", encoding="utf-8") as f:
    f.write(content)
