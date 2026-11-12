import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sessionCookie, type Fixture } from "./fixture.ts";
import { cents, type Sources } from "./sources.ts";

export interface ScreenEvidence { screen: string; path: string; source: string; assertion: "source-equality" }

export async function captureScreens(f: Fixture, s: Sources, dir: string, emit: (name: string, check: () => Promise<void>) => Promise<boolean>): Promise<void> {
  const session = `accept-${process.pid}`;
  const browser = (...args: string[]) => {
    try {
      const text = execFileSync("agent-browser", ["--session", session, "--json", ...args], { encoding: "utf8", timeout: 60000, stdio: ["pipe", "pipe", "pipe"] });
      const result = JSON.parse(text);
      if (!result.success) throw new Error();
      return result.data;
    } catch { throw new Error(`browser ${args[0]} failed (details suppressed to protect session credentials)`); }
  };
  const evaluate = (js: string) => browser("eval", js).result;
  const screens: ScreenEvidence[] = [];
  const origin = new URL(f.frappeUrl); origin.hostname = f.site;
  const save = (screen: string, suffix: string, source: string) => {
    const path = `acceptance/${suffix}.png`;
    browser("screenshot", join(dir, suffix + ".png"));
    screens.push({ screen, path, source, assertion: "source-equality" });
  };
  try {
    browser("cookies", "set", "sid", sessionCookie(f.cookieJar), "--url", origin.origin);
    browser("open", new URL("/app", origin).href);
    browser("set", "viewport", "1440", "1000", "2");
    browser("wait", "--fn", `window.frappe && frappe.session && frappe.session.user === ${JSON.stringify(f.user)}`);
    const form = async (screen: string, doctype: string, name: string, values: Record<string, unknown>) => {
      browser("open", new URL(`/app/${doctype.toLowerCase().replaceAll(" ", "-")}/${encodeURIComponent(name)}`, origin).href);
      browser("wait", "--fn", `window.cur_frm && cur_frm.doc.name === ${JSON.stringify(name)} && !cur_frm.is_new()`);
      assert(evaluate(`document.body.innerText.includes(${JSON.stringify(name)})`), `${doctype} identity is not rendered`);
      // Open each real form section/tab. Inspect rendered controls, not just cur_frm.doc or a matching body substring.
      for (const [field, expected] of Object.entries(values)) {
        const tab = evaluate(`(() => { const c=cur_frm.fields_dict[${JSON.stringify(field)}]; if(!c) throw Error('missing control'); return c.$wrapper.closest('.tab-pane').attr('id') ?? null; })()`);
        if (tab) browser("click", `[role="tab"][aria-controls="${tab}"]`);
        const section = evaluate(`(() => { const s=cur_frm.fields_dict[${JSON.stringify(field)}].$wrapper.closest('.form-section'); return s.children('.section-head').hasClass('collapsed') ? s.attr('data-fieldname') : null; })()`);
        if (section) {
          browser("click", `.form-section[data-fieldname="${section}"] > .section-head`);
          browser("wait", "--fn", `!cur_frm.fields_dict[${JSON.stringify(field)}].$wrapper.closest('.form-section').children('.section-body').hasClass('hide')`);
        }
        browser("scrollintoview", `[data-fieldname="${field}"]`);
        browser("eval", "new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))");
        const rendered = evaluate(`(() => { const c=cur_frm.fields_dict[${JSON.stringify(field)}], w=c.$wrapper[0]; const nodes=[...w.querySelectorAll('input:not([type=hidden]),textarea,select,.control-value')].filter(n=>n.getClientRects().length && getComputedStyle(n).visibility!=='hidden'); return nodes.map(n=>n.value ?? n.innerText); })()`);
        assert(Array.isArray(rendered) && rendered.length > 0, `${doctype}.${field} is not rendered`);
        const equal = typeof expected === "number" ? rendered.some((v: string) => {
          try { return cents(v.replace(/[^0-9.\-]/g, "")) === cents(expected); } catch { return false; }
        }) : rendered.some((v: string) => String(v).trim() === String(expected));
        assert(equal, `${doctype}.${field} displayed a value different from its API source`);
        appendFileSync(join(dir, "dom.jsonl"), JSON.stringify({ screen, name, field, expected, rendered }) + "\n");
        save(screen, `${screen}-${field}`, `acceptance/sources.json#/${doctype === "Purchase Invoice" ? "invoice" : "payment"}/${field}`);
      }
    };
    const reportRow = (screen: string, index: number, values: Record<string, unknown>, source: string) => {
      // Resolve field names through the real DataTable, then read its rendered cells, not query_report.data.
      evaluate(`frappe.query_report.datatable.rowmanager.scrollToRow(${index})`);
      for (const [field, expected] of Object.entries(values)) {
        const column = evaluate(`frappe.query_report.datatable.datamanager.getColumnIndexById(${JSON.stringify(field)})`);
        assert(Number.isInteger(column) && column >= 0, `${screen} has no displayed ${field} column`);
        const selector = `.dt-scrollable .dt-cell--${column}-${index}`;
        browser("wait", selector); browser("scrollintoview", selector);
        browser("eval", "new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))");
        const rendered = evaluate(`(() => { const n=document.querySelector(${JSON.stringify(selector)}), r=n.getBoundingClientRect(); if(!r.width || !r.height || r.right<=0 || r.left>=innerWidth || r.bottom<=0 || r.top>=innerHeight) throw Error('cell not visible'); return n.innerText.trim(); })()`);
        if (typeof expected === "number") assert.equal(cents(rendered.replace(/[^0-9.\-]/g, "")), cents(expected), `${screen}.${field} differs from its source`);
        else assert.equal(rendered, String(expected), `${screen}.${field} differs from its source`);
        appendFileSync(join(dir, "dom.jsonl"), JSON.stringify({ screen, index, field, expected, rendered }) + "\n");
        save(screen, `${screen}-${field}`, source);
      }
    };
    await emit("ACCEPT.invoice-screen-source-equal", () => form("supplier-invoice", "Purchase Invoice", f.invoice, {
      supplier: s.invoice.supplier, currency: s.invoice.currency, grand_total: s.invoice.grand_total,
      outstanding_amount: s.invoice.outstanding_amount, company: s.invoice.company,
    }));
    await emit("ACCEPT.payment-screen-source-equal", () => form("payment-entry", "Payment Entry", f.paymentEntry, {
      party: s.payment.party, paid_amount: s.payment.paid_amount, capxul_status: s.payment.capxul_status,
      reference_no: s.payment.reference_no, company: s.payment.company, capxul_approval_url: s.payment.capxul_approval_url,
    }));
    await emit("ACCEPT.ledger-screen-source-equal", async () => {
      const date = s.payment.posting_date;
      const filters = { company: f.company, from_date: date, to_date: date, voucher_no: f.paymentEntry };
      browser("open", new URL(`/app/query-report/General Ledger?${new URLSearchParams(Object.entries(filters).map(([k, v]) => [k, String(v)]))}`, origin).href);
      browser("wait", "--fn", "window.frappe && frappe.query_report && frappe.query_report.report_name === 'General Ledger' && frappe.query_report.data?.length > 0 && !frappe.query_report.refreshing");
      const data = evaluate("frappe.query_report.data");
      const payment = data.filter((r: Record<string, unknown>) => r.voucher_no === f.paymentEntry);
      assert(payment.length > 0, "ledger screen does not show the selected payment");
      const safe = payment.filter((r: Record<string, unknown>) => r.account === f.safeAccount);
      assert.equal(safe.reduce((a: bigint, r: Record<string, unknown>) => a + cents(r.credit), 0n), BigInt(f.amountAtomic) / 10000n);
      const source = s.ledger.find((r) => r.voucher_no === f.paymentEntry && r.account === f.safeAccount)!;
      const index = data.findIndex((r: Record<string, unknown>) => r.voucher_no === f.paymentEntry && r.account === f.safeAccount);
      reportRow("general-ledger", index, { account: f.safeAccount, debit: source.debit, credit: source.credit, capxul_trace: source.capxul_trace }, `acceptance/sources.json#/ledger/${s.ledger.indexOf(source)}`);
    });
    await emit("ACCEPT.balance-screen-source-equal", async () => {
      const filters = { company: f.company, fiscal_year: "2026", from_date: "2026-01-01", to_date: "2026-12-31" };
      browser("open", new URL(`/app/query-report/Trial Balance?${new URLSearchParams(filters)}`, origin).href);
      browser("wait", "--fn", "window.frappe && frappe.query_report && frappe.query_report.report_name === 'Trial Balance' && frappe.query_report.data?.length > 0 && !frappe.query_report.refreshing");
      const rows = evaluate("frappe.query_report.data").filter((r: Record<string, unknown>) => r.account === f.safeAccount);
      assert.equal(rows.length, 1, "Trial Balance screen lost the Safe account");
      assert.equal((cents(rows[0].closing_debit) - cents(rows[0].closing_credit)) * 10000n, BigInt(s.safeAtomic));
      if (evaluate("(() => { const n=document.querySelector('[data-action=expand_all_rows]'); return !!n && !!n.getClientRects().length && getComputedStyle(n).display!=='none'; })()")) browser("click", "[data-action=expand_all_rows]");
      const index = evaluate(`frappe.query_report.data.findIndex(r=>r.account===${JSON.stringify(f.safeAccount)})`);
      const source = s.trial.find((r) => r.account === f.safeAccount)!;
      reportRow("safe-trial-balance", index, { account: source.account_name ?? f.safeAccount, closing_debit: source.closing_debit, closing_credit: source.closing_credit }, `acceptance/sources.json#/trial/${s.trial.indexOf(source)}`);
    });
    writeFileSync(join(dir, "..", "screens.json"), JSON.stringify(screens, null, 2) + "\n");
  } finally { try { browser("close"); } catch { /* A failed browser must not mask the acceptance failure. */ } }
}
