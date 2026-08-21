import { useState, useEffect } from "react";
import type { Dispatch, SetStateAction } from "react";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Separator,
  Modal,
  Table,
  TableRow,
  TableCell,
} from "../components/ui";
import { apiFetch, reportError } from "../lib/api";
import type { Notice } from "../types";

type Props = {
  setNotice: Dispatch<SetStateAction<Notice | null>>;
  onNavigate?: (page: string) => void;
};

// Simulated patient revenue records — starts empty (real system would fetch from API)
type RevenueRecord = {
  id: string;
  patientName: string;
  category: string;
  amount: number;
  date: string;
  status: "Paid" | "Pending";
};

const CATEGORIES = [
  { label: "OP / Billing", icon: "🧮", color: "#2563eb" },
  { label: "IP / Bed Charges", icon: "🛏️", color: "#f59e0b" },
  { label: "Pharmacy", icon: "💊", color: "#3b82f6" },
  { label: "Monthly Revenue", icon: "📅", color: "#8b5cf6" },
  { label: "Pending Payments", icon: "⚠️", color: "#ef4444" },
  { label: "Doctor Payout Ready", icon: "👨‍⚕️", color: "#10b981" },
];

export default function RevenueReportsPage({ setNotice, onNavigate }: Props) {
  const [records, setRecords] = useState<RevenueRecord[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState("");

  const fetchRecords = async () => {
    // Fetched independently -- a permission/hospital-scope error on one
    // (previously silently swallowed by an unchecked `.ok` check, which just
    // rendered ₹0 with no indication why) must not blank out the other.
    let invoiceRecords: RevenueRecord[] = [];
    try {
      const data = await apiFetch<{ invoices: any[] }>("/api/billing/invoices");
      invoiceRecords = (data.invoices || [])
        .filter((inv) => inv.module === "OP" || inv.module === "IP")
        .map((inv) => ({
          id: inv.invoice_no,
          patientName: inv.patient_id || "Unknown",
          category: inv.module === "IP" ? "IP / Bed Charges" : "OP / Billing",
          amount: parseFloat(inv.total_amount) || 0,
          date:
            (inv.created_at || "").split("T")[0] ||
            (inv.created_at || "").split(" ")[0] ||
            "",
          status: inv.payment_status === "paid" ? "Paid" : "Pending",
        }));
    } catch (error: any) {
      reportError(setNotice, error, "Failed to load billing invoices.");
    }

    let pharmacyRecords: RevenueRecord[] = [];
    try {
      const data = await apiFetch<{ sales: any[] }>("/api/pharmacy/sales");
      pharmacyRecords = (data.sales || []).map((sale) => ({
        id: `pharmacy-${sale.id}`,
        patientName: sale.patient_name || sale.patient_id || "Walk-in",
        category: "Pharmacy",
        amount: parseFloat(sale.amount) || 0,
        date:
          (sale.sold_at || "").split("T")[0] ||
          (sale.sold_at || "").split(" ")[0] ||
          "",
        status: "Paid",
      }));
    } catch (error: any) {
      reportError(setNotice, error, "Failed to load pharmacy sales.");
    }

    setRecords([...invoiceRecords, ...pharmacyRecords]);
  };

  useEffect(() => {
    fetchRecords();
  }, []);

  const getRecordsFor = (category: string) =>
    records.filter((r) => r.category === category);

  const getTotalFor = (category: string) =>
    getRecordsFor(category).reduce((s, r) => s + r.amount, 0);

  const formatCurrency = (val: number) => `₹${val.toLocaleString("en-IN")}`;

  const openModal = (category: string) => {
    setSelectedCategory(category);
    setIsModalOpen(true);
  };

  const totalRevenue = records.reduce((s, r) => s + r.amount, 0);
  const outstanding = records
    .filter((r) => r.status === "Pending")
    .reduce((s, r) => s + r.amount, 0);

  const collectionBars = [
    { label: "OP / Billing", color: "#2563eb" },
    { label: "IP / Bed Charges", color: "#f59e0b" },
    { label: "Pharmacy", color: "#3b82f6" },
  ];

  const maxVal = Math.max(
    ...collectionBars.map((b) => getTotalFor(b.label)),
    1,
  );

  const filteredRecords = getRecordsFor(selectedCategory);

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

      {/* Stats Cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: "1rem",
        }}
      >
        {[
          { label: "Total Billed", value: totalRevenue },
          { label: "Collected", value: totalRevenue - outstanding },
          { label: "Pending Due", value: outstanding },
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

      {/* Collections by Module — Clickable Bars */}
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
            Click any row to view patient-level breakdown.
          </p>
        </CardHeader>
        <CardContent>
          <div style={{ display: "flex", flexDirection: "column", gap: "0" }}>
            {/* Header */}
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
                  width: "140px",
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
                Collected
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
              {collectionBars.map((bar, idx) => {
                const total = getTotalFor(bar.label);
                const pct = Math.round((total / maxVal) * 100);
                return (
                  <div
                    key={bar.label}
                    onClick={() => openModal(bar.label)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => e.key === "Enter" && openModal(bar.label)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "1rem",
                      padding: "0.875rem 0.75rem",
                      borderBottom:
                        idx < collectionBars.length - 1
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
                        width: "140px",
                        fontSize: "0.875rem",
                        fontWeight: 600,
                        color: "#0f172a",
                      }}
                    >
                      {bar.label}
                    </div>
                    <div
                      style={{
                        flex: 1,
                        backgroundColor: "#e2e8f0",
                        height: "10px",
                        borderRadius: "9999px",
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          width: `${pct}%`,
                          backgroundColor: bar.color,
                          height: "100%",
                          borderRadius: "9999px",
                          background: `linear-gradient(90deg, #93c5fd 0%, ${bar.color} 100%)`,
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

      {/* Revenue Snapshot — Clickable Rows */}
      <Card>
        <CardHeader>
          <CardTitle>Revenue Snapshot (Today)</CardTitle>
          <p
            style={{
              color: "var(--muted-foreground)",
              fontSize: "0.875rem",
              marginTop: "0.25rem",
            }}
          >
            Click any category to see patients contributing to that revenue.
          </p>
        </CardHeader>
        <CardContent>
          <div style={{ display: "flex", flexDirection: "column", gap: "0" }}>
            {/* Header */}
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
                Category
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
                Amount
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
              {CATEGORIES.map((cat, idx) => (
                <div
                  key={cat.label}
                  onClick={() => openModal(cat.label)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === "Enter" && openModal(cat.label)}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "0.875rem 0.75rem",
                    borderBottom:
                      idx < CATEGORIES.length - 1
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
                      gap: "0.75rem",
                    }}
                  >
                    <div
                      style={{
                        width: "2rem",
                        height: "2rem",
                        borderRadius: "0.5rem",
                        backgroundColor: "#f1f5f9",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "1rem",
                      }}
                    >
                      {cat.icon}
                    </div>
                    <span
                      style={{
                        fontWeight: 600,
                        fontSize: "0.875rem",
                        color: "#0f172a",
                      }}
                    >
                      {cat.label}
                    </span>
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
                        fontSize: "0.875rem",
                        color: "#0f172a",
                      }}
                    >
                      {formatCurrency(getTotalFor(cat.label))}
                    </span>
                    <span style={{ color: "#94a3b8", fontSize: "1rem" }}>
                      ›
                    </span>
                  </div>
                </div>
              ))}
            </div>

            {/* Totals */}
            <div
              style={{
                marginTop: "1.25rem",
                paddingTop: "1rem",
                borderTop: "2px solid #e2e8f0",
                display: "flex",
                flexDirection: "column",
                gap: "0.75rem",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <span
                  style={{
                    fontWeight: 700,
                    fontSize: "0.875rem",
                    color: "#0f172a",
                  }}
                >
                  Total Revenue
                </span>
                <span
                  style={{
                    fontWeight: 800,
                    fontSize: "1rem",
                    color: "#0f172a",
                  }}
                >
                  {formatCurrency(totalRevenue)}
                </span>
              </div>
              <Separator />
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <span
                  style={{
                    fontWeight: 700,
                    fontSize: "0.875rem",
                    color: "#ef4444",
                  }}
                >
                  Outstanding Amount
                </span>
                <span
                  style={{
                    fontWeight: 800,
                    fontSize: "1rem",
                    color: "#ef4444",
                  }}
                >
                  {formatCurrency(outstanding)}
                </span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Breakdown Modal */}
      <Modal
        open={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={`${selectedCategory} — Patient Records`}
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
              No revenue has been recorded under{" "}
              <strong>{selectedCategory}</strong> yet. Payments recorded in the
              Payment Collection module will appear here.
            </p>
          </div>
        ) : (
          <Table>
            <thead>
              <TableRow>
                <TableCell>#</TableCell>
                <TableCell>Patient Name</TableCell>
                <TableCell>Category</TableCell>
                <TableCell>Date</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Amount</TableCell>
              </TableRow>
            </thead>
            <tbody>
              {Object.values(
                filteredRecords.reduce(
                  (acc, r) => {
                    const key = r.patientName;
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
                  <TableCell>{r.category}</TableCell>
                  <TableCell style={{ color: "#64748b" }}>{r.date}</TableCell>
                  <TableCell>
                    <span
                      style={{
                        padding: "0.2rem 0.6rem",
                        borderRadius: "9999px",
                        fontSize: "0.75rem",
                        fontWeight: 600,
                        backgroundColor:
                          r.status === "Paid" ? "#dcfce7" : "#fef3c7",
                        color: r.status === "Paid" ? "#15803d" : "#92400e",
                      }}
                    >
                      {r.status}
                    </span>
                  </TableCell>
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
