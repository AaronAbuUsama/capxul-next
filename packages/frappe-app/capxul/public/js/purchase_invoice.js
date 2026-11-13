// The transaction's company remains readable even when this site has only one company (plugs.ledger-trace-display).
// ERPNext's transaction controller hides it in its own refresh (erpnext.hide_company), and Frappe runs the controller's
// refresh after every frappe.ui.form.on refresh handler. cscript.custom_refresh runs after the controller's refresh.
frappe.ui.form.on("Purchase Invoice", {
	setup(frm) {
		const after = frm.cscript.custom_refresh;
		frm.cscript.custom_refresh = function (...args) {
			if (after) after.apply(this, args);
			frm.toggle_display("company", true);
		};
	},
});
