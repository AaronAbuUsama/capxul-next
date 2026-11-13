// Safe-backed Payment Entry: Submit asks Capxul for a signature instead of posting the ledger.
frappe.ui.form.on("Payment Entry", {
  refresh(frm) {
    frm.toggle_display("company", true);
    const safe = frappe.boot.capxul && frappe.boot.capxul.safe_account;
    if (!safe || frm.doc.paid_from !== safe || frm.doc.docstatus !== 0) return;
    frm.savesubmit = () => capxul_request(frm); // override the form's submit action
    if (frm.doc.capxul_status) {
      const failed =
        (frm.doc.capxul_status || "").startsWith("Failed") || (frm.doc.capxul_status || "").startsWith("Mismatch");
      frm.dashboard.set_headline_alert(
        frm.doc.capxul_status +
          (frm.doc.capxul_approval_url && !failed
            ? ` &middot; <a href="#" class="capxul-open">open the approval</a>`
            : ""),
        failed ? "red" : "orange",
      );
      frm.dashboard.wrapper.find(".capxul-open").on("click", (e) => {
        e.preventDefault();
        capxul_popup(frm.doc.capxul_approval_url);
      });
      if (!failed) capxul_poll(frm);
    }
  },
});

function capxul_popup(url) {
  window.open(url, "capxul-approve", "popup=yes,width=480,height=720");
}

function capxul_request(frm) {
  const go = frm.is_dirty() ? frm.save() : Promise.resolve();
  return go
    .then(() =>
      frappe.call({
        method: "capxul.api.request_payment",
        args: { name: frm.doc.name },
        freeze: true,
        freeze_message: __("Asking Capxul to prepare the payment..."),
      }),
    )
    .then((r) => {
      const m = r.message || {};
      if (m.approval_url) capxul_popup(m.approval_url);
      frm.reload_doc();
    });
}

function capxul_poll(frm) {
  if (frm._capxul_timer) return;
  frm._capxul_timer = setInterval(() => {
    frappe.call({ method: "capxul.api.payment_status", args: { name: frm.doc.name } }).then((r) => {
      const s = r.message || {};
      if (s.docstatus !== 0 || (s.capxul_status || "") !== frm.doc.capxul_status) {
        clearInterval(frm._capxul_timer);
        frm._capxul_timer = null;
        frm.reload_doc();
      }
    });
  }, 3000);
}
