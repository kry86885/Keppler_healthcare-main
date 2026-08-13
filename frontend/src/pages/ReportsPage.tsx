import { useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import StatCard from "../components/StatCard";
import { Table, TableCell, TableHead, TableRow } from "../components/ui";
import { apiFetch, reportError } from "../lib/api";
import { API_BASE } from "../lib/constants";
import type { Notice } from "../types";

type Props = {
  setNotice: Dispatch<SetStateAction<Notice | null>>;
};

type LabeledCount = { label: string; count: number };

type ReportsOverview = {
  hospital_summary?: {
    ip_op_counts?: { monthly_op?: number; monthly_ip?: number };
  };
  billing_summary?: {
    total_billed?: number;
    total_collected?: number;
    total_due?: number;
  };
  accounts_summary?: {
    net_position?: number;
  };
  employee_summary?: {
    total?: number;
    active?: number;
  };
  alos_summary?: {
    average_los_days?: number;
    admission_count?: number;
  };
  phase_h_summary?: {
    total_beds?: number;
    occupied_beds?: number;
    bed_occupancy_rate?: number;
  };
  doctor_income?: LabeledCount[];
  clinic_income?: LabeledCount[];
  discount_by_module?: LabeledCount[];
  payment_status_breakdown?: LabeledCount[];
};

function formatCurrency(amount?: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount || 0);
}

const EMPTY_OVERVIEW: ReportsOverview = {};

export default function ReportsPage({ setNotice }: Props) {
  const [overview, setOverview] = useState<ReportsOverview>(EMPTY_OVERVIEW);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const data = await apiFetch<ReportsOverview>("/api/reports/overview");
        if (!cancelled) setOverview(data);
      } catch (error) {
        reportError(
          setNotice,
          error as { message?: string; status?: number },
          "Unable to load the reports overview.",
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const billing = overview.billing_summary || {};
  const accounts = overview.accounts_summary || {};
  const alos = overview.alos_summary || {};
  const phaseH = overview.phase_h_summary || {};
  const ipOp = overview.hospital_summary?.ip_op_counts || {};

  const renderLabeledCountTable = (
    title: string,
    rows: LabeledCount[] | undefined,
    valueLabel: string,
    isCurrency = true,
  ) => (
    <div className="panel">
      <div className="module-panel-head">
        <h3>{title}</h3>
      </div>
      {!rows || rows.length === 0 ? (
        <p className="muted">No data yet.</p>
      ) : (
        <Table className="module-table" aria-label={title}>
          <TableHead>
            <TableCell>Label</TableCell>
            <TableCell>{valueLabel}</TableCell>
          </TableHead>
          {rows.slice(0, 10).map((row, i) => (
            <TableRow key={`${row.label}-${i}`}>
              <TableCell>{row.label}</TableCell>
              <TableCell>
                {isCurrency ? formatCurrency(row.count) : row.count}
              </TableCell>
            </TableRow>
          ))}
        </Table>
      )}
    </div>
  );

  return (
    <section className="module-page">
      <div className="module-panel-head">
        <div>
          <h3>Reports</h3>
          <p className="muted">
            Cross-module operational and financial overview.
          </p>
        </div>
        <div className="module-inline-actions">
          <a
            className="ui-button secondary ui-button-sm"
            href={`${API_BASE}/api/reports/export/csv`}
            target="_blank"
            rel="noreferrer"
          >
            Export CSV
          </a>
          <a
            className="ui-button secondary ui-button-sm"
            href={`${API_BASE}/api/reports/export/pdf`}
            target="_blank"
            rel="noreferrer"
          >
            Export PDF
          </a>
          <a
            className="ui-button secondary ui-button-sm"
            href={`${API_BASE}/api/reports/export/word`}
            target="_blank"
            rel="noreferrer"
          >
            Export Word
          </a>
        </div>
      </div>

      <div className="stat-grid module-stat-grid">
        <StatCard label="Total Billed" value={formatCurrency(billing.total_billed)} />
        <StatCard
          label="Total Collected"
          value={formatCurrency(billing.total_collected)}
        />
        <StatCard label="Total Due" value={formatCurrency(billing.total_due)} />
        <StatCard
          label="Accounts Net Position"
          value={formatCurrency(accounts.net_position)}
        />
        <StatCard label="Monthly OP" value={ipOp.monthly_op ?? 0} />
        <StatCard label="Monthly IP" value={ipOp.monthly_ip ?? 0} />
        <StatCard
          label="Avg. Length of Stay"
          value={`${alos.average_los_days ?? 0} days`}
        />
        <StatCard
          label="Bed Occupancy"
          value={`${phaseH.bed_occupancy_rate ?? 0}%`}
        />
      </div>

      {loading ? <p className="muted">Loading reports...</p> : null}

      <div className="split">
        {renderLabeledCountTable(
          "Income by Doctor",
          overview.doctor_income,
          "Amount",
        )}
        {renderLabeledCountTable(
          "Income by Clinic",
          overview.clinic_income,
          "Amount",
        )}
      </div>
      <div className="split">
        {renderLabeledCountTable(
          "Discounts by Module",
          overview.discount_by_module,
          "Amount",
        )}
        {renderLabeledCountTable(
          "Invoices by Payment Status",
          overview.payment_status_breakdown,
          "Count",
          false,
        )}
      </div>
    </section>
  );
}
