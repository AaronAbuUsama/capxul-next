// The transaction's company remains readable even when this site has only one company.
frappe.ui.form.on("Purchase Invoice", {
	refresh(frm) {
		frm.toggle_display("company", true);
	},
});
