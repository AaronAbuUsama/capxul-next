app_name = "capxul"
app_title = "Capxul"
app_publisher = "Capxul spike"
app_description = "Walking skeleton: the Frappe half (throwaway)"
app_email = "spike@example.invalid"
app_license = "MIT"

after_install = "capxul.setup.after_install"
boot_session = "capxul.setup.boot_session"

doctype_js = {"Payment Entry": "public/js/payment_entry.js", "Purchase Invoice": "public/js/purchase_invoice.js"}
extend_doctype_class = {"Report": ["capxul.reports.LedgerTrace"]}

doc_events = {
    # roles follow hats: nobody edits them by hand
    "User": {"validate": ["capxul.locks.guard_user_roles", "capxul.features.apply_user_blocks", "capxul.brand.user_language"]},
    "System Settings": {"validate": "capxul.privacy.guard_system_settings"},
    "Capxul Feature": {"validate": "capxul.locks.guard_feature"},
    "Has Role": {"before_insert": "capxul.locks.guard_has_role", "on_trash": "capxul.locks.guard_has_role"},
    # money follows the chain
    "Payment Entry": {
        "before_validate": "capxul.payments.fill_pending_reference",
        "before_submit": "capxul.payments.guard_submit",
        "before_cancel": "capxul.payments.guard_cancel",
    },
    "Journal Entry": {"before_cancel": "capxul.capital.guard_cancel"},
    # a line with no item and no account books to the company's default expense account (capxul.books)
    "Purchase Invoice": {"before_validate": "capxul.books.default_expense_account"},
    "GL Entry": {"before_insert": ["capxul.payments.guard_gl_entry", "capxul.trace.stamp_gl"]},
    # the trace id of the command that caused a write (capxul.trace)
    "*": {"after_insert": "capxul.trace.stamp", "on_update": "capxul.trace.stamp", "on_submit": "capxul.trace.stamp", "on_cancel": "capxul.trace.stamp"},
}

# the door: a person is vouched for by Core with a signed assertion (capxul.door); everything after that is Frappe's own permissions
auth_hooks = ["capxul.door.validate_assertion"]

# feature switches (capxul.features): off means refused, nothing is deleted
has_permission = {"*": ["capxul.features.has_permission"]}
permission_query_conditions = {"*": "capxul.features.query_conditions"}
before_request = ["capxul.trace.from_request", "capxul.features.guard_request"]

# names only (capxul.brand): the site says Capxul
after_request = ["capxul.brand.after_request"]
after_migrate = "capxul.setup.after_migrate"

# One daily job of Capxul's own: it notes the world day it ran for, so a warp shows that what fell due each day ran (capxul.clock.daily).
scheduler_events = {"daily": ["capxul.clock.daily"]}
