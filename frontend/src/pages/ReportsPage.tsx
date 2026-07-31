import { useEffect, useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import StatCard from "../components/StatCard";
import { Button, Table, TableCell, TableHead, TableRow } from "../components/ui";
import { apiFetch, getHospitalCode, reportError } from "../lib/api";
import { API_BASE } from "../lib/constants";
import type { Notice, ReportsOverview } from "../types";

type Props = {
  setNotice: Dispatch<SetStateAction<Notice | null>>;
};

function formatCurrency(amount?: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount || 0);
}

export default function ReportsPage({ setNotice }: Props) {
  const [overview, setOverview] = useState<ReportsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState<"" | "csv" | "pdf" | "word">("");

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const data = await apiFetch<ReportsOverview>("/api/reports/overview");
        setOverview(data);
      } catch (error) {
        reportError(setNotice, error as { message?: string; status?: number }, "Unable to load reports overview.");
        setOverview(null);
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [setNotice]);

  const topReferrals = useMemo(() => overview?.hospital_summary.referrals || [], [overview]);
  const collectionsByModule = useMemo(() => overview?.billing_summary.collections_by_module || [], [overview]);
  const doctorIncome = useMemo(() => overview?.doctor_income || [], [overview]);
  const clinicIncome = useMemo(() => overview?.clinic_income || [], [overview]);
  const discountByModule = useMemo(() => overview?.discount_by_module || [], [overview]);
  const paymentStatusBreakdown = useMemo(() => overview?.payment_status_breakdown || [], [overview]);
  const patientFinancials = useMemo(() => overview?.patient_financials || [], [overview]);
  const diagnosticsByDoctor = useMemo(() => overview?.diagnostics_by_doctor || [], [overview]);

  const handleExport = async (format: "csv" | "pdf" | "word") => {
    setExporting(format);
    try {
      const response = await fetch(`${API_BASE}/api/reports/export/${format}`, {
        method: "GET",
        headers: { "X-Hospital-Code": getHospitalCode() },
        credentials: "include",
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "Unable to export reports.");
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `reports-overview.${format === "word" ? "docx" : format}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      reportError(setNotice, error as { message?: string; status?: number }, "Unable to export reports.");
    } finally {
      setExporting("");
    }
  };

  return (
    <section className="module-page">
      <div className="module-panel-head">
        <h3>Reports Center</h3>
        <div className="module-inline-actions">
          <Button type="button" onClick={() => void handleExport("csv")} disabled={exporting !== ""}>
            {exporting === "csv" ? "Exporting..." : "Export CSV"}
          </Button>
          <Button type="button" onClick={() => void handleExport("pdf")} disabled={exporting !== ""}>
            {exporting === "pdf" ? "Exporting..." : "Export PDF"}
          </Button>
          <Button type="button" onClick={() => void handleExport("word")} disabled={exporting !== ""}>
            {exporting === "word" ? "Exporting..." : "Export Word"}
          </Button>
        </div>
      </div>
      <div className="stat-grid module-stat-grid">
        <StatCard label="Total Billed" value={formatCurrency(overview?.billing_summary.total_billed)} />
        <StatCard label="Collected" value={formatCurrency(overview?.billing_summary.total_collected)} />
        <StatCard label="Lab Revenue" value={formatCurrency(overview?.lab_summary.total_amount)} />
        <StatCard label="Pharmacy Sales" value={formatCurrency(overview?.pharmacy_summary.sales_total)} />
        <StatCard label="Net Position" value={formatCurrency(overview?.accounts_summary.net_position)} />
        <StatCard label="ALOS" value={`${overview?.alos_summary.average_los_days || 0} days`} />
        <StatCard label="Monthly OP" value={overview?.hospital_summary.ip_op_counts.monthly_op || 0} />
        <StatCard label="Monthly IP" value={overview?.hospital_summary.ip_op_counts.monthly_ip || 0} />
        <StatCard label="Advance Collected" value={formatCurrency(overview?.billing_summary.total_advance)} />
        <StatCard label="Refunded" value={formatCurrency(overview?.billing_summary.total_refunded)} />
      </div>

      {loading ? <p className="muted">Loading reports...</p> : null}

      <div className="split">
        <div className="panel">
          <div className="module-panel-head">
            <h3>Collections by Module</h3>
          </div>
          {collectionsByModule.length === 0 ? (
            <p className="muted">No collection records available.</p>
          ) : (
            <Table className="module-table module-table-collections" aria-label="Collections by module table">
              <TableHead>
                <TableCell>Module</TableCell>
                <TableCell>Collected</TableCell>
              </TableHead>
              {collectionsByModule.map((row) => (
                <TableRow key={row.label}>
                  <TableCell>{row.label}</TableCell>
                  <TableCell>{formatCurrency(row.count)}</TableCell>
                </TableRow>
              ))}
            </Table>
          )}
        </div>
        <div className="panel">
          <div className="module-panel-head">
            <h3>Operational Highlights</h3>
          </div>
          <div className="care-note-list">
            <div className="care-note-card">
              <strong>Accidents</strong>
              <p>Today: {overview?.hospital_summary.accidents.daily || 0}</p>
              <p>This month: {overview?.hospital_summary.accidents.monthly || 0}</p>
            </div>
            <div className="care-note-card">
              <strong>Pharmacy Alerts</strong>
              <p>Low stock: {overview?.pharmacy_summary.low_stock_count || 0}</p>
              <p>Out of stock: {overview?.pharmacy_summary.out_of_stock_count || 0}</p>
              <p>Damaged stock: {overview?.pharmacy_summary.damaged_stock_count || 0}</p>
            </div>
            <div className="care-note-card">
              <strong>Workforce</strong>
              <p>Employees: {overview?.employee_summary.total || 0}</p>
              <p>Active: {overview?.employee_summary.active || 0}</p>
              <p>Inactive: {overview?.employee_summary.inactive || 0}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="split">
        <div className="panel">
          <div className="module-panel-head">
            <h3>Referral Mix</h3>
          </div>
          {topReferrals.length === 0 ? (
            <p className="muted">No referral data available.</p>
          ) : (
            <div className="care-note-list">
              {topReferrals.map((row) => (
                <div key={row.label} className="care-note-card">
                  <strong>{row.label}</strong>
                  <p>{row.count} visit(s)</p>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="panel">
          <div className="module-panel-head">
            <h3>Financial Summary</h3>
          </div>
          <div className="care-note-list">
            <div className="care-note-card">
              <strong>Billing</strong>
              <p>Total billed: {formatCurrency(overview?.billing_summary.total_billed)}</p>
              <p>Total due: {formatCurrency(overview?.billing_summary.total_due)}</p>
            </div>
            <div className="care-note-card">
              <strong>Diagnostics</strong>
              <p>Total amount: {formatCurrency(overview?.lab_summary.total_amount)}</p>
              <p>Total due: {formatCurrency(overview?.lab_summary.total_due)}</p>
            </div>
            <div className="care-note-card">
              <strong>Hospital</strong>
              <p>Revenue: {formatCurrency(overview?.hospital_summary.revenue.total)}</p>
              <p>Outstanding: {formatCurrency(overview?.hospital_summary.revenue.due)}</p>
            </div>
            <div className="care-note-card">
              <strong>Accounts</strong>
              <p>Vendor paid: {formatCurrency(overview?.accounts_summary.vendor_paid_total)}</p>
              <p>Doctor due: {formatCurrency(overview?.accounts_summary.doctor_due_total)}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="split">
        <div className="panel">
          <div className="module-panel-head">
            <h3>Doctor-wise Income</h3>
          </div>
          {doctorIncome.length === 0 ? (
            <p className="muted">No doctor-wise billing data available.</p>
          ) : (
            <div className="care-note-list">
              {doctorIncome.slice(0, 8).map((row) => (
                <div key={row.label} className="care-note-card">
                  <strong>{row.label}</strong>
                  <p>{formatCurrency(row.count)}</p>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="panel">
          <div className="module-panel-head">
            <h3>Diagnostics by Doctor</h3>
          </div>
          {diagnosticsByDoctor.length === 0 ? (
            <p className="muted">No diagnostics doctor data available.</p>
          ) : (
            <div className="care-note-list">
              {diagnosticsByDoctor.slice(0, 8).map((row) => (
                <div key={row.label} className="care-note-card">
                  <strong>{row.label}</strong>
                  <p>{formatCurrency(row.count)}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="split">
        <div className="panel">
          <div className="module-panel-head">
            <h3>Clinic-wise Income</h3>
          </div>
          {clinicIncome.length === 0 ? (
            <p className="muted">No clinic-wise billing data available.</p>
          ) : (
            <div className="care-note-list">
              {clinicIncome.slice(0, 8).map((row) => (
                <div key={row.label} className="care-note-card">
                  <strong>{row.label}</strong>
                  <p>{formatCurrency(row.count)}</p>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="panel">
          <div className="module-panel-head">
            <h3>Discount Reports</h3>
          </div>
          {discountByModule.length === 0 ? (
            <p className="muted">No discount data available.</p>
          ) : (
            <div className="care-note-list">
              {discountByModule.slice(0, 8).map((row) => (
                <div key={row.label} className="care-note-card">
                  <strong>{row.label}</strong>
                  <p>{formatCurrency(row.count)}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="split">
        <div className="panel">
          <div className="module-panel-head">
            <h3>Payment Status</h3>
          </div>
          {paymentStatusBreakdown.length === 0 ? (
            <p className="muted">No payment status data available.</p>
          ) : (
            <div className="care-note-list">
              {paymentStatusBreakdown.map((row) => (
                <div key={row.label} className="care-note-card">
                  <strong>{row.label}</strong>
                  <p>{row.count} invoice(s)</p>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="panel">
          <div className="module-panel-head">
            <h3>ALOS</h3>
          </div>
          <div className="care-note-list">
            <div className="care-note-card">
              <strong>Average Length of Stay</strong>
              <p>{overview?.alos_summary.average_los_days || 0} day(s)</p>
              <p>Admissions: {overview?.alos_summary.admission_count || 0}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="module-panel-head">
          <h3>Patient Financial Balances</h3>
        </div>
        {patientFinancials.length === 0 ? (
          <p className="muted">No patient financial balances available.</p>
        ) : (
          <Table className="module-table" aria-label="Patient financial balances table">
            <TableHead>
              <TableCell>Patient ID</TableCell>
              <TableCell>Total Billed</TableCell>
              <TableCell>Total Due</TableCell>
              <TableCell>Label</TableCell>
              <TableCell>Value</TableCell>
              <TableCell>Value</TableCell>
            </TableHead>
            {patientFinancials.slice(0, 12).map((row) => (
              <TableRow key={row.label}>
                <TableCell>{row.label}</TableCell>
                <TableCell>{formatCurrency(row.total_billed)}</TableCell>
                <TableCell>{formatCurrency(row.total_due)}</TableCell>
                <TableCell>Outstanding</TableCell>
                <TableCell>{formatCurrency(row.total_due)}</TableCell>
                <TableCell>{row.total_due > 0 ? "Action Needed" : "Clear"}</TableCell>
              </TableRow>
            ))}
          </Table>
        )}
      </div>
    </section>
  );
}
