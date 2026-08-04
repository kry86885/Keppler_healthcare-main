import { useState, useEffect } from "react";
import type { Dispatch, SetStateAction } from "react";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Modal,
  Table,
  TableRow,
  TableCell,
} from "../components/ui";
import type { Notice } from "../types";

type Props = {
  setNotice: Dispatch<SetStateAction<Notice | null>>;
  onNavigate?: (page: string) => void;
};

type DailyRecord = {
  id: string;
  patientName: string;
  patientId: string;
  paymentMethod: string;
  module: string;
  amount: number;
  date: string;
};

const PAYMENT_METHODS = [
  { name: "Cash", icon: "💵", color: "#10b981" },
  { name: "Card", icon: "💳", color: "#3b82f6" },
  { name: "UPI", icon: "📱", color: "#8b5cf6" },
  { name: "Bank Transfer", icon: "🏦", color: "#0ea5e9" },
];

const MODULES = [
  { label: "OP / Billing", color: "#2563eb" },
  { label: "Pharmacy", color: "#0ea5e9" },
];

export default function DailyMonthlyReportsPage({
  setNotice,
  onNavigate,
}: Props) {
  const [selectDate, setSelectDate] = useState(
    new Date().toISOString().split("T")[0],
  );
  const [period, setPeriod] = useState<"Daily" | "Monthly">("Daily");
  const [records, setRecords] = useState<DailyRecord[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedFilter, setSelectedFilter] = useState("");
  const [filterType, setFilterType] = useState<"method" | "module">("method");

  const normalizeModeDisplay = (mode: string): string => {
    const map: Record<string, string> = {
      cash: "Cash",
      card: "Card",
      upi: "UPI",
      bank: "Bank Transfer",
    };
    return map[mode?.toLowerCase()] || mode || "Cash";
  };

  const fetchRecords = async () => {
    try {
      const [paymentsRes, pharmacySalesRes] = await Promise.all([
        fetch("/api/billing/payments"),
        fetch("/api/pharmacy/sales"),
      ]);

      const paymentRecords: DailyRecord[] = [];
      if (paymentsRes.ok) {
        const data = await paymentsRes.json();
        (data.payments || []).forEach((p: any) => {
          const paymentFor = p.payment_for || p.paymentFor || "";
          // Only OP/IP payments exist here -- pharmacy revenue is tracked
          // entirely in pharmacy_sales (merged in below), never as a billed
          // invoice payment, and lab/diagnostics is no longer a module in
          // this app, so both are excluded here rather than silently
          // counted under an unlabeled bucket.
          if (paymentFor !== "OP" && paymentFor !== "IP") return;
          paymentRecords.push({
            id: String(p.id),
            patientName: p.patient_name || p.patientName || "Unknown",
            patientId: p.patient_id || p.patientId || "",
            paymentMethod: normalizeModeDisplay(p.mode),
            module: "OP / Billing",
            amount: parseFloat(p.amount) || 0,
            date: p.date || "",
          });
        });
      }

      const pharmacyRecords: DailyRecord[] = [];
      if (pharmacySalesRes.ok) {
        const data = await pharmacySalesRes.json();
        (data.sales || []).forEach((sale: any) => {
          pharmacyRecords.push({
            id: `pharmacy-${sale.id}`,
            patientName: sale.patient_name || sale.patient_id || "Walk-in",
            patientId: sale.patient_id || "",
            // Pharmacy sales don't capture a payment mode, so this
            // deliberately doesn't match any label in PAYMENT_METHODS --
            // it still counts toward totals and the module breakdown below,
            // just isn't fabricated into a specific payment method bucket.
            paymentMethod: "Pharmacy Sale",
            module: "Pharmacy",
            amount: parseFloat(sale.amount) || 0,
            date:
              (sale.sold_at || "").split("T")[0] ||
              (sale.sold_at || "").split(" ")[0] ||
              "",
          });
        });
      }

      setRecords([...paymentRecords, ...pharmacyRecords]);
    } catch (err) {
      console.error("Failed to fetch payments:", err);
    }
  };

  useEffect(() => {
    fetchRecords();
  }, []);

  const formatCurrency = (val: number) => `₹${val.toLocaleString("en-IN")}`;

  const getRecordsForMethod = (method: string) =>
    records.filter((r) => r.paymentMethod === method);

  const getAmountForMethod = (method: string) =>
    getRecordsForMethod(method).reduce((s, r) => s + r.amount, 0);

  const getRecordsForModule = (module: string) =>
    records.filter((r) => r.module === module);

  const getAmountForModule = (module: string) =>
    getRecordsForModule(module).reduce((s, r) => s + r.amount, 0);

  const totalCollected = records.reduce((s, r) => s + r.amount, 0);
  const maxModuleVal = Math.max(
    ...MODULES.map((m) => getAmountForModule(m.label)),
    1,
  );
  const maxMethodVal = Math.max(
    ...PAYMENT_METHODS.map((m) => getAmountForMethod(m.name)),
    1,
  );

  const openMethodModal = (method: string) => {
    setSelectedFilter(method);
    setFilterType("method");
    setIsModalOpen(true);
  };

  const openModuleModal = (module: string) => {
    setSelectedFilter(module);
    setFilterType("module");
    setIsModalOpen(true);
  };

  const filteredRecords =
    filterType === "method"
      ? getRecordsForMethod(selectedFilter)
      : getRecordsForModule(selectedFilter);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      {/* Page title/subtitle now render once, in the shared app topbar. */}
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <Button
          variant="secondary"
          onClick={() => onNavigate && onNavigate("dashboard")}
        >
          ← Back to Dashboard
        </Button>
      </div>

      {/* Period & Date Controls */}
      <Card>
        <CardContent style={{ padding: "1.25rem" }}>
          <div
            style={{
              display: "flex",
              gap: "1.5rem",
              alignItems: "flex-end",
              flexWrap: "wrap",
            }}
          >
            <div
              style={{
                display: "inline-flex",
                backgroundColor: "#f1f5f9",
                borderRadius: "0.5rem",
                padding: "0.25rem",
              }}
            >
              {(["Daily", "Monthly"] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPeriod(p)}
                  style={{
                    padding: "0.4rem 1.1rem",
                    borderRadius: "0.375rem",
                    border: "none",
                    fontSize: "0.875rem",
                    fontWeight: 600,
                    cursor: "pointer",
                    transition: "all 0.15s",
                    backgroundColor: period === p ? "#ffffff" : "transparent",
                    color: period === p ? "#0f172a" : "#64748b",
                    boxShadow:
                      period === p ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
                  }}
                >
                  {p}
                </button>
              ))}
            </div>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "0.375rem",
              }}
            >
              <Label
                style={{
                  fontSize: "0.7rem",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  color: "#475569",
                }}
              >
                Select {period === "Monthly" ? "Month" : "Date"}
              </Label>
              <Input
                type={period === "Monthly" ? "month" : "date"}
                value={
                  period === "Monthly" ? selectDate.substring(0, 7) : selectDate
                }
                onChange={(e) => setSelectDate(e.target.value)}
                style={{ width: "180px" }}
              />
            </div>

            <div style={{ display: "flex", gap: "1rem", marginLeft: "auto" }}>
              <div
                style={{
                  padding: "0.875rem 1.5rem",
                  borderRadius: "0.5rem",
                  backgroundColor: "#f8fafc",
                  border: "1px solid #e2e8f0",
                  minWidth: "160px",
                }}
              >
                <p
                  style={{
                    fontSize: "0.7rem",
                    fontWeight: 700,
                    color: "#475569",
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    margin: "0 0 0.4rem",
                  }}
                >
                  {period} Collected
                </p>
                <p
                  style={{
                    fontSize: "1.75rem",
                    fontWeight: 700,
                    color: "#0f172a",
                    lineHeight: 1,
                    margin: 0,
                  }}
                >
                  {formatCurrency(totalCollected)}
                </p>
              </div>
              <div
                style={{
                  padding: "0.875rem 1.5rem",
                  borderRadius: "0.5rem",
                  backgroundColor: "#fef2f2",
                  border: "1px solid #fee2e2",
                  minWidth: "160px",
                }}
              >
                <p
                  style={{
                    fontSize: "0.7rem",
                    fontWeight: 700,
                    color: "#ef4444",
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    margin: "0 0 0.4rem",
                  }}
                >
                  {period} Due
                </p>
                <p
                  style={{
                    fontSize: "1.75rem",
                    fontWeight: 700,
                    color: "#ef4444",
                    lineHeight: 1,
                    margin: 0,
                  }}
                >
                  ₹0
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stats Cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
          gap: "1rem",
        }}
      >
        {[
          { label: "Total Billed", value: totalCollected },
          { label: "Collected", value: totalCollected },
          { label: "Pending Due", value: 0 },
          { label: "Advances", value: 0 },
          { label: "Refunds", value: 0 },
        ].map((card) => (
          <Card key={card.label}>
            <CardContent style={{ padding: "1.25rem" }}>
              <p
                style={{
                  fontSize: "0.7rem",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  color: "var(--muted-foreground)",
                  marginBottom: "0.5rem",
                }}
              >
                {card.label}
              </p>
              <p
                style={{
                  fontSize: "1.5rem",
                  fontWeight: 700,
                  color: "var(--foreground)",
                  margin: 0,
                }}
              >
                {formatCurrency(card.value)}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Collections by Module — Clickable */}
      <Card>
        <CardHeader>
          <CardTitle>Collections by Module</CardTitle>
          <p
            style={{
              color: "var(--muted-foreground)",
              fontSize: "0.875rem",
              marginTop: "0.25rem",
            }}
          >
            Click a row to view patient-level records for that module.
          </p>
        </CardHeader>
        <CardContent>
          <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "1rem",
                padding: "0.5rem 0.75rem",
                backgroundColor: "#f8fafc",
                borderRadius: "0.375rem 0.375rem 0 0",
                borderBottom: "2px solid #e2e8f0",
              }}
            >
              <div
                style={{
                  width: "130px",
                  fontSize: "0.7rem",
                  fontWeight: 700,
                  color: "#475569",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                Module
              </div>
              <div
                style={{
                  flex: 1,
                  fontSize: "0.7rem",
                  fontWeight: 700,
                  color: "#475569",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                Progress
              </div>
              <div
                style={{
                  width: "80px",
                  textAlign: "right",
                  fontSize: "0.7rem",
                  fontWeight: 700,
                  color: "#475569",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                Total
              </div>
            </div>
            <div
              style={{
                border: "1px solid #e2e8f0",
                borderTop: "none",
                borderRadius: "0 0 0.5rem 0.5rem",
                overflow: "hidden",
              }}
            >
              {MODULES.map((mod, idx) => {
                const total = getAmountForModule(mod.label);
                const pct = Math.round((total / maxModuleVal) * 100);
                return (
                  <div
                    key={mod.label}
                    onClick={() => openModuleModal(mod.label)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) =>
                      e.key === "Enter" && openModuleModal(mod.label)
                    }
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "1rem",
                      padding: "0.875rem 0.75rem",
                      borderBottom:
                        idx < MODULES.length - 1 ? "1px solid #e2e8f0" : "none",
                      cursor: "pointer",
                      backgroundColor: "#ffffff",
                      transition: "background-color 0.15s",
                      userSelect: "none",
                    }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.backgroundColor = "#f8fafc")
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.backgroundColor = "#ffffff")
                    }
                  >
                    <div
                      style={{
                        width: "130px",
                        fontWeight: 600,
                        fontSize: "0.875rem",
                        color: "#0f172a",
                      }}
                    >
                      {mod.label}
                    </div>
                    <div
                      style={{
                        flex: 1,
                        backgroundColor: "#e2e8f0",
                        height: "8px",
                        borderRadius: "9999px",
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          width: `${pct}%`,
                          backgroundColor: mod.color,
                          height: "100%",
                          borderRadius: "9999px",
                          transition: "width 0.4s ease",
                        }}
                      />
                    </div>
                    <div
                      style={{
                        width: "80px",
                        textAlign: "right",
                        fontWeight: 700,
                        fontSize: "0.875rem",
                        color: "#0f172a",
                      }}
                    >
                      {formatCurrency(total)}
                    </div>
                    <span style={{ color: "#94a3b8", fontSize: "1rem" }}>
                      ›
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Collections by Payment Method — Clickable */}
      <Card>
        <CardHeader>
          <CardTitle>Collections by Payment Method</CardTitle>
          <p
            style={{
              color: "var(--muted-foreground)",
              fontSize: "0.875rem",
              marginTop: "0.25rem",
            }}
          >
            Click a method to view which patients paid using it.
          </p>
        </CardHeader>
        <CardContent>
          <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                padding: "0.5rem 0.75rem",
                backgroundColor: "#f8fafc",
                borderRadius: "0.375rem 0.375rem 0 0",
                borderBottom: "2px solid #e2e8f0",
              }}
            >
              <span
                style={{
                  fontSize: "0.7rem",
                  fontWeight: 700,
                  color: "#475569",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                Payment Method
              </span>
              <span
                style={{
                  fontSize: "0.7rem",
                  fontWeight: 700,
                  color: "#475569",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                Amount Collected
              </span>
            </div>
            <div
              style={{
                border: "1px solid #e2e8f0",
                borderTop: "none",
                borderRadius: "0 0 0.5rem 0.5rem",
                overflow: "hidden",
              }}
            >
              {PAYMENT_METHODS.map((method, idx) => {
                const total = getAmountForMethod(method.name);
                const txCount = getRecordsForMethod(method.name).length;
                return (
                  <div
                    key={method.name}
                    onClick={() => openMethodModal(method.name)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) =>
                      e.key === "Enter" && openMethodModal(method.name)
                    }
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "0.875rem 0.75rem",
                      borderBottom:
                        idx < PAYMENT_METHODS.length - 1
                          ? "1px solid #e2e8f0"
                          : "none",
                      cursor: "pointer",
                      backgroundColor: "#ffffff",
                      transition: "background-color 0.15s",
                      userSelect: "none",
                    }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.backgroundColor = "#f8fafc")
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.backgroundColor = "#ffffff")
                    }
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.875rem",
                      }}
                    >
                      <div
                        style={{
                          width: "2.25rem",
                          height: "2.25rem",
                          borderRadius: "0.5rem",
                          backgroundColor: "#f1f5f9",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: "1.1rem",
                          flexShrink: 0,
                        }}
                      >
                        {method.icon}
                      </div>
                      <div>
                        <span
                          style={{
                            fontWeight: 600,
                            fontSize: "0.875rem",
                            color: "#0f172a",
                            display: "block",
                          }}
                        >
                          {method.name}
                        </span>
                        <span style={{ fontSize: "0.75rem", color: "#94a3b8" }}>
                          {txCount} transaction{txCount !== 1 ? "s" : ""}
                        </span>
                      </div>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.625rem",
                      }}
                    >
                      <span
                        style={{
                          fontWeight: 700,
                          fontSize: "0.9rem",
                          color: "#0f172a",
                        }}
                      >
                        {formatCurrency(total)}
                      </span>
                      <span style={{ color: "#94a3b8", fontSize: "1rem" }}>
                        ›
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Total */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginTop: "1.5rem",
                paddingTop: "1rem",
                borderTop: "2px solid #e2e8f0",
              }}
            >
              <span
                style={{
                  fontWeight: 700,
                  fontSize: "0.875rem",
                  color: "#0f172a",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                Total Collected
              </span>
              <span
                style={{
                  fontWeight: 800,
                  fontSize: "1.125rem",
                  color: "#0f172a",
                }}
              >
                {formatCurrency(totalCollected)}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Breakdown Modal */}
      <Modal
        open={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={`${selectedFilter} — Patient Records`}
      >
        {filteredRecords.length === 0 ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              padding: "3rem 1rem",
              gap: "0.75rem",
            }}
          >
            <span style={{ fontSize: "2.5rem" }}>📭</span>
            <p
              style={{
                fontWeight: 600,
                color: "#334155",
                fontSize: "1rem",
                margin: 0,
              }}
            >
              No records found
            </p>
            <p
              style={{
                color: "#94a3b8",
                fontSize: "0.875rem",
                margin: 0,
                textAlign: "center",
              }}
            >
              No {period.toLowerCase()} transactions recorded for{" "}
              <strong>{selectedFilter}</strong>.<br />
              Records will appear here once payments are logged.
            </p>
          </div>
        ) : (
          <Table>
            <thead>
              <TableRow>
                <TableCell>#</TableCell>
                <TableCell>Patient Name</TableCell>
                <TableCell>Patient ID</TableCell>
                <TableCell>
                  {filterType === "method" ? "Module" : "Payment Method"}
                </TableCell>
                <TableCell>Date</TableCell>
                <TableCell>Amount</TableCell>
              </TableRow>
            </thead>
            <tbody>
              {Object.values(
                filteredRecords.reduce(
                  (acc, r) => {
                    const key = r.patientId || r.patientName;
                    if (!acc[key]) acc[key] = { ...r, amount: 0 };
                    acc[key].amount += Number(r.amount);
                    return acc;
                  },
                  {} as Record<string, (typeof filteredRecords)[0]>,
                ),
              ).map((r, i) => (
                <TableRow key={r.id}>
                  <TableCell style={{ color: "#94a3b8", fontSize: "0.8rem" }}>
                    {i + 1}
                  </TableCell>
                  <TableCell style={{ fontWeight: 600 }}>
                    {r.patientName}
                  </TableCell>
                  <TableCell style={{ color: "#64748b" }}>
                    {r.patientId || "—"}
                  </TableCell>
                  <TableCell>
                    {filterType === "method" ? r.module : r.paymentMethod}
                  </TableCell>
                  <TableCell style={{ color: "#64748b" }}>{r.date}</TableCell>
                  <TableCell style={{ fontWeight: 700, color: "#0f172a" }}>
                    {formatCurrency(r.amount)}
                  </TableCell>
                </TableRow>
              ))}
            </tbody>
          </Table>
        )}
      </Modal>
    </div>
  );
}
