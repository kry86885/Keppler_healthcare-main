import { useMemo } from "react";
import StatCard from "../components/StatCard";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Table,
  TableHead,
  TableRow,
  TableCell,
  Badge,
} from "../components/ui";
import { Skeleton } from "../components/ui/Skeleton";
import type {
  DashboardAnalytics,
  DistributionItem,
  HospitalSummary,
  Patient,
  Stats,
} from "../types";
import { formatDateTimeIST } from "../lib/format";
import { FiEye } from "react-icons/fi";

type Props = {
  stats: Stats;
  recentPatients: Patient[];
  analytics: DashboardAnalytics | null;
  hospitalSummary: HospitalSummary | null;
  analyticsLoading: boolean;
  onNavigate: (page: string) => void;
  permissions: string[];
};

const CHART_COLORS = [
  "#0e7490",
  "#2563eb",
  "#16a34a",
  "#b45309",
  "#be123c",
  "#7c3aed",
  "#334155",
];

function toPercent(value: number, total: number) {
  if (!total) return 0;
  return Math.round((value / total) * 100);
}

function shortDateLabel(value: string) {
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function TrendBars({
  title,
  points,
}: {
  title: string;
  points: { date: string; count: number }[];
}) {
  const max = Math.max(1, ...points.map((item) => item.count));

  return (
    <Card className="panel dashboard-analytics-card">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {points.length === 0 ? (
          <p className="muted">No trend data yet.</p>
        ) : (
          <div className="trend-chart" role="img" aria-label={title}>
            {points.map((item) => (
              <div
                key={`${title}-${item.date}`}
                className="trend-bar-wrap"
                title={`${shortDateLabel(item.date)}: ${item.count}`}
              >
                <div className="trend-bar-track">
                  <div
                    className="trend-bar-fill"
                    style={{ height: `${(item.count / max) * 100}%` }}
                  />
                </div>
                <span className="trend-bar-label">
                  {shortDateLabel(item.date)}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DonutChart({
  title,
  items,
}: {
  title: string;
  items: DistributionItem[];
}) {
  const total = items.reduce((sum, item) => sum + item.count, 0);

  const background = useMemo(() => {
    if (!total || items.length === 0) {
      return "conic-gradient(#dce8f1 0deg 360deg)";
    }
    let start = 0;
    const slices = items.map((item, index) => {
      const angle = (item.count / total) * 360;
      const end = start + angle;
      const chunk = `${CHART_COLORS[index % CHART_COLORS.length]} ${start.toFixed(2)}deg ${end.toFixed(2)}deg`;
      start = end;
      return chunk;
    });
    return `conic-gradient(${slices.join(", ")})`;
  }, [items, total]);

  return (
    <Card className="panel dashboard-analytics-card">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="donut-layout">
          <div
            className="donut-chart"
            style={{ background }}
            aria-hidden="true"
          >
            <span>{total}</span>
          </div>
          <div className="donut-legend">
            {items.length === 0 ? (
              <p className="muted">No data yet.</p>
            ) : (
              items.map((item, index) => (
                <div key={`${title}-${item.label}`} className="legend-item">
                  <span
                    className="legend-dot"
                    style={{
                      background: CHART_COLORS[index % CHART_COLORS.length],
                    }}
                  />
                  <span className="legend-label">{item.label}</span>
                  <strong>{item.count}</strong>
                  <span className="muted">{toPercent(item.count, total)}%</span>
                </div>
              ))
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function formatCurrency(amount?: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount || 0);
}

export default function DashboardPage({
  stats,
  recentPatients,
  analytics,
  hospitalSummary,
  analyticsLoading,
  onNavigate,
  permissions,
}: Props) {
  const canViewBilling =
    permissions.includes("billing.read") ||
    permissions.includes("accounts.read");
  const canViewPharmacy = permissions.includes("pharmacy.read");
  const paymentModes = hospitalSummary?.revenue?.payment_mode_breakdown || [];
  const maxPaymentMode = Math.max(
    1,
    ...paymentModes.map((item) => item.count || 0),
  );

  return (
    <section className="fade-in page-container">
      <div className="stat-grid">
        <StatCard label="Total Patients" value={stats.total} />
        <StatCard label="New Today" value={stats.today} />
        <StatCard label="Active Admissions" value={stats.active_admissions} />
        <StatCard
          label="Readmitted Patients"
          value={stats.readmitted_patients}
        />
        <StatCard label="Documents" value={stats.documents} />
      </div>

      <div className="split">
        <Card className="panel">
          <CardHeader>
            <CardTitle>Recent Patients</CardTitle>
          </CardHeader>
          <CardContent>
            {recentPatients.length === 0 ? (
              <p className="muted">No patients registered yet.</p>
            ) : (
              <div className="overflow-x-auto w-full">
                <Table className="recent-patient-table">
                  <TableHead>
                    <TableCell>Patient</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell className="text-center">Actions</TableCell>
                  </TableHead>
                  {recentPatients.map((patient) => {
                    const isCompleted =
                      patient.status?.toLowerCase() === "completed";
                    const isConsultation = patient.status
                      ?.toLowerCase()
                      .includes("consultation");
                    return (
                      <TableRow
                        key={patient.patient_id}
                        className="hover:bg-muted/50"
                      >
                        <TableCell>
                          <div className="font-medium text-foreground">
                            {patient.name} {patient.last_name}
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {patient.patient_id}
                          </div>
                        </TableCell>
                        <TableCell>
                          {patient.status ? (
                            <Badge
                              variant={
                                isCompleted
                                  ? "default"
                                  : isConsultation
                                    ? "secondary"
                                    : "outline"
                              }
                            >
                              {patient.status.charAt(0).toUpperCase() +
                                patient.status.slice(1).replace("_", " ")}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-center gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 px-2 text-muted-foreground hover:text-foreground flex items-center gap-1"
                              onClick={() => onNavigate("patients")}
                              title="View details"
                            >
                              <FiEye className="h-4 w-4" />
                              <span>View</span>
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
        <Card className="panel hero-panel">
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
            <CardDescription className="muted">
              Move faster with guided tasks and OCR automation.
            </CardDescription>
          </CardHeader>
          <CardContent className="action-grid">
            <Button variant="primary" onClick={() => onNavigate("add")}>
              Register Patient
            </Button>
            <Button variant="secondary" onClick={() => onNavigate("patients")}>
              Search Patient
            </Button>
            <Button variant="secondary" onClick={() => onNavigate("readmit")}>
              Re-admit Patient
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="stat-grid module-stat-grid">
        <StatCard
          label="Today's OP"
          value={hospitalSummary?.ip_op_counts?.daily_op || 0}
        />
        <StatCard
          label="Today's IP"
          value={hospitalSummary?.ip_op_counts?.daily_ip || 0}
        />
        {canViewBilling && (
          <>
            <StatCard
              label="Monthly Revenue"
              value={formatCurrency(hospitalSummary?.revenue?.total)}
            />
            <StatCard
              label="Outstanding Due"
              value={formatCurrency(hospitalSummary?.revenue?.due)}
            />
          </>
        )}
        {canViewPharmacy && (
          <StatCard
            label="Pharmacy Sales"
            value={formatCurrency(
              hospitalSummary?.pharmacy_summary?.monthly_sales,
            )}
          />
        )}
      </div>

      <div className="dashboard-analytics-grid">
        <TrendBars
          title="Patient Registrations Trend"
          points={analytics?.patients_trend || []}
        />
        <TrendBars
          title="Daily Documents Uploaded"
          points={analytics?.documents_trend || []}
        />
        <DonutChart
          title="Document Type Distribution"
          items={analytics?.doc_type_distribution || []}
        />
        <DonutChart
          title="Admission Status"
          items={analytics?.admission_status_distribution || []}
        />
        <DonutChart
          title="Gender Distribution"
          items={analytics?.gender_distribution || []}
        />
        <Card className="panel dashboard-analytics-card">
          <CardHeader>
            <CardTitle>Operational Snapshot</CardTitle>
            <CardDescription className="muted">
              Live hospital throughput and critical counts.
            </CardDescription>
          </CardHeader>
          <CardContent className="summary-grid">
            <div className="summary-tile">
              <span className="summary-label">Monthly OP</span>
              <strong>{hospitalSummary?.ip_op_counts?.monthly_op || 0}</strong>
            </div>
            <div className="summary-tile">
              <span className="summary-label">Monthly IP</span>
              <strong>{hospitalSummary?.ip_op_counts?.monthly_ip || 0}</strong>
            </div>
            <div className="summary-tile">
              <span className="summary-label">Accidents Today</span>
              <strong>{hospitalSummary?.accidents?.daily || 0}</strong>
            </div>
            <div className="summary-tile">
              <span className="summary-label">Accidents This Month</span>
              <strong>{hospitalSummary?.accidents?.monthly || 0}</strong>
            </div>
          </CardContent>
        </Card>
        {canViewBilling && (
          <Card className="panel dashboard-analytics-card">
            <CardHeader>
              <CardTitle>Collection Mix</CardTitle>
              <CardDescription className="muted">
                Payment mode breakdown for this month.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {paymentModes.length === 0 ? (
                <p className="muted">No payment activity yet.</p>
              ) : (
                <div className="summary-list">
                  {paymentModes.map((item) => (
                    <div key={item.label} className="summary-list-row">
                      <span className="bar-label">{item.label}</span>
                      <div className="mini-bar-track" aria-hidden="true">
                        <div
                          className="mini-bar-fill"
                          style={{
                            width: `${(item.count / maxPaymentMode) * 100}%`,
                          }}
                        />
                      </div>
                      <strong>{formatCurrency(item.count)}</strong>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}
        <Card className="panel dashboard-analytics-card">
          <CardHeader>
            <CardTitle>Referral Sources</CardTitle>
            <CardDescription className="muted">
              Current month patient source mix.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {hospitalSummary?.referrals?.length ? (
              <div className="summary-list">
                {hospitalSummary.referrals?.map((item) => (
                  <div key={item.label} className="summary-list-row">
                    <span className="bar-label">{item.label}</span>
                    <strong>{item.count}</strong>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted">No referral data yet.</p>
            )}
          </CardContent>
        </Card>
      </div>

      {analyticsLoading && !analytics ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "1rem",
            marginTop: "1rem",
          }}
        >
          <Skeleton height="150px" animation="wave" variant="rounded" />
          <Skeleton height="150px" animation="wave" variant="rounded" />
          <Skeleton height="150px" animation="wave" variant="rounded" />
        </div>
      ) : null}

      {analyticsLoading && analytics ? (
        <p className="muted">Refreshing analytics...</p>
      ) : null}
    </section>
  );
}
