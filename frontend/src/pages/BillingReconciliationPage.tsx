import type { Dispatch, SetStateAction } from "react";
import BillingPage from "./BillingPage";
import type { Notice } from "../types";

type Props = {
  setNotice: Dispatch<SetStateAction<Notice | null>>;
};

export default function BillingReconciliationPage({ setNotice }: Props) {
  return <BillingPage setNotice={setNotice} view="reconciliation" />;
}
