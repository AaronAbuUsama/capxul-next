// The transaction's company remains readable even when this site has only one company.
// ERPNext's transaction controller hides Company on one-company sites (erpnext.hide_company) in its own refresh,
// and Frappe runs a controller's refresh after every frappe.ui.form.on handler. `custom_refresh` is the controller
// hook Frappe runs after the controller's refresh, so showing Company there is what lasts on screen.
frappe.ui.form.on("Purchase Invoice", {
	setup(frm) {
		frm.cscript.custom_refresh = () => frm.toggle_display("company", true);
	},
});
