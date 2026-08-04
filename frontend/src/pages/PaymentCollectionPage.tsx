import { useState, useEffect } from "react";
import type { Dispatch, SetStateAction } from "react";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  Input,
  Label,
  Select,
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

type Transaction = {
  id: string;
  patientId: string;
  patientName: string;
  paymentFor: string;
  amount: number;
  mode: string;
  date: string;
  gatewayRef: string;
};

const PAYMENT_MODES = [
  { name: "Cash", icon: "💵" },
  { name: "Card", icon: "💳" },
  { name: "UPI", icon: "📱" },
  { name: "Bank Transfer", icon: "🏦" },
];

export default function PaymentCollectionPage({
  setNotice,
  onNavigate,
}: Props) {
  // Form State
  const [patientId, setPatientId] = useState("");
  const [patientName, setPatientName] = useState("");
  const [duePaymentFor, setDuePaymentFor] = useState("");
  const [dueAmount, setDueAmount] = useState("");
  const [paymentMode, setPaymentMode] = useState("Cash");
  const [gatewayRef, setGatewayRef] = useState("");
  const [selectDate, setSelectDate] = useState(
    new Date().toISOString().split("T")[0],
  );
  const [period, setPeriod] = useState<"Daily" | "Monthly">("Daily");

  // Transactions State
  const [transactions, setTransactions] = useState<Transaction[]>([]);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedMethod, setSelectedMethod] = useState("");

  const normalizeMode = (mode: string): string => {
    const map: Record<string, string> = {
      cash: "Cash",
      card: "Card",
      upi: "UPI",
      bank: "Bank Transfer",
    };
    return map[mode?.toLowerCase()] || mode || "Cash";
  };

  const fetchTransactions = async () => {
    try {
      const res = await fetch("/api/billing/payments");
      if (res.ok) {
        const data = await res.json();
        setTransactions(
          (data.payments || []).map((p: any) => ({
            id: String(p.id),
            patientId: p.patient_id || "",
            patientName: p.patient_name || p.patient_id || "Unknown",
            paymentFor: p.payment_for || "General",
            amount: parseFloat(p.amount) || 0,
            mode: normalizeMode(p.mode),
            date: p.date || "",
            gatewayRef: p.gateway_ref || "",
          })),
        );
      }
    } catch (err) {
      console.error("Failed to fetch payments:", err);
    }
  };

  useEffect(() => {
    fetchTransactions();
  }, []);

  const metrics = {
    totalBilled: transactions.reduce((s, t) => s + t.amount, 0),
    collected: transactions.reduce((s, t) => s + t.amount, 0),
    pendingDue: 0,
    advances: 0,
    refunds: 0,
  };

  const handleRecordPayment = (e: React.FormEvent) => {
    e.preventDefault();
    const amount = parseFloat(dueAmount);
    if (isNaN(amount) || amount <= 0) {
      setNotice({ type: "error", message: "Please enter a valid amount." });
      return;
    }
    const newTx: Transaction = {
      id: Math.random().toString(36).substr(2, 9),
      patientId,
      patientName: patientName || "Unknown Patient",
      paymentFor: duePaymentFor || "General",
      amount,
      mode: paymentMode,
      date: selectDate,
      gatewayRef,
    };
    setTransactions((prev) => [newTx, ...prev]);
    setDueAmount("");
    setPatientId("");
    setPatientName("");
    setDuePaymentFor("");
    setGatewayRef("");
    setNotice({
      type: "success",
      message: `Payment of ₹${amount.toLocaleString("en-IN")} recorded via ${paymentMode}`,
    });
  };

  const getAmountForMode = (mode: string) =>
    transactions
      .filter((t) => t.mode === mode)
      .reduce((s, t) => s + t.amount, 0);

  const formatCurrency = (val: number) => `₹${val.toLocaleString("en-IN")}`;

  const openBreakdownModal = (mode: string) => {
    setSelectedMethod(mode);
    setIsModalOpen(true);
  };

  const filteredTransactions = transactions.filter(
    (t) => t.mode === selectedMethod,
  );

  // Filter by period
  const periodLabel =
    period === "Monthly" ? "Monthly Revenue" : "Daily Revenue";

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
          { label: "Total Billed", value: metrics.totalBilled },
          { label: "Collected", value: metrics.collected },
          { label: "Pending Due", value: metrics.pendingDue },
          { label: "Advances", value: metrics.advances },
          { label: "Refunds", value: metrics.refunds },
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

      {/* Record Payment Form */}
      <Card>
        <CardHeader>
          <CardTitle>Record Payment</CardTitle>
          <CardDescription>
            Enter patient details and payment info below.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={handleRecordPayment}
            style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                gap: "1.25rem",
              }}
            >
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.5rem",
                }}
              >
                <Label htmlFor="patientId">Patient ID / UHID</Label>
                <Input
                  id="patientId"
                  placeholder="e.g. P-001"
                  value={patientId}
                  onChange={(e) => setPatientId(e.target.value)}
                />
              </div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.5rem",
                }}
              >
                <Label htmlFor="patientName">Patient Name</Label>
                <Input
                  id="patientName"
                  placeholder="Full name"
                  value={patientName}
                  onChange={(e) => setPatientName(e.target.value)}
                />
              </div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.5rem",
                }}
              >
                <Label htmlFor="duePaymentFor">Payment For</Label>
                <Input
                  id="duePaymentFor"
                  placeholder="e.g. Pharmacy, Lab..."
                  value={duePaymentFor}
                  onChange={(e) => setDuePaymentFor(e.target.value)}
                />
              </div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.5rem",
                }}
              >
                <Label htmlFor="dueAmount">Amount (₹)</Label>
                <Input
                  id="dueAmount"
                  type="number"
                  min="0"
                  placeholder="0.00"
                  value={dueAmount}
                  onChange={(e) => setDueAmount(e.target.value)}
                />
              </div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.5rem",
                }}
              >
                <Label htmlFor="paymentMode">Payment Mode</Label>
                <Select
                  id="paymentMode"
                  value={paymentMode}
                  onChange={(e) => setPaymentMode(e.target.value)}
                >
                  {PAYMENT_MODES.map((m) => (
                    <option key={m.name} value={m.name}>
                      {m.icon} {m.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.5rem",
                }}
              >
                <Label htmlFor="gatewayRef">Gateway Reference</Label>
                <Input
                  id="gatewayRef"
                  placeholder="Transaction ID"
                  value={gatewayRef}
                  onChange={(e) => setGatewayRef(e.target.value)}
                />
              </div>
            </div>
            <div>
              <Button type="submit">Record Payment</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Payment Summary */}
      <Card>
        <CardHeader>
          <CardTitle>Payment Summary</CardTitle>
          <CardDescription>
            Review total collections and calendar-based daily or monthly
            revenue.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Controls Row */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-end",
              marginBottom: "2rem",
              flexWrap: "wrap",
              gap: "1rem",
            }}
          >
            <div
              style={{ display: "flex", gap: "1.5rem", alignItems: "flex-end" }}
            >
              {/* Segmented Toggle */}
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

              {/* Date Input */}
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
                  Select Date
                </Label>
                <Input
                  type={period === "Monthly" ? "month" : "date"}
                  value={
                    period === "Monthly"
                      ? selectDate.substring(0, 7)
                      : selectDate
                  }
                  onChange={(e) => setSelectDate(e.target.value)}
                  style={{ width: "175px" }}
                />
              </div>
            </div>

            {/* Revenue Cards */}
            <div style={{ display: "flex", gap: "1rem" }}>
              <div
                style={{
                  padding: "0.875rem 1.5rem",
                  borderRadius: "0.5rem",
                  backgroundColor: "#f8fafc",
                  border: "1px solid #e2e8f0",
                  minWidth: "170px",
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
                  {periodLabel}
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
                  {formatCurrency(metrics.collected)}
                </p>
              </div>
              <div
                style={{
                  padding: "0.875rem 1.5rem",
                  borderRadius: "0.5rem",
                  backgroundColor: "#fef2f2",
                  border: "1px solid #fee2e2",
                  minWidth: "170px",
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
                  Pending Due
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
                  {formatCurrency(metrics.pendingDue)}
                </p>
              </div>
            </div>
          </div>

          {/* Payment Method Header */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              padding: "0.5rem 0.75rem",
              backgroundColor: "#f8fafc",
              borderRadius: "0.375rem 0.375rem 0 0",
              borderBottom: "2px solid #e2e8f0",
              marginBottom: 0,
            }}
          >
            <span
              style={{
                fontSize: "0.7rem",
                fontWeight: 700,
                color: "#475569",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
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
                letterSpacing: "0.06em",
              }}
            >
              Amount Collected
            </span>
          </div>

          {/* Payment Method Rows */}
          <div
            style={{
              border: "1px solid #e2e8f0",
              borderTop: "none",
              borderRadius: "0 0 0.5rem 0.5rem",
              overflow: "hidden",
            }}
          >
            {PAYMENT_MODES.map((mode, idx) => {
              const amount = getAmountForMode(mode.name);
              const txCount = transactions.filter(
                (t) => t.mode === mode.name,
              ).length;
              return (
                <div
                  key={mode.name}
                  onClick={() => openBreakdownModal(mode.name)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) =>
                    e.key === "Enter" && openBreakdownModal(mode.name)
                  }
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "0.875rem 0.75rem",
                    borderBottom:
                      idx < PAYMENT_MODES.length - 1
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
                      {mode.icon}
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
                        {mode.name}
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
                      {formatCurrency(amount)}
                    </span>
                    <span
                      style={{
                        color: "#94a3b8",
                        fontSize: "1.1rem",
                        lineHeight: 1,
                      }}
                    >
                      ›
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Total Row */}
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
              {formatCurrency(metrics.collected)}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Breakdown Modal */}
      <Modal
        open={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={`${selectedMethod} — Patient Transactions`}
      >
        {filteredTransactions.length === 0 ? (
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
              No transactions found
            </p>
            <p
              style={{
                color: "#94a3b8",
                fontSize: "0.875rem",
                margin: 0,
                textAlign: "center",
              }}
            >
              No payments have been recorded via{" "}
              <strong>{selectedMethod}</strong> yet. Use the "Record Payment"
              form above to add one.
            </p>
          </div>
        ) : (
          <Table>
            <thead>
              <TableRow>
                <TableCell>#</TableCell>
                <TableCell>Patient Name</TableCell>
                <TableCell>Patient ID</TableCell>
                <TableCell>Payment For</TableCell>
                <TableCell>Ref.</TableCell>
                <TableCell>Date</TableCell>
                <TableCell>Amount</TableCell>
              </TableRow>
            </thead>
            <tbody>
              {Object.values(
                filteredTransactions.reduce(
                  (acc, tx) => {
                    const key = tx.patientId || tx.patientName;
                    if (!acc[key]) acc[key] = { ...tx, amount: 0 };
                    acc[key].amount += Number(tx.amount);
                    return acc;
                  },
                  {} as Record<string, (typeof filteredTransactions)[0]>,
                ),
              ).map((tx, i) => (
                <TableRow key={tx.id}>
                  <TableCell style={{ color: "#94a3b8", fontSize: "0.8rem" }}>
                    {i + 1}
                  </TableCell>
                  <TableCell style={{ fontWeight: 600 }}>
                    {tx.patientName}
                  </TableCell>
                  <TableCell style={{ color: "#64748b" }}>
                    {tx.patientId || "—"}
                  </TableCell>
                  <TableCell>{tx.paymentFor}</TableCell>
                  <TableCell style={{ color: "#94a3b8", fontSize: "0.8rem" }}>
                    {tx.gatewayRef || "N/A"}
                  </TableCell>
                  <TableCell style={{ color: "#64748b" }}>{tx.date}</TableCell>
                  <TableCell style={{ fontWeight: 700, color: "#0f172a" }}>
                    {formatCurrency(tx.amount)}
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
