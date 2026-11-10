app_name = "capxul"
app_title = "Capxul"
app_publisher = "Capxul spike"
app_description = "Walking skeleton: the Frappe half (throwaway)"
app_email = "spike@example.invalid"
app_license = "MIT"

after_install = "capxul.setup.after_install"
boot_session = "capxul.setup.boot_session"

doctype_js = {"Payment Entry": "public/js/payment_entry.js"}

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
    "GL Entry": {"before_insert": "capxul.payments.guard_gl_entry"},
}

# feature switches (capxul.features): off means refused, nothing is deleted
has_permission = {"*": ["capxul.features.has_permission"]}
permission_query_conditions = {"*": "capxul.features.query_conditions"}
before_request = ["capxul.features.guard_request"]

# names only (capxul.brand): the site says Capxul
after_request = ["capxul.brand.after_request"]
after_migrate = ["capxul.brand.apply", "capxul.privacy.apply"]
